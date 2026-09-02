import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const rawArguments = process.argv.slice(2)
if (rawArguments.includes('--quick')) {
  const quickScript = resolve(process.cwd(), 'scripts', 'quick-calibrate-xiangqi-strength.mjs')
  const child = spawnSync(process.execPath, [quickScript, ...rawArguments.filter((argument) => argument !== '--quick')], {
    stdio: 'inherit',
    env: process.env,
  })
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}

const ENGINE_IDS = ['pikafish-2026-nnue', 'pikafish-2025-nnue', 'fairy-stockfish-nnue']
const PAIRINGS = [
  [ENGINE_IDS[0], ENGINE_IDS[1]],
  [ENGINE_IDS[0], ENGINE_IDS[2]],
  [ENGINE_IDS[1], ENGINE_IDS[2]],
]
const SCENARIOS = ['battle-full', 'human-l1', 'human-l2', 'human-l3', 'human-l4', 'human-l5']
const PROFILES = ['constrained', 'desktop']

const options = parseArguments(rawArguments)
if (options.help) {
  printHelp()
  process.exit(0)
}

const runner = resolve(process.cwd(), 'scripts', 'run-browser-validation.mjs')
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'unknown'

if (options.generateCorpus) {
  mkdirSync(dirname(resolve(options.generateCorpus)), { recursive: true })
  const reportPath = `${options.generateCorpus}.runner.json`
  const page = buildPage({
    operation: 'generate-corpus',
    scenario: 'battle-full',
    profile: options.profiles[0],
    engine: ENGINE_IDS[0],
    opponent: ENGINE_IDS[2],
  })
  page.searchParams.set('opening-count', String(options.openingCount))
  page.searchParams.set('generation-nodes', String(options.generationNodes))
  page.searchParams.set('balance-cp', String(options.balanceCp))
  const status = runBrowser(page, reportPath)
  if (status !== 0) process.exit(status)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const corpus = report.validation?.corpus
  if (!corpus || corpus.openings?.length < options.openingCount) throw new Error('浏览器未返回完整开局语料。')
  writeFileSync(options.generateCorpus, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
  process.stdout.write(`已生成 ${corpus.openings.length} 个冻结开局：${options.generateCorpus}\nSHA-256: ${corpus.sha256}\n`)
  process.exit(0)
}

const jobs = options.matrix
  ? options.profiles.flatMap((profile) => options.scenarios.flatMap((scenario) =>
      PAIRINGS.map(([engine, opponent]) => ({ operation: 'match', engine, opponent, profile, scenario }))))
  : [{
      operation: options.operation,
      engine: options.engine,
      opponent: options.opponent,
      profile: options.profiles[0],
      scenario: options.scenarios[0],
    }]

const outputRoot = resolve(options.output ??
  (options.matrix ? `reports/xiangqi-calibration/${timestamp()}` : 'benchmark/xiangqi-calibration-v2.json'))
if (options.matrix) mkdirSync(outputRoot, { recursive: true })
else mkdirSync(dirname(outputRoot), { recursive: true })
const rawJsonl = options.matrix ? resolve(outputRoot, 'games.jsonl') : `${outputRoot}.games.jsonl`
writeFileSync(rawJsonl, '', 'utf8')
const manifest = {
  schema: 'project10-xiangqi-calibration-matrix-v2',
  startedAt: new Date().toISOString(),
  gitCommit,
  serialExecution: true,
  jobs: [],
}
let exitCode = 0

for (let index = 0; index < jobs.length; index += 1) {
  const job = jobs[index]
  const name = `${job.scenario}__${job.profile}__${job.engine}__vs__${job.opponent}`
  const reportPath = options.matrix ? resolve(outputRoot, `${name}.json`) : outputRoot
  const page = buildPage({ operation: 'match', ...job })
  process.stdout.write(`[${index + 1}/${jobs.length}] ${name}\n`)
  const status = runBrowser(page, reportPath)
  if (status !== 0) exitCode = status
  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (error) {
    manifest.jobs.push({ ...job, status: 'runner-output-missing', reportPath, error: String(error) })
    if (!options.keepGoing) break
    continue
  }
  const validation = report.validation ?? null
  for (const game of validation?.games ?? []) {
    appendFileSync(rawJsonl, `${JSON.stringify({
      schema: 'project10-xiangqi-game-evidence-v2',
      gitCommit,
      browser: report.page?.userAgent ?? null,
      configuration: validation.configuration,
      game,
    })}\n`, 'utf8')
  }
  manifest.jobs.push({
    ...job,
    status: report.status,
    reportPath,
    openingCorpusSha256: validation?.configuration?.openingCorpusSha256 ?? null,
    summary: validation?.summary ?? null,
    qualification: validation?.qualification ?? null,
    checkpoint: validation?.checkpoint ?? null,
  })
  if (status !== 0 && !options.keepGoing) break
}

manifest.conclusions = buildConclusions(manifest.jobs)
manifest.finishedAt = new Date().toISOString()
manifest.status = exitCode === 0 && manifest.jobs.length === jobs.length ? 'completed' : 'incomplete'
const manifestPath = options.matrix ? resolve(outputRoot, 'manifest.json') : `${outputRoot}.manifest.json`
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
process.stdout.write(`汇总：${manifestPath}\n逐局证据：${rawJsonl}\n`)
process.exitCode = exitCode

function buildPage(job) {
  const page = new URL('/xiangqi-calibration.html', options.previewUrl)
  page.searchParams.set('operation', job.operation)
  page.searchParams.set('engine', job.engine)
  page.searchParams.set('opponent', job.opponent)
  page.searchParams.set('pairs', String(options.pairs))
  page.searchParams.set('scenario', job.scenario)
  page.searchParams.set('resource-profile', job.profile)
  page.searchParams.set('run-stage', options.runStage)
  page.searchParams.set('evidence-tier', options.evidenceTier)
  page.searchParams.set('max-plies', String(options.maxPlies))
  page.searchParams.set('search-timeout-ms', String(options.searchTimeoutMs))
  page.searchParams.set('seed', String(options.seed))
  page.searchParams.set('opening-offset', String(options.openingOffset))
  if (options.corpusUrl) page.searchParams.set('corpus-url', options.corpusUrl)
  if (options.corpusStorageKey) page.searchParams.set('corpus-storage-key', options.corpusStorageKey)
  if (options.openingPrimaryCount) page.searchParams.set('opening-primary-count', String(options.openingPrimaryCount))
  if (options.backupOpeningOffset !== null) page.searchParams.set('backup-opening-offset', String(options.backupOpeningOffset))
  if (options.backupOpeningCount) page.searchParams.set('backup-opening-count', String(options.backupOpeningCount))
  if (options.nodes) {
    page.searchParams.set('engine-nodes', String(options.nodes))
    page.searchParams.set('opponent-nodes', String(options.nodes))
  }
  if (options.engineNodes) page.searchParams.set('engine-nodes', String(options.engineNodes))
  if (options.opponentNodes) page.searchParams.set('opponent-nodes', String(options.opponentNodes))
  if (options.engineBudgetMs) page.searchParams.set('engine-budget-ms', String(options.engineBudgetMs))
  if (options.opponentBudgetMs) page.searchParams.set('opponent-budget-ms', String(options.opponentBudgetMs))
  if (options.forceMultiPv) page.searchParams.set('force-multipv', String(options.forceMultiPv))
  if (options.engineMultiPv) page.searchParams.set('engine-multipv', String(options.engineMultiPv))
  if (options.opponentMultiPv) page.searchParams.set('opponent-multipv', String(options.opponentMultiPv))
  if (options.engineBudgetMultiplier) page.searchParams.set('engine-budget-multiplier', String(options.engineBudgetMultiplier))
  if (options.opponentBudgetMultiplier) page.searchParams.set('opponent-budget-multiplier', String(options.opponentBudgetMultiplier))
  if (options.evidenceTier === 'quick') {
    page.searchParams.set('quick-min-think-ms', String(options.quickMinThinkMs))
    page.searchParams.set('quick-max-think-ms', String(options.quickMaxThinkMs))
  }
  if (options.deadlineAtMs) page.searchParams.set('deadline-at-ms', String(options.deadlineAtMs))
  if (options.latencySamples) page.searchParams.set('latency-samples', String(options.latencySamples))
  return page
}

function buildConclusions(jobs) {
  const groups = new Map()
  for (const job of jobs) {
    const key = `${job.scenario}:${job.profile}`
    const values = groups.get(key) ?? []
    values.push(job)
    groups.set(key, values)
  }
  return [...groups.entries()].map(([key, values]) => {
    const [scenario, resourceProfile] = key.split(':')
    if (values.length !== 3 || values.some((value) => !value.summary)) {
      return { scenario, resourceProfile, status: 'incomplete', leaders: [], uniqueLeader: null }
    }
    const orientedInterval = (summary, candidate) => {
      const interval = summary.eloInterval95
      if (summary.engineId === candidate) return interval
      return [interval[1] === null ? null : -interval[1], interval[0] === null ? null : -interval[0]]
    }
    const unique = ENGINE_IDS.find((candidate) => {
      const relevant = values.map((value) => value.summary)
        .filter((summary) => summary.engineId === candidate || summary.opponentId === candidate)
      return relevant.length === 2 && relevant.every((summary) => {
        const [low] = orientedInterval(summary, candidate)
        return low !== null && low > 0
      })
    }) ?? null
    const completedPairs = Math.min(...values.map((value) => value.summary.pairs))
    if (!unique && completedPairs < 500) {
      return {
        scenario,
        resourceProfile,
        status: 'insufficient-evidence',
        leaders: [],
        uniqueLeader: null,
        completedPairs,
        note: '尚未达到 500 个有效换色对，且当前置信下界不足以宣布唯一领先者。',
      }
    }
    const leaders = unique ? [unique] : ENGINE_IDS.filter((candidate) => {
      const relevant = values.map((value) => value.summary)
        .filter((summary) => summary.engineId === candidate || summary.opponentId === candidate)
      return relevant.length === 2 && relevant.every((summary) => {
        const [, high] = orientedInterval(summary, candidate)
        return high === null || high >= 0
      })
    })
    return {
      scenario,
      resourceProfile,
      status: unique ? 'unique-leader' : 'statistical-co-leaders',
      leaders,
      uniqueLeader: unique,
      note: unique
        ? '该引擎对另外两个引擎的多重校正 95% Elo 下界均大于 0。'
        : '证据不足以在候选领先者之间强行指定唯一冠军。',
    }
  })
}

function runBrowser(page, reportPath) {
  const remainingMs = options.deadlineAtMs ? Math.max(1_000, options.deadlineAtMs - Date.now() + 120_000) : 0
  const timeoutMs = options.evidenceTier === 'quick'
    ? Math.max(options.timeoutMs, remainingMs)
    : Math.max(options.timeoutMs, options.pairs * 2 * options.maxPlies * 1_000 + 120_000)
  const args = [
    runner,
    '--cdp-url', options.cdpUrl,
    '--page-url', page.href,
    '--timeout-ms', String(timeoutMs),
    '--poll-ms', String(options.pollMs),
    '--output', reportPath,
  ]
  const child = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
  if (child.error) throw child.error
  return child.status ?? 1
}

function parseArguments(args) {
  const values = {
    cdpUrl: 'http://127.0.0.1:9222',
    previewUrl: 'http://127.0.0.1:4173',
    engine: ENGINE_IDS[0],
    opponent: ENGINE_IDS[2],
    operation: 'match',
    pairs: 20,
    scenarios: ['battle-full'],
    profiles: ['constrained'],
    runStage: 'baseline',
    evidenceTier: 'standard',
    matrix: false,
    keepGoing: false,
    corpusUrl: null,
    corpusStorageKey: null,
    nodes: null,
    engineNodes: null,
    opponentNodes: null,
    engineBudgetMs: null,
    opponentBudgetMs: null,
    forceMultiPv: null,
    engineMultiPv: null,
    opponentMultiPv: null,
    engineBudgetMultiplier: null,
    opponentBudgetMultiplier: null,
    quickMinThinkMs: 200,
    quickMaxThinkMs: 300,
    deadlineAtMs: null,
    openingPrimaryCount: null,
    backupOpeningOffset: null,
    backupOpeningCount: null,
    latencySamples: null,
    maxPlies: 600,
    searchTimeoutMs: 90_000,
    timeoutMs: 600_000,
    pollMs: 1_000,
    seed: 0x6d2b79f5,
    output: null,
    generateCorpus: null,
    openingOffset: null,
    openingCount: 800,
    generationNodes: 10_000,
    balanceCp: 300,
    help: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') { values.help = true; continue }
    if (argument === '--matrix') { values.matrix = true; continue }
    if (argument === '--keep-going') { values.keepGoing = true; continue }
    const [name, inlineValue] = argument.split(/=(.*)/s, 2)
    const value = inlineValue ?? args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值`)
    if (name === '--cdp-url') values.cdpUrl = value
    else if (name === '--preview-url') values.previewUrl = value
    else if (name === '--engine') values.engine = value
    else if (name === '--opponent') values.opponent = value
    else if (name === '--operation') values.operation = oneOf(value, ['match', 'latency-check'], name)
    else if (name === '--pairs') values.pairs = positiveInteger(value, name)
    else if (name === '--scenario') values.scenarios = list(value, SCENARIOS, name)
    else if (name === '--profiles') values.profiles = value === 'all' ? [...PROFILES] : list(value, PROFILES, name)
    else if (name === '--profile') values.profiles = [oneOf(value, PROFILES, name)]
    else if (name === '--run-stage') values.runStage = oneOf(value, ['baseline', 'tuning', 'formal'], name)
    else if (name === '--evidence-tier') values.evidenceTier = oneOf(value, ['standard', 'quick'], name)
    else if (name === '--corpus-url') values.corpusUrl = value
    else if (name === '--corpus-storage-key') values.corpusStorageKey = value
    else if (name === '--nodes') values.nodes = positiveInteger(value, name)
    else if (name === '--engine-nodes') values.engineNodes = positiveInteger(value, name)
    else if (name === '--opponent-nodes') values.opponentNodes = positiveInteger(value, name)
    else if (name === '--engine-budget-ms') values.engineBudgetMs = positiveInteger(value, name)
    else if (name === '--opponent-budget-ms') values.opponentBudgetMs = positiveInteger(value, name)
    else if (name === '--force-multipv') values.forceMultiPv = positiveInteger(value, name)
    else if (name === '--engine-multipv') values.engineMultiPv = positiveInteger(value, name)
    else if (name === '--opponent-multipv') values.opponentMultiPv = positiveInteger(value, name)
    else if (name === '--engine-budget-multiplier') values.engineBudgetMultiplier = boundedNumber(value, name, 1, 3)
    else if (name === '--opponent-budget-multiplier') values.opponentBudgetMultiplier = boundedNumber(value, name, 1, 3)
    else if (name === '--quick-min-think-ms') values.quickMinThinkMs = positiveInteger(value, name)
    else if (name === '--quick-max-think-ms') values.quickMaxThinkMs = positiveInteger(value, name)
    else if (name === '--deadline-at-ms') values.deadlineAtMs = positiveInteger(value, name)
    else if (name === '--opening-primary-count') values.openingPrimaryCount = positiveInteger(value, name)
    else if (name === '--backup-opening-offset') values.backupOpeningOffset = nonNegativeInteger(value, name)
    else if (name === '--backup-opening-count') values.backupOpeningCount = positiveInteger(value, name)
    else if (name === '--latency-samples') values.latencySamples = positiveInteger(value, name)
    else if (name === '--max-plies') values.maxPlies = positiveInteger(value, name)
    else if (name === '--search-timeout-ms') values.searchTimeoutMs = positiveInteger(value, name)
    else if (name === '--timeout-ms') values.timeoutMs = positiveInteger(value, name)
    else if (name === '--poll-ms') values.pollMs = positiveInteger(value, name)
    else if (name === '--seed') values.seed = positiveInteger(value, name)
    else if (name === '--opening-offset') values.openingOffset = nonNegativeInteger(value, name)
    else if (name === '--output') values.output = value
    else if (name === '--generate-corpus') values.generateCorpus = value
    else if (name === '--opening-count') values.openingCount = positiveInteger(value, name)
    else if (name === '--generation-nodes') values.generationNodes = positiveInteger(value, name)
    else if (name === '--balance-cp') values.balanceCp = positiveInteger(value, name)
    else throw new Error(`未知参数：${argument}`)
  }
  if (values.pairs > 500) throw new Error('--pairs 不能超过 500')
  if (values.runStage === 'tuning' && values.pairs > 200) throw new Error('调参阶段不能超过 200 对')
  if (values.runStage === 'formal' && !values.corpusUrl) throw new Error('正式阶段必须指定 --corpus-url')
  if (values.evidenceTier === 'quick' && values.runStage === 'formal') throw new Error('quick 证据不能使用 formal 阶段')
  if (values.evidenceTier === 'quick' && values.profiles.some((profile) => profile !== 'desktop')) {
    throw new Error('quick 证据只允许 desktop 资源画像')
  }
  if (values.openingOffset === null) values.openingOffset = values.runStage === 'formal' ? 200 : 0
  if (values.runStage === 'formal' && values.openingOffset < 200) throw new Error('正式阶段 --opening-offset 不得小于 200')
  if (values.forceMultiPv && values.forceMultiPv > 4) throw new Error('--force-multipv 必须为 1–4')
  for (const multiPv of [values.engineMultiPv, values.opponentMultiPv]) {
    if (multiPv && multiPv > 4) throw new Error('单方 MultiPV 必须为 1–4')
  }
  if (values.quickMaxThinkMs < values.quickMinThinkMs) throw new Error('quick 最大时间不得小于最小时间')
  if (values.maxPlies > 600) throw new Error('--max-plies 不能超过 600')
  for (const nodes of [values.nodes, values.engineNodes, values.opponentNodes]) {
    if (nodes && nodes > 5_000_000) throw new Error('节点预算不能超过 5,000,000')
  }
  return values
}

function list(value, allowed, label) {
  if (value === 'all' && allowed === SCENARIOS) return [...SCENARIOS]
  const values = value.split(',').filter(Boolean)
  for (const entry of values) oneOf(entry, allowed, label)
  return values
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} 无效：${value}`)
  return value
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} 必须是正整数：${value}`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} 必须是正整数：${value}`)
  return parsed
}

function nonNegativeInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} 必须是非负整数：${value}`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} 必须是非负整数：${value}`)
  return parsed
}

function boundedNumber(value, label, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} 必须在 ${min}–${max} 之间：${value}`)
  return parsed
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/calibrate-xiangqi-strength.mjs [options]\n\n` +
    `  --quick                        运行桌面六小时快速工程校准编排器\n` +
    `  --matrix                       串行运行三引擎完整循环赛\n` +
    `  --operation <operation>        match / latency-check\n` +
    `  --scenario <id|all|csv>        battle-full / human-l1..human-l5\n` +
    `  --profiles <id|all|csv>        constrained / desktop\n` +
    `  --run-stage <stage>            baseline / tuning / formal\n` +
    `  --evidence-tier <tier>         standard / quick\n` +
    `  --pairs <n>                    1–500；tuning 最多 200\n` +
    `  --corpus-url <url>             frozen 语料 URL；formal 必填\n` +
    `  --engine-nodes <n>             候选引擎节点增强（最多 5,000,000）\n` +
    `  --opponent-nodes <n>           对手节点增强\n` +
    `  --engine-budget-ms <n>         候选引擎时间增强\n` +
    `  --opponent-budget-ms <n>       对手时间增强\n` +
    `  --force-multipv <1..4>         调参时覆盖 MultiPV\n` +
    `  --generate-corpus <path>       三引擎共同生成并冻结开局语料\n` +
    `  --opening-count <n>            默认 800（调参 200 + 正式 500 + 替补）\n` +
    `  --opening-offset <n>           正式阶段默认且至少为 200\n` +
    `  --generation-nodes <n>         语料生成固定节点，默认 10000\n` +
    `  --output <path>                单任务报告文件或矩阵报告目录\n` +
    `  --keep-going                   某个矩阵任务失败后继续\n` +
    `  --cdp-url / --preview-url      已启动 Chromium 与 Vite preview 地址\n` +
    `  -h, --help                     显示帮助\n`)
}
