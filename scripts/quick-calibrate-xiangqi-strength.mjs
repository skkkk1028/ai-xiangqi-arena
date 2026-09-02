import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ENGINE_IDS = ['pikafish-2026-nnue', 'pikafish-2025-nnue', 'fairy-stockfish-nnue']
const PAIRINGS = [
  [ENGINE_IDS[0], ENGINE_IDS[1]],
  [ENGINE_IDS[0], ENGINE_IDS[2]],
  [ENGINE_IDS[1], ENGINE_IDS[2]],
]
const HUMAN_BASE_NODES = { 'human-l1': 30_000, 'human-l2': 100_000, 'human-l3': 300_000, 'human-l4': 900_000 }
const QUICK = {
  initialPairs: 20,
  incrementPairs: 10,
  maxPairs: 50,
  tuningPairs: 10,
  verificationPairs: 20,
  extendedVerificationPairs: 25,
  corpusSize: 220,
  proxyMinThinkMs: 200,
  proxyMaxThinkMs: 300,
  targetElo: 50,
  minimumImprovement: 0.1,
  openings: {
    baseline: { offset: 0, count: 50 },
    tuning: { offset: 50, count: 80 },
    verificationFull: { offset: 130, count: 20 },
    verificationHuman: { offset: 150, count: 20 },
    backup: { offset: 180, count: 40 },
  },
}

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}

const startedAtMs = Date.now()
const deadlineAtMs = startedAtMs + options.wallClockMinutes * 60_000
const outputRoot = resolve(options.output ?? `reports/xiangqi-calibration/quick-${timestamp()}`)
mkdirSync(outputRoot, { recursive: true })
const manifest = {
  schema: 'project10-xiangqi-quick-calibration-v1',
  evidenceTier: 'quick',
  resourceProfile: 'desktop',
  startedAt: new Date(startedAtMs).toISOString(),
  deadlineAt: new Date(deadlineAtMs).toISOString(),
  wallClockMinutes: options.wallClockMinutes,
  proxyThinkMs: [options.quickMinThinkMs, options.quickMaxThinkMs],
  maximumPairsPerBaselinePairing: options.maxPairs,
  corpus: null,
  jobs: [],
  conclusion: null,
  tuning: [],
  publishedOverrides: {},
  status: 'running',
  stopReason: null,
}

let corpusStorageKey = options.corpusStorageKey
let corpusUrl = options.corpusUrl
try {
  if (!corpusStorageKey && !corpusUrl) {
    const corpusPath = resolve(outputRoot, 'xiangqi-openings-quick-v1.json')
    runCommand([
      '--generate-corpus', corpusPath,
      '--opening-count', String(QUICK.corpusSize),
      '--generation-nodes', String(options.generationNodes),
      '--evidence-tier', 'quick',
      '--profile', 'desktop',
      ...connectionArguments(),
    ])
    const runnerReport = readJson(`${corpusPath}.runner.json`)
    const validation = runnerReport.validation
    if (!validation?.corpus || !validation.configuration?.corpusStorageKey) {
      throw new Error('快速语料生成未返回冻结语料或 IndexedDB 存储键。')
    }
    corpusStorageKey = validation.configuration.corpusStorageKey
    manifest.corpus = {
      path: corpusPath,
      sha256: validation.corpus.sha256,
      storageKey: corpusStorageKey,
      openings: validation.corpus.openings.length,
    }
  } else {
    manifest.corpus = { path: corpusUrl, sha256: null, storageKey: corpusStorageKey, openings: null }
  }

  const baselineReports = []
  for (const [engine, opponent] of PAIRINGS) {
    let targetPairs = Math.min(options.smoke ? 1 : QUICK.initialPairs, options.maxPairs)
    let validation
    do {
      ensureTimeRemaining('baseline')
      validation = runMatch({
        name: `baseline__${engine}__vs__${opponent}`,
        engine,
        opponent,
        scenario: 'battle-full',
        stage: 'baseline',
        pairs: targetPairs,
        opening: QUICK.openings.baseline,
      })
      if (options.smoke || !shouldExtend(validation.summary, targetPairs, options.maxPairs)) break
      targetPairs = Math.min(options.maxPairs, targetPairs + QUICK.incrementPairs)
    } while (true)
    if (!validation?.summary) throw new Error(`基线对阵缺少统计：${engine} vs ${opponent}`)
    baselineReports.push(validation)
  }

  const summaries = baselineReports.map((report) => report.summary)
  const conclusion = options.smoke
    ? {
        status: 'smoke-reference',
        uniqueLeader: null,
        referenceEngineId: ENGINE_IDS[0],
        leaders: [],
        weakerEngineIds: [ENGINE_IDS[2]],
        note: '烟雾模式固定席位只验证流程，不形成棋力结论，也不会应用参数。',
      }
    : determineReference(summaries)
  manifest.conclusion = conclusion
  if (!conclusion.referenceEngineId) {
    manifest.status = 'completed-with-insufficient-evidence'
    manifest.stopReason = 'quick-ranking-unresolved'
  } else {
    for (const weakerEngineId of conclusion.weakerEngineIds) {
      ensureTimeRemaining('tuning')
      const baselineScoreRate = scoreForEngine(
        summaries.find((summary) => includesPair(summary, weakerEngineId, conclusion.referenceEngineId)),
        weakerEngineId,
      )
      const full = tuneFullStrength(weakerEngineId, conclusion.referenceEngineId)
      const human = tuneHumanNodes(weakerEngineId, conclusion.referenceEngineId)
      const verificationPairs = verificationPairTarget()
      let fullVerification = null
      let humanVerification = null
      let latencyChecks = []
      if (full) {
        fullVerification = runMatch({
          name: `verify-full__${weakerEngineId}__vs__${conclusion.referenceEngineId}`,
          engine: weakerEngineId,
          opponent: conclusion.referenceEngineId,
          scenario: 'battle-full',
          stage: 'tuning',
          pairs: verificationPairs,
          opening: QUICK.openings.verificationFull,
          engineMultiPv: 1,
          engineBudgetMultiplier: full.multiplier,
        })
      }
      if (human) {
        humanVerification = runMatch({
          name: `verify-human-l1__${weakerEngineId}__vs__${conclusion.referenceEngineId}`,
          engine: weakerEngineId,
          opponent: conclusion.referenceEngineId,
          scenario: 'human-l1',
          stage: 'tuning',
          pairs: verificationPairs,
          opening: QUICK.openings.verificationHuman,
          engineNodes: human.nodes,
          opponentNodes: HUMAN_BASE_NODES['human-l1'],
        })
        for (const [scenario, baseNodes] of Object.entries(HUMAN_BASE_NODES)) {
          ensureTimeRemaining('latency-check')
          latencyChecks.push(runLatencyCheck({
            name: `latency-${scenario}__${weakerEngineId}`,
            engine: weakerEngineId,
            opponent: conclusion.referenceEngineId,
            scenario,
            nodes: quickNodeBudget(baseNodes, human.multiplier),
          }))
        }
      }
      const fullAssessment = fullVerification
        ? assessCandidate(fullVerification.summary, baselineScoreRate, fullVerification.qualification?.latencyPassed === true)
        : null
      const allLatencyPassed = latencyChecks.length === 4 && latencyChecks.every((check) => check.qualification?.latencyPassed)
      const humanAssessment = humanVerification
        ? assessCandidate(humanVerification.summary, baselineScoreRate, allLatencyPassed)
        : null
      const tuningResult = {
        engineId: weakerEngineId,
        referenceEngineId: conclusion.referenceEngineId,
        baselineScoreRate,
        fullCandidate: full,
        humanCandidate: human,
        fullVerification: compactValidation(fullVerification),
        humanVerification: compactValidation(humanVerification),
        latencyChecks: latencyChecks.map(compactValidation),
        fullAssessment,
        humanAssessment,
      }
      manifest.tuning.push(tuningResult)
      const engineOverrides = buildOverrides(full, fullAssessment, human, humanAssessment, fullVerification, humanVerification)
      if (!options.smoke && Object.keys(engineOverrides).length > 0) {
        manifest.publishedOverrides[weakerEngineId] = engineOverrides
      }
    }
    manifest.status = 'completed'
  }
} catch (error) {
  manifest.status = Date.now() >= deadlineAtMs ? 'time-limit-reached' : 'failed'
  manifest.stopReason = Date.now() >= deadlineAtMs ? 'wall-clock-limit' : String(error)
  process.exitCode = manifest.status === 'failed' ? 1 : 0
} finally {
  manifest.finishedAt = new Date().toISOString()
  manifest.durationMs = Date.now() - startedAtMs
  manifest.remainingMs = Math.max(0, deadlineAtMs - Date.now())
  const unsigned = JSON.stringify(manifest, null, 2)
  manifest.reportSha256 = createHash('sha256').update(unsigned).digest('hex')
  const manifestPath = resolve(outputRoot, 'quick-manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeGameEvidence(resolve(outputRoot, 'games.jsonl'))
  if (options.apply && !options.smoke && manifest.status === 'completed' && Object.keys(manifest.publishedOverrides).length > 0) {
    const generatedPath = resolve(process.cwd(), 'src', 'games', 'xiangqi', 'quick-calibration.generated.json')
    writeFileSync(generatedPath, `${JSON.stringify({
      schema: 'project10-xiangqi-quick-overrides-v1',
      evidenceTier: 'quick',
      generatedAt: manifest.finishedAt,
      reportSha256: manifest.reportSha256,
      resourceProfile: 'desktop',
      overrides: manifest.publishedOverrides,
    }, null, 2)}\n`, 'utf8')
    manifest.appliedPath = generatedPath
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`快速校准报告：${manifestPath}\n状态：${manifest.status}\n`)
}

function tuneFullStrength(engine, opponent) {
  const candidates = []
  for (const multiplier of [1, 1.5, 2, 3]) {
    ensureTimeRemaining('full-strength-tuning')
    const validation = runMatch({
      name: `tune-full-${String(multiplier).replace('.', '_')}x__${engine}__vs__${opponent}`,
      engine,
      opponent,
      scenario: 'battle-full',
      stage: 'tuning',
      pairs: options.smoke ? 1 : QUICK.tuningPairs,
      opening: QUICK.openings.tuning,
      engineMultiPv: 1,
      engineBudgetMultiplier: multiplier,
    })
    const candidate = { multiplier, multiPv: 1, summary: validation.summary }
    candidates.push(candidate)
    if (options.smoke || quickTargetReached(validation.summary) || validation.summary.scoreRate > eloToScore(QUICK.targetElo)) break
  }
  return closestCandidate(candidates)
}

function tuneHumanNodes(engine, opponent) {
  const candidates = []
  for (const multiplier of [2, 4]) {
    ensureTimeRemaining('human-node-tuning')
    const nodes = quickNodeBudget(HUMAN_BASE_NODES['human-l1'], multiplier)
    const validation = runMatch({
      name: `tune-human-l1-${String(multiplier).replace('.', '_')}x__${engine}__vs__${opponent}`,
      engine,
      opponent,
      scenario: 'human-l1',
      stage: 'tuning',
      pairs: options.smoke ? 1 : QUICK.tuningPairs,
      opening: QUICK.openings.tuning,
      engineNodes: nodes,
      opponentNodes: HUMAN_BASE_NODES['human-l1'],
    })
    candidates.push({ multiplier, nodes, summary: validation.summary })
    if (options.smoke || quickTargetReached(validation.summary)) break
  }
  if (candidates.length === 2 && candidates[0].summary.scoreRate < 0.5 && candidates[1].summary.scoreRate > 0.5) {
    const multiplier = Math.sqrt(candidates[0].multiplier * candidates[1].multiplier)
    const nodes = quickNodeBudget(HUMAN_BASE_NODES['human-l1'], multiplier)
    const validation = runMatch({
      name: `tune-human-l1-mid__${engine}__vs__${opponent}`,
      engine,
      opponent,
      scenario: 'human-l1',
      stage: 'tuning',
      pairs: options.smoke ? 1 : QUICK.tuningPairs,
      opening: QUICK.openings.tuning,
      engineNodes: nodes,
      opponentNodes: HUMAN_BASE_NODES['human-l1'],
    })
    candidates.push({ multiplier, nodes, summary: validation.summary })
  }
  return closestCandidate(candidates)
}

function runMatch({
  name, engine, opponent, scenario, stage, pairs, opening,
  engineMultiPv, engineBudgetMultiplier, engineNodes, opponentNodes,
}) {
  return runValidation(name, [
    '--operation', 'match',
    '--engine', engine,
    '--opponent', opponent,
    '--scenario', scenario,
    '--run-stage', stage,
    '--pairs', String(pairs),
    '--opening-offset', String(opening.offset),
    '--opening-primary-count', String(opening.count),
    '--backup-opening-offset', String(QUICK.openings.backup.offset),
    '--backup-opening-count', String(QUICK.openings.backup.count),
    ...(engineMultiPv ? ['--engine-multipv', String(engineMultiPv)] : []),
    ...(engineBudgetMultiplier ? ['--engine-budget-multiplier', String(engineBudgetMultiplier)] : []),
    ...(engineNodes ? ['--engine-nodes', String(engineNodes)] : []),
    ...(opponentNodes ? ['--opponent-nodes', String(opponentNodes)] : []),
  ])
}

function runLatencyCheck({ name, engine, opponent, scenario, nodes }) {
  return runValidation(name, [
    '--operation', 'latency-check',
    '--engine', engine,
    '--opponent', opponent,
    '--scenario', scenario,
    '--run-stage', 'tuning',
    '--pairs', '1',
    '--opening-offset', String(QUICK.openings.verificationHuman.offset),
    '--opening-primary-count', String(options.smoke ? 1 : 10),
    '--engine-nodes', String(nodes),
    '--latency-samples', String(options.smoke ? 1 : 10),
  ])
}

function runValidation(name, specificArguments) {
  ensureTimeRemaining(name)
  const output = resolve(outputRoot, `${name}.json`)
  runCommand([
    ...specificArguments,
    '--profile', 'desktop',
    '--evidence-tier', 'quick',
    '--quick-min-think-ms', String(options.quickMinThinkMs),
    '--quick-max-think-ms', String(options.quickMaxThinkMs),
    '--deadline-at-ms', String(deadlineAtMs),
    '--max-plies', '600',
    '--search-timeout-ms', '90000',
    '--seed', String(options.seed),
    '--output', output,
    ...(corpusStorageKey ? ['--corpus-storage-key', corpusStorageKey] : ['--corpus-url', corpusUrl]),
    ...connectionArguments(),
  ])
  const report = readJson(output)
  if (!report.validation || report.status !== 'passed') throw new Error(`${name} 浏览器校准失败。`)
  manifest.jobs.push({
    name,
    reportPath: output,
    durationMs: report.validation.durationMs,
    stage: report.validation.stage,
    summary: report.validation.summary,
    qualification: report.validation.qualification,
    checkpoint: report.validation.checkpoint,
  })
  return report.validation
}

function runCommand(argumentsList) {
  ensureTimeRemaining('command')
  const script = resolve(process.cwd(), 'scripts', 'calibrate-xiangqi-strength.mjs')
  const child = spawnSync(process.execPath, [script, ...argumentsList], { stdio: 'inherit', env: process.env })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`校准子命令退出码：${child.status}`)
}

function determineReference(summaries) {
  const uniqueLeader = ENGINE_IDS.find((engineId) => relevantSummaries(summaries, engineId).every((summary) => {
    const [low] = orientedInterval(summary, engineId)
    return low !== null && low > 0
  })) ?? null
  if (uniqueLeader) return referenceConclusion('unique-leader', uniqueLeader, [uniqueLeader], summaries)
  const nonLosing = ENGINE_IDS.filter((engineId) => relevantSummaries(summaries, engineId)
    .every((summary) => scoreForEngine(summary, engineId) >= 0.5))
  if (nonLosing.length === 1) return referenceConclusion('provisional-reference', nonLosing[0], nonLosing, summaries)
  const leaders = nonLosing.length > 1 ? nonLosing : ENGINE_IDS.filter((engineId) => relevantSummaries(summaries, engineId)
    .every((summary) => {
      const [, high] = orientedInterval(summary, engineId)
      return high === null || high >= 0
    }))
  return {
    status: leaders.length > 1 ? 'shared-lead' : 'unresolved',
    uniqueLeader: null,
    referenceEngineId: null,
    leaders,
    weakerEngineIds: [],
    note: '快速样本未识别可用于自动增强的单一参考引擎，未强行指定冠军。',
  }
}

function referenceConclusion(status, referenceEngineId, leaders, summaries) {
  const weakerEngineIds = ENGINE_IDS.filter((engineId) => engineId !== referenceEngineId &&
    scoreForEngine(summaries.find((summary) => includesPair(summary, engineId, referenceEngineId)), engineId) < eloToScore(-50))
  return {
    status,
    uniqueLeader: status === 'unique-leader' ? referenceEngineId : null,
    referenceEngineId,
    leaders,
    weakerEngineIds,
    note: status === 'unique-leader'
      ? '参考引擎对另外两个引擎的快速多重校正 95% Elo 下界均大于 0。'
      : '参考引擎仅为快速点估计下的暂定不败者；不构成正式最强结论。',
  }
}

function buildOverrides(full, fullAssessment, human, humanAssessment, fullVerification, humanVerification) {
  const overrides = {}
  if (full && fullAssessment && fullAssessment.status !== 'unchanged') {
    const status = fullAssessment.status
    const battleTimes = quickTimes(12_000, 18_000, full.multiplier, 55_000)
    const masterTimes = quickTimes(25_000, 60_000, full.multiplier, 60_000)
    overrides['battle-full'] = resourceOverride(battleTimes, undefined, 1, status, fullVerification.summary.eloInterval95)
    overrides['human-l5'] = resourceOverride(masterTimes, undefined, 1, status, fullVerification.summary.eloInterval95)
  }
  if (human && humanAssessment && humanAssessment.status !== 'unchanged') {
    for (const [scenario, baseNodes] of Object.entries(HUMAN_BASE_NODES)) {
      overrides[scenario] = resourceOverride(null, quickNodeBudget(baseNodes, human.multiplier), undefined,
        humanAssessment.status, humanVerification.summary.eloInterval95)
    }
  }
  return overrides
}

function resourceOverride(times, maxNodes, multiPv, calibrationStatus, eloInterval95) {
  return {
    ...(times ? { minThinkMs: times[0], maxThinkMs: times[1] } : {}),
    ...(maxNodes ? { maxNodes } : {}),
    ...(multiPv ? { multiPv } : {}),
    calibrationStatus,
    eloInterval95: finiteInterval(eloInterval95) ? eloInterval95 : null,
  }
}

function assessCandidate(summary, baselineScoreRate, latencyPassed) {
  const intervalContainsZero = intervalContains(summary.eloInterval95, 0)
  const eloWithinTarget = summary.eloDifference !== null && Math.abs(summary.eloDifference) <= QUICK.targetElo
  const runtimeClean = summary.technicalFailures === 0 && summary.timeouts === 0 && summary.moveLimits === 0 &&
    summary.invalidPairs === 0 && latencyPassed
  const quickMatched = runtimeClean && eloWithinTarget && intervalContainsZero
  const improved = runtimeClean && summary.scoreRate - baselineScoreRate >= QUICK.minimumImprovement
  return {
    status: quickMatched ? 'provisional' : improved ? 'unmatched' : 'unchanged',
    quickMatched,
    improved,
    runtimeClean,
    eloWithinTarget,
    intervalContainsZero,
    note: quickMatched
      ? '快速独立样本未发现超过 ±50 Elo 的点估计差距；不构成正式等强认证。'
      : improved
        ? '相对基线有所改善但仍未快速拉齐，保持 unmatched。'
        : '未复现足够改善，保留原生产配置。',
  }
}

function shouldExtend(summary, currentPairs, maxPairs) {
  return currentPairs < maxPairs && summary?.pairs >= currentPairs && intervalContains(summary.eloInterval95, 0)
}

function quickTargetReached(summary) {
  return summary?.eloDifference !== null && Math.abs(summary.eloDifference) <= QUICK.targetElo &&
    intervalContains(summary.eloInterval95, 0)
}

function closestCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    const leftDistance = left.summary.eloDifference === null ? Number.POSITIVE_INFINITY : Math.abs(left.summary.eloDifference)
    const rightDistance = right.summary.eloDifference === null ? Number.POSITIVE_INFINITY : Math.abs(right.summary.eloDifference)
    return leftDistance - rightDistance || left.multiplier - right.multiplier
  })[0] ?? null
}

function scoreForEngine(summary, engineId) {
  if (!summary) return 0.5
  return summary.engineId === engineId ? summary.scoreRate : 1 - summary.scoreRate
}

function relevantSummaries(summaries, engineId) {
  return summaries.filter((summary) => summary.engineId === engineId || summary.opponentId === engineId)
}

function includesPair(summary, first, second) {
  return summary && new Set([summary.engineId, summary.opponentId]).has(first) &&
    new Set([summary.engineId, summary.opponentId]).has(second)
}

function orientedInterval(summary, engineId) {
  if (summary.engineId === engineId) return summary.eloInterval95
  return [summary.eloInterval95[1] === null ? null : -summary.eloInterval95[1],
    summary.eloInterval95[0] === null ? null : -summary.eloInterval95[0]]
}

function intervalContains(interval, value) {
  return !interval || interval[0] === null || interval[1] === null || (interval[0] <= value && interval[1] >= value)
}

function finiteInterval(interval) {
  return Array.isArray(interval) && interval.length === 2 && interval.every(Number.isFinite)
}

function eloToScore(elo) {
  return 1 / (1 + 10 ** (-elo / 400))
}

function quickNodeBudget(baseNodes, multiplier) {
  return Math.min(5_000_000, Math.ceil((baseNodes * multiplier) / 10_000) * 10_000)
}

function quickTimes(minThinkMs, maxThinkMs, multiplier, capMs) {
  const minimum = Math.min(capMs, Math.round(minThinkMs * multiplier))
  const maximum = Math.min(capMs, Math.round(maxThinkMs * multiplier))
  return [Math.min(minimum, maximum), maximum]
}

function verificationPairTarget() {
  if (options.smoke) return 1
  return deadlineAtMs - Date.now() > 45 * 60_000 ? QUICK.extendedVerificationPairs : QUICK.verificationPairs
}

function compactValidation(validation) {
  return validation ? {
    durationMs: validation.durationMs,
    stage: validation.stage,
    summary: validation.summary,
    qualification: validation.qualification,
    checkpoint: validation.checkpoint,
  } : null
}

function ensureTimeRemaining(stage) {
  if (Date.now() >= deadlineAtMs) throw new Error(`wall-clock-limit:${stage}`)
}

function connectionArguments() {
  return ['--cdp-url', options.cdpUrl, '--preview-url', options.previewUrl]
}

function writeGameEvidence(path) {
  const seen = new Set()
  const lines = []
  for (const job of manifest.jobs) {
    const report = readJson(job.reportPath)
    for (const game of report.validation?.games ?? []) {
      const key = `${job.name}:${game.pairId}:${game.gameIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(JSON.stringify({
        schema: 'project10-xiangqi-quick-game-evidence-v1',
        evidenceTier: 'quick',
        configuration: report.validation.configuration,
        game,
      }))
    }
  }
  writeFileSync(path, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8')
}

function parseArguments(args) {
  const values = {
    cdpUrl: 'http://127.0.0.1:9222',
    previewUrl: 'http://127.0.0.1:4173',
    maxPairs: QUICK.maxPairs,
    wallClockMinutes: 360,
    quickMinThinkMs: QUICK.proxyMinThinkMs,
    quickMaxThinkMs: QUICK.proxyMaxThinkMs,
    generationNodes: 5_000,
    seed: 0x6d2b79f5,
    output: null,
    corpusStorageKey: null,
    corpusUrl: null,
    apply: false,
    smoke: false,
    help: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') { values.help = true; continue }
    if (argument === '--apply') { values.apply = true; continue }
    if (argument === '--smoke') { values.smoke = true; continue }
    const [name, inlineValue] = argument.split(/=(.*)/s, 2)
    const value = inlineValue ?? args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值`)
    if (name === '--cdp-url') values.cdpUrl = value
    else if (name === '--preview-url') values.previewUrl = value
    else if (name === '--max-pairs') values.maxPairs = integer(value, name, 1, 50)
    else if (name === '--wall-clock-minutes') values.wallClockMinutes = integer(value, name, 1, 360)
    else if (name === '--quick-min-think-ms') values.quickMinThinkMs = integer(value, name, 50, 5_000)
    else if (name === '--quick-max-think-ms') values.quickMaxThinkMs = integer(value, name, 50, 5_000)
    else if (name === '--generation-nodes') values.generationNodes = integer(value, name, 1_000, 5_000_000)
    else if (name === '--seed') values.seed = integer(value, name, 1, 0xffff_ffff)
    else if (name === '--output') values.output = value
    else if (name === '--corpus-storage-key') values.corpusStorageKey = value
    else if (name === '--corpus-url') values.corpusUrl = value
    else throw new Error(`快速校准未知参数：${argument}`)
  }
  if (values.quickMaxThinkMs < values.quickMinThinkMs) throw new Error('快速最大搜索时间不得小于最小搜索时间。')
  if (values.corpusStorageKey && values.corpusUrl) throw new Error('语料只能指定 IndexedDB 键或 URL 之一。')
  return values
}

function integer(value, label, min, max) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} 必须是整数。`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} 必须在 ${min}–${max} 之间。`)
  return parsed
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function printHelp() {
  process.stdout.write(
    'Usage: node scripts/calibrate-xiangqi-strength.mjs --quick [options]\n\n' +
    '  --max-pairs <n>             每组基线最多 50 个换色对\n' +
    '  --wall-clock-minutes <n>    硬上限，最多 360 分钟\n' +
    '  --quick-min-think-ms <n>    压缩代理最小时间，默认 200\n' +
    '  --quick-max-think-ms <n>    压缩代理最大时间，默认 300\n' +
    '  --apply                     完整复测后写入桌面快速覆盖文件\n' +
    '  --smoke                     每个阶段只跑 1 个换色对\n' +
    '  --output <directory>        报告目录\n',
  )
}
