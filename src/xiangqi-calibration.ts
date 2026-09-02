import type { EngineAdapter } from './engine/adapter'
import {
  FAIRY_STOCKFISH_ENGINE_ID,
  PIKAFISH_ENGINE_ID,
} from './engine/config'
import { difficultyThinkTime, mapDifficultyToEngine, type DifficultyLevel } from './engine/difficulty'
import { engineRegistry } from './engine/default-registry'
import { selectOpening, type RedOpeningFamily } from './engine/openings'
import { selectSearchMultiPv } from './engine/search-policy'
import { detectEngineSupport } from './engine/support'
import { matchUcciMove } from './engine/ucci'
import type { EngineProfile } from './game/types'
import {
  createCalibrationSchedule,
  openingCorpusSha256,
  pairCalibrationResults,
  formalQualification,
  passesLatencyGate,
  percentile95,
  selectXiangqiDifficultyMove,
  serializePosition,
  mirrorUcci,
  summarizeCalibration,
  telemetryFromSearch,
  validateOpeningCorpus,
  winnerForResult,
  XiangqiGameEngine,
  XIANGQI_CALIBRATION_ENGINE_IDS,
  XIANGQI_CALIBRATION_TARGETS,
  xiangqiCalibratedResource,
  xiangqiDifficultyProfile,
  type CalibrationGameResult,
  type CalibrationEvidenceTier,
  type CalibrationRunStage,
  type CalibrationScheduleEntry,
  type CalibrationSummary,
  type XiangqiCalibrationOpening,
  type XiangqiCalibrationOpeningCorpus,
  type XiangqiCalibrationScenario,
  type XiangqiResourceProfileId,
} from './games/xiangqi'

type CalibrationOperation = 'match' | 'generate-corpus' | 'latency-check'

interface CalibrationLatencySample {
  openingId: string
  scenario: XiangqiCalibrationScenario
  engineId: string
  elapsedMs: number
  nodes: number
  requestedNodes?: number
  requestedBudgetMs: number
}

interface CalibrationPageResult {
  schema: 'project10-xiangqi-calibration-page-v2'
  state: 'running' | 'passed' | 'failed'
  status: 'running' | 'passed' | 'failed'
  stage: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  configuration: {
    operation: CalibrationOperation
    engineId: string
    opponentEngineId: string
    pairCount: number
    scenario: XiangqiCalibrationScenario
    runStage: CalibrationRunStage
    evidenceTier: CalibrationEvidenceTier
    resourceProfile: XiangqiResourceProfileId
    maxPlies: number
    threads: number
    hashMb: number
    seed: number
    corpusUrl: string | null
    corpusStorageKey: string | null
    openingCorpusSha256: string | null
    openingOffset: number
    candidateOverrides: Record<string, {
      maxNodes?: number
      budgetMs?: number
      budgetMultiplier?: number
      multiPv?: 1 | 2 | 3 | 4
    }>
    quickProxy: { minThinkMs: number; maxThinkMs: number } | null
    deadlineEpochMs: number | null
    profile: EngineProfile | null
    opponentProfile: EngineProfile | null
    engines: Record<string, {
      version: string
      commit: string
      protocol: 'UCCI' | 'UCI'
      nnueSha256: string
      wasmSha256: string
    }>
  }
  games: CalibrationGameResult[]
  summary: CalibrationSummary | null
  qualification: {
    status: 'provisional' | 'validated' | 'unmatched'
    latencyP95Ms: number | null
    latencyLimitMs: number
    latencyPassed: boolean
    note: string
  } | null
  corpus?: XiangqiCalibrationOpeningCorpus
  latencySamples?: CalibrationLatencySample[]
  timeBudget: {
    deadlineEpochMs: number | null
    reached: boolean
    remainingMs: number | null
    stopReason: 'wall-clock-limit' | null
  }
  checkpoint: { key: string; completedPairs: number; attempts: number }
  error?: string
}

declare global {
  interface Window {
    __AI_XIANGQI_CALIBRATION__?: CalibrationPageResult
  }
}

const params = new URLSearchParams(window.location.search)
const operation = enumQuery('operation', ['match', 'generate-corpus', 'latency-check'] as const, 'match')
const engineId = params.get('engine') ?? PIKAFISH_ENGINE_ID
const opponentEngineId = params.get('opponent') ?? FAIRY_STOCKFISH_ENGINE_ID
const pairCount = integerQuery('pairs', 20, 1, XIANGQI_CALIBRATION_TARGETS.formalPairs)
const scenario = enumQuery(
  'scenario',
  ['battle-full', 'human-l1', 'human-l2', 'human-l3', 'human-l4', 'human-l5'] as const,
  'battle-full',
)
const runStage = enumQuery('run-stage', ['baseline', 'tuning', 'formal'] as const, 'baseline')
const evidenceTier = enumQuery('evidence-tier', ['standard', 'quick'] as const, 'standard')
const resourceProfile = enumQuery('resource-profile', ['constrained', 'desktop'] as const, 'constrained')
const maxPlies = integerQuery('max-plies', XIANGQI_CALIBRATION_TARGETS.maxPlies, 20, XIANGQI_CALIBRATION_TARGETS.maxPlies)
const searchTimeoutMs = integerQuery('search-timeout-ms', 90_000, 1_000, 300_000)
const seed = integerQuery('seed', 0x6d2b79f5, 1, 0xffff_ffff)
const corpusUrl = params.get('corpus-url')
const corpusStorageKey = params.get('corpus-storage-key')
const openingOffset = integerQuery('opening-offset', runStage === 'formal' ? 200 : 0, 0, 1_500)
const generationCount = integerQuery('opening-count', 800, 1, 2_000)
const generationNodes = integerQuery('generation-nodes', 10_000, 1_000, 5_000_000)
const balanceCentipawns = integerQuery('balance-cp', 300, 50, 2_000)
const engineNodes = optionalIntegerQuery('engine-nodes', 1_000, XIANGQI_CALIBRATION_TARGETS.maxNodes)
const opponentNodes = optionalIntegerQuery('opponent-nodes', 1_000, XIANGQI_CALIBRATION_TARGETS.maxNodes)
const engineBudgetMs = optionalIntegerQuery('engine-budget-ms', 50, 60_000)
const opponentBudgetMs = optionalIntegerQuery('opponent-budget-ms', 50, 60_000)
const forceMultiPv = optionalIntegerQuery('force-multipv', 1, 4) as 1 | 2 | 3 | 4 | undefined
const engineMultiPv = optionalIntegerQuery('engine-multipv', 1, 4) as 1 | 2 | 3 | 4 | undefined
const opponentMultiPv = optionalIntegerQuery('opponent-multipv', 1, 4) as 1 | 2 | 3 | 4 | undefined
const engineBudgetMultiplier = optionalNumberQuery('engine-budget-multiplier', 1, 3)
const opponentBudgetMultiplier = optionalNumberQuery('opponent-budget-multiplier', 1, 3)
const quickMinThinkMs = integerQuery('quick-min-think-ms', 200, 50, 5_000)
const quickMaxThinkMs = integerQuery('quick-max-think-ms', 300, quickMinThinkMs, 5_000)
const deadlineEpochMs = optionalIntegerQuery('deadline-at-ms', 1, Number.MAX_SAFE_INTEGER)
const openingPrimaryCount = optionalIntegerQuery('opening-primary-count', 1, 2_000)
const backupOpeningOffset = optionalIntegerQuery('backup-opening-offset', 0, 2_000)
const backupOpeningCount = optionalIntegerQuery('backup-opening-count', 1, 2_000)
const latencySampleCount = integerQuery('latency-samples', 10, 1, 100)
const output = requiredElement<HTMLPreElement>('calibration-output')
const startedAtMs = performance.now()
const profileResources = resourceProfile === 'desktop'
  ? { threads: 2, hashMb: 128 }
  : { threads: 1, hashMb: 64 }
const checkpointKey = [
  operation, engineId, opponentEngineId, scenario, runStage, evidenceTier, resourceProfile,
  evidenceTier === 'quick' ? 'adaptive' : pairCount, seed,
  corpusUrl ?? corpusStorageKey ?? 'built-in', openingOffset, openingPrimaryCount ?? '-', backupOpeningOffset ?? '-',
  backupOpeningCount ?? '-', maxPlies, engineNodes ?? '-', opponentNodes ?? '-', engineBudgetMs ?? '-',
  opponentBudgetMs ?? '-', engineBudgetMultiplier ?? '-', opponentBudgetMultiplier ?? '-',
  engineMultiPv ?? forceMultiPv ?? '-', opponentMultiPv ?? forceMultiPv ?? '-', quickMinThinkMs, quickMaxThinkMs,
].join(':')

const result: CalibrationPageResult = {
  schema: 'project10-xiangqi-calibration-page-v2',
  state: 'running',
  status: 'running',
  stage: 'page-loaded',
  startedAt: new Date().toISOString(),
  configuration: {
    operation,
    engineId,
    opponentEngineId,
    pairCount,
    scenario,
    runStage,
    evidenceTier,
    resourceProfile,
    maxPlies,
    threads: profileResources.threads,
    hashMb: profileResources.hashMb,
    seed,
    corpusUrl,
    corpusStorageKey,
    openingCorpusSha256: null,
    openingOffset,
    candidateOverrides: {
      [engineId]: {
        maxNodes: engineNodes,
        budgetMs: engineBudgetMs,
        budgetMultiplier: engineBudgetMultiplier,
        multiPv: engineMultiPv ?? forceMultiPv,
      },
      [opponentEngineId]: {
        maxNodes: opponentNodes,
        budgetMs: opponentBudgetMs,
        budgetMultiplier: opponentBudgetMultiplier,
        multiPv: opponentMultiPv ?? forceMultiPv,
      },
    },
    quickProxy: evidenceTier === 'quick' ? { minThinkMs: quickMinThinkMs, maxThinkMs: quickMaxThinkMs } : null,
    deadlineEpochMs: deadlineEpochMs ?? null,
    profile: null,
    opponentProfile: null,
    engines: {},
  },
  games: [],
  summary: null,
  qualification: null,
  timeBudget: {
    deadlineEpochMs: deadlineEpochMs ?? null,
    reached: false,
    remainingMs: deadlineEpochMs === undefined ? null : Math.max(0, deadlineEpochMs - Date.now()),
    stopReason: null,
  },
  checkpoint: { key: checkpointKey, completedPairs: 0, attempts: 0 },
}

window.__AI_XIANGQI_CALIBRATION__ = result
render()
void run()

async function run(): Promise<void> {
  const clients = new Map<string, EngineAdapter>()
  try {
    const support = detectEngineSupport()
    if (!support.supported) throw new Error(support.reason ?? '当前浏览器不支持专业引擎。')
    result.stage = 'initializing-engines'
    render()
    const requestedIds = operation === 'generate-corpus'
      ? [...XIANGQI_CALIBRATION_ENGINE_IDS]
      : operation === 'latency-check'
        ? [engineId]
        : [engineId, opponentEngineId]
    if (operation === 'match' && new Set(requestedIds).size !== requestedIds.length) {
      throw new Error('校准必须选择两个不同的引擎配置。')
    }
    for (const id of requestedIds) {
      const config = engineRegistry.getEngine('xiangqi', id)
      if (!config) throw new Error(`引擎不在中国象棋 Registry 中：${id}`)
      result.configuration.engines[id] = {
        version: config.version,
        commit: config.commit,
        protocol: config.protocol,
        nnueSha256: config.nnueSha256,
        wasmSha256: config.wasmSha256,
      }
      const client = createClient(id)
      clients.set(id, client)
      const profile = await client.init()
      if (id === engineId) result.configuration.profile = profile
      if (id === opponentEngineId) result.configuration.opponentProfile = profile
      result.stage = `engine-ready:${id}`
      render()
    }
    if (operation === 'generate-corpus') {
      result.corpus = await generateOpeningCorpus(clients)
      result.configuration.openingCorpusSha256 = result.corpus.sha256
      result.configuration.corpusStorageKey = await writeCorpus(result.corpus)
      result.stage = 'corpus-generated'
      setStatus('passed')
      return
    }
    if (operation === 'latency-check') {
      await runLatencyCheck(clients)
      return
    }
    await runMatch(clients)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.stage = 'failed'
    setStatus('failed')
  } finally {
    for (const client of clients.values()) client.dispose()
    result.finishedAt = new Date().toISOString()
    result.durationMs = Math.round(performance.now() - startedAtMs)
    render()
  }
}

async function runMatch(clients: ReadonlyMap<string, EngineAdapter>): Promise<void> {
  if (evidenceTier === 'quick' && resourceProfile !== 'desktop') {
    throw new Error('快速工程校准只允许 desktop（2 线程 / 128 MB）资源画像。')
  }
  if (evidenceTier === 'quick' && !corpusUrl && !corpusStorageKey) {
    throw new Error('快速工程校准必须使用已冻结的 220 局面语料。')
  }
  if (evidenceTier === 'quick' && runStage === 'formal') {
    throw new Error('快速证据不能进入 formal 正式认证阶段。')
  }
  if (runStage === 'tuning' && pairCount > XIANGQI_CALIBRATION_TARGETS.tuningPairs) {
    throw new Error(`调参阶段不得超过 ${XIANGQI_CALIBRATION_TARGETS.tuningPairs} 个换色对。`)
  }
  if (runStage === 'formal' && openingOffset < XIANGQI_CALIBRATION_TARGETS.tuningPairs) {
    throw new Error('正式认证必须从开局偏移 200 之后开始，避免复用调参样本。')
  }
  const requestedMultiPv = [engineMultiPv ?? forceMultiPv, opponentMultiPv ?? forceMultiPv]
    .filter((value): value is 1 | 2 | 3 | 4 => value !== undefined)
  if (requestedMultiPv.some((value) => value !== 1)) {
    throw new Error('只增强校准只允许把满强度场景切换为 MultiPV 1。')
  }
  if (requestedMultiPv.length > 0 && scenario !== 'battle-full' && scenario !== 'human-l5') {
    throw new Error('真人 VS AI 等级 1–4 必须保留当前 MultiPV 与候选扰动策略。')
  }
  if (runStage !== 'baseline' && (scenario === 'battle-full' || scenario === 'human-l5') &&
    (engineNodes !== undefined || opponentNodes !== undefined)) {
    throw new Error('大师级与引擎大战只允许使用 MultiPV 1 和时间增强，不使用节点调参。')
  }
  if (runStage !== 'baseline' && scenario !== 'battle-full' && scenario !== 'human-l5' &&
    (engineBudgetMs !== undefined || opponentBudgetMs !== undefined)) {
    throw new Error('真人 VS AI 等级 1–4 只允许增加 maxNodes。')
  }
  const openings = await loadOpenings()
  const checkpoint = await readCheckpoint(checkpointKey)
  if (checkpoint?.games) result.games = checkpoint.games
  result.checkpoint.attempts = checkpoint?.attempts ?? 0
  const completedPairIndices = new Set(pairCalibrationResults(result.games, engineId)
    .filter((pair) => pair.valid).map((pair) => pair.pairIndex))
  result.checkpoint.completedPairs = completedPairIndices.size
  const openingIds = openings.map((opening) => opening.id)
  const schedule = createCalibrationSchedule(engineId, opponentEngineId, pairCount, seed, openingIds.slice(0, pairCount))
  const pairs = Array.from({ length: pairCount }, (_, index) => schedule.slice(index * 2, index * 2 + 2))
  let openingCursor = 0
  const acceptedOpenings = new Set(result.games.filter((game) => game.openingId).map((game) => game.openingId as string))
  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    if (completedPairIndices.has(pairIndex)) continue
    if (deadlineReached()) {
      markDeadlineReached()
      break
    }
    let accepted = false
    while (!accepted) {
      const opening = openings[openingCursor]
      if (!opening) throw new Error('备用开局已耗尽，无法替换失效换色对。')
      openingCursor += 1
      if (acceptedOpenings.has(opening.id)) continue
      const attempt = result.checkpoint.attempts + 1
      result.checkpoint.attempts = attempt
      const entries = remapPairOpening(pairs[pairIndex], opening, attempt)
      result.stage = `pair-${pairIndex + 1}-of-${pairCount}:attempt-${attempt}`
      render()
      const pairGames: CalibrationGameResult[] = []
      for (const entry of entries) {
        const red = clients.get(entry.redEngineId)
        const black = clients.get(entry.blackEngineId)
        if (!red || !black) throw new Error('换色对缺少已初始化引擎。')
        red.newGame()
        black.newGame()
        pairGames.push(await playGame(red, black, entry, opening))
      }
      result.games.push(...pairGames)
      const paired = pairCalibrationResults(pairGames, engineId)[0]
      accepted = Boolean(paired?.valid)
      if (accepted) {
        acceptedOpenings.add(opening.id)
        result.checkpoint.completedPairs += 1
      }
      await writeCheckpoint(checkpointKey, { games: result.games, attempts: result.checkpoint.attempts })
      updateSummaryAndQualification()
      updateTimeBudget()
      render()
    }
  }
  const summary = updateSummaryAndQualification()
  result.stage = result.timeBudget.reached ? 'wall-clock-limit' : 'completed'
  setStatus(summary.invalidPairs === 0 && summary.technicalFailures === 0 ? 'passed' : 'failed')
}

async function runLatencyCheck(clients: ReadonlyMap<string, EngineAdapter>): Promise<void> {
  if (evidenceTier === 'quick' && resourceProfile !== 'desktop') {
    throw new Error('快速延迟检查只允许 desktop 资源画像。')
  }
  const client = clients.get(engineId)
  if (!client) throw new Error(`延迟检查缺少引擎：${engineId}`)
  const openings = await loadOpenings()
  const samples: CalibrationLatencySample[] = []
  const game = new XiangqiGameEngine()
  for (const opening of openings.slice(0, latencySampleCount)) {
    if (deadlineReached()) {
      markDeadlineReached()
      break
    }
    let state = game.initializeGame()
    for (const ucci of opening.moves) {
      const move = game.findLegalActionByUcci(state, ucci)
      if (!move) throw new Error(`延迟样本 ${opening.id} 包含非法着法：${ucci}`)
      state = game.executeAction(state, move)
    }
    client.newGame()
    const plan = searchPlan(engineId, state, opening.generationSeed, 20 * 60_000)
    const started = performance.now()
    const response = await client.search(
      state.history.map((record) => record.ucci),
      Math.min(plan.budgetMs, searchTimeoutMs),
      { multiPv: plan.multiPv, maxNodes: plan.maxNodes, maxDepth: plan.maxDepth },
    )
    const elapsedMs = Math.max(response.info.elapsedMs, performance.now() - started)
    samples.push({
      openingId: opening.id,
      scenario,
      engineId,
      elapsedMs,
      nodes: response.info.nodes,
      requestedNodes: plan.maxNodes,
      requestedBudgetMs: plan.budgetMs,
    })
    result.stage = `latency-sample-${samples.length}-of-${latencySampleCount}`
    result.latencySamples = samples
    updateTimeBudget()
    render()
  }
  const elapsed = samples.map((sample) => sample.elapsedMs)
  const latencyP95Ms = percentile95(elapsed)
  const latencyLimitMs = scenario === 'battle-full'
    ? 55_000
    : xiangqiCalibratedResource(engineId, scenario, resourceProfile).latencyLimitMs
  result.qualification = {
    status: 'provisional',
    latencyP95Ms,
    latencyLimitMs,
    latencyPassed: passesLatencyGate(scenario, elapsed),
    note: evidenceTier === 'quick'
      ? '快速固定局面延迟门槛只用于 provisional/unmatched 参数筛选。'
      : '固定局面延迟检查不构成棋力认证。',
  }
  result.stage = result.timeBudget.reached ? 'wall-clock-limit' : 'latency-completed'
  setStatus('passed')
}

function updateSummaryAndQualification(): CalibrationSummary {
  result.summary = summarizeCalibration(result.games, engineId, opponentEngineId)
  const elapsed = result.games.flatMap((game) =>
    game.telemetry?.filter((step) => step.engineId === engineId).map((step) => step.elapsedMs) ?? [])
  const latencyP95Ms = percentile95(elapsed)
  const latencyLimitMs = scenario === 'battle-full'
    ? 55_000
    : xiangqiCalibratedResource(engineId, scenario, resourceProfile).latencyLimitMs
  const latencyPassed = passesLatencyGate(scenario, elapsed)
  const status = runStage === 'formal' && evidenceTier !== 'quick'
    ? formalQualification(result.summary, latencyPassed)
    : 'provisional'
  result.qualification = {
    status,
    latencyP95Ms,
    latencyLimitMs,
    latencyPassed,
    note: runStage === 'formal' && evidenceTier !== 'quick'
      ? status === 'validated'
        ? '正式独立样本通过 ±30 Elo、运行稳定性和 P95 延迟门槛。'
        : '正式样本未通过全部门槛；不得写入 validated 或发布虚构 Elo。'
      : evidenceTier === 'quick'
        ? '快速工程证据只能用于 provisional/unmatched，不能写入 validated。'
        : '基线和调参样本不用于最终认证。',
  }
  return result.summary
}

async function playGame(
  red: EngineAdapter,
  black: EngineAdapter,
  entry: CalibrationScheduleEntry & { attempt: number },
  opening: XiangqiCalibrationOpening,
): Promise<CalibrationGameResult> {
  const game = new XiangqiGameEngine()
  let state = game.initializeGame()
  const telemetry: NonNullable<CalibrationGameResult['telemetry']>[number][] = []
  const clocks = { red: 20 * 60_000, black: 20 * 60_000 }
  try {
    for (const ucci of opening.moves) {
      const move = game.findLegalActionByUcci(state, ucci)
      if (!move) throw new Error(`开局 ${opening.id} 包含非法着法：${ucci}`)
      state = game.executeAction(state, move)
    }
    while (!state.result && state.history.length < maxPlies) {
      const adapter = state.turn === 'red' ? red : black
      const plan = searchPlan(adapter.config.id, state, entry.decisionSeed, clocks[state.turn])
      const started = performance.now()
      const response = await adapter.search(
        state.history.map((record) => record.ucci),
        Math.min(plan.budgetMs, searchTimeoutMs),
        { multiPv: plan.multiPv, maxNodes: plan.maxNodes, maxDepth: plan.maxDepth },
      )
      const elapsed = Math.max(response.info.elapsedMs, performance.now() - started)
      clocks[state.turn] -= elapsed
      telemetry.push(telemetryFromSearch(
        state.history.length,
        adapter.config.id,
        plan.budgetMs,
        plan.multiPv,
        response.info,
        response.bestmove,
        plan.maxNodes,
      ))
      if (clocks[state.turn] <= 0 || elapsed > 60_000) {
        return gameEvidence(entry, opening, state.history.map((record) => record.ucci), telemetry, 'technical', 'timeout',
          `搜索或总棋钟超时：${Math.round(elapsed)} ms`)
      }
      const selected = plan.profile
        ? selectXiangqiDifficultyMove(response, plan.profile, decisionSeed(entry.decisionSeed, state.history.length))
        : { ucci: response.bestmove, info: response.info }
      if (!selected.ucci) throw new Error('引擎未返回 bestmove。')
      const move = matchUcciMove(state.board, [...game.getLegalActions(state)], selected.ucci)
      if (!move) throw new Error(`引擎返回非法着法：${selected.ucci}`)
      state = game.executeAction(state, move)
    }
    if (!state.result) {
      return gameEvidence(entry, opening, state.history.map((record) => record.ucci), telemetry, 'technical', 'move-limit',
        `达到 ${maxPlies} 半回合仍未自然终局。`)
    }
    return gameEvidence(entry, opening, state.history.map((record) => record.ucci), telemetry,
      winnerForResult(state.result), state.result.reason)
  } catch (error) {
    return gameEvidence(entry, opening, state.history.map((record) => record.ucci), telemetry, 'technical', 'technical',
      error instanceof Error ? error.message : String(error))
  }
}

function searchPlan(
  id: string,
  state: ReturnType<XiangqiGameEngine['initializeGame']>,
  pairSeed: number,
  remainingMs: number,
): {
  budgetMs: number
  multiPv: 1 | 2 | 3 | 4
  maxNodes?: number
  maxDepth?: number
  profile?: ReturnType<typeof xiangqiDifficultyProfile>
} {
  if (scenario !== 'battle-full') {
    const level = Number(scenario.at(-1)) as DifficultyLevel
    const profile = xiangqiDifficultyProfile(id, level, resourceProfile)
    const config = engineRegistry.getEngine('xiangqi', id)
    if (!config) throw new Error(`未注册引擎：${id}`)
    const mapped = mapDifficultyToEngine(profile, config, profileResources)
    return applyCandidateOverride(id, {
      budgetMs: difficultyThinkTime(profile, decisionSeed(pairSeed, state.history.length)),
      multiPv: mapped.multiPv,
      maxNodes: mapped.maxNodes,
      maxDepth: mapped.maxDepth,
      profile,
    })
  }
  const calibrated = xiangqiCalibratedResource(id, 'battle-full', resourceProfile)
  const minThinkMs = evidenceTier === 'quick' ? quickMinThinkMs : calibrated.minThinkMs
  const maxThinkMs = evidenceTier === 'quick' ? quickMaxThinkMs : calibrated.maxThinkMs
  const span = maxThinkMs - minThinkMs + 1
  const preferred = minThinkMs + decisionSeed(pairSeed, state.history.length) % span
  const latencyLimitMs = evidenceTier === 'quick' ? 5_000 : calibrated.latencyLimitMs
  const budgetMs = Math.max(50, Math.min(preferred, latencyLimitMs, remainingMs - 5_000, 55_000))
  const multiPv = calibrated.multiPv === 'dynamic'
    ? selectSearchMultiPv({
        board: state.board,
        color: state.turn,
        historyLength: state.history.length,
        threads: profileResources.threads,
        hashMb: profileResources.hashMb,
        remainingTimeMs: remainingMs,
        turnBudgetMs: budgetMs,
      }).multiPv
    : calibrated.multiPv
  return applyCandidateOverride(id, { budgetMs, multiPv })
}

function applyCandidateOverride<T extends {
  budgetMs: number
  multiPv: 1 | 2 | 3 | 4
  maxNodes?: number
}>(id: string, plan: T): T {
  const override = result.configuration.candidateOverrides[id]
  if (!override) return plan
  if (override.maxNodes !== undefined && plan.maxNodes !== undefined && override.maxNodes < plan.maxNodes) {
    throw new Error(`只增强策略禁止把 ${id} 节点从 ${plan.maxNodes} 降为 ${override.maxNodes}。`)
  }
  if (override.budgetMs !== undefined && override.budgetMs < plan.budgetMs) {
    throw new Error(`只增强策略禁止把 ${id} 时间从 ${plan.budgetMs} ms 降为 ${override.budgetMs} ms。`)
  }
  const multipliedBudgetMs = override.budgetMultiplier === undefined
    ? plan.budgetMs
    : Math.round(plan.budgetMs * override.budgetMultiplier)
  if (multipliedBudgetMs < plan.budgetMs) throw new Error('只增强策略禁止使用小于 1 的时间乘数。')
  return {
    ...plan,
    maxNodes: override.maxNodes ?? plan.maxNodes,
    budgetMs: override.budgetMs ?? multipliedBudgetMs,
    multiPv: override.multiPv ?? plan.multiPv,
  }
}

async function loadOpenings(): Promise<readonly XiangqiCalibrationOpening[]> {
  if (!corpusUrl && !corpusStorageKey) {
    if (runStage === 'formal') throw new Error('正式校准必须通过 --corpus-url 指定已冻结的 500+ 开局语料。')
    result.configuration.openingCorpusSha256 = 'built-in-12-prefixes-nonformal'
    return Array.from({ length: Math.max(pairCount * 3, 12) }, (_, index) => {
      const selected = selectOpening(decisionSeed(seed, index))
      const game = new XiangqiGameEngine()
      let state = game.initializeGame()
      for (const ucci of selected.moves) {
        const move = game.findLegalActionByUcci(state, ucci)
        if (!move) throw new Error(`内置开局非法：${ucci}`)
        state = game.executeAction(state, move)
      }
      return {
        id: `${selected.id}-${index}`,
        family: selected.redFamily,
        moves: selected.moves,
        positionKey: serializePosition(state.board, state.turn),
        sourceEngines: [],
        generationSeed: decisionSeed(seed, index),
      }
    })
  }
  let corpus: XiangqiCalibrationOpeningCorpus
  if (corpusStorageKey) {
    const stored = await readCorpus(corpusStorageKey)
    if (!stored) throw new Error(`IndexedDB 中不存在开局语料：${corpusStorageKey}`)
    corpus = stored
  } else {
    const response = await fetch(new URL(corpusUrl as string, window.location.href))
    if (!response.ok) throw new Error(`无法读取开局语料（HTTP ${response.status}）。`)
    corpus = await response.json() as XiangqiCalibrationOpeningCorpus
  }
  const actualSha = await openingCorpusSha256(corpus)
  if (actualSha !== corpus.sha256) throw new Error('开局语料 SHA-256 与内容不一致。')
  const validation = validateOpeningCorpus(corpus, runStage === 'formal' ? 'formal' : evidenceTier === 'quick' ? 'quick' : false)
  if (!validation.valid) throw new Error(`开局语料校验失败：${validation.errors.slice(0, 5).join('；')}`)
  if (corpus.openings.length < openingOffset + pairCount) throw new Error('开局语料数量少于偏移后的换色对数。')
  result.configuration.openingCorpusSha256 = corpus.sha256
  if (openingPrimaryCount === undefined) return corpus.openings.slice(openingOffset)
  const primary = corpus.openings.slice(openingOffset, openingOffset + openingPrimaryCount)
  if (primary.length < pairCount) throw new Error('快速开局分区不足以覆盖目标换色对。')
  if (backupOpeningOffset === undefined || backupOpeningCount === undefined) return primary
  const backup = corpus.openings.slice(backupOpeningOffset, backupOpeningOffset + backupOpeningCount)
  const primaryIds = new Set(primary.map((opening) => opening.id))
  return [...primary, ...backup.filter((opening) => !primaryIds.has(opening.id))]
}

async function generateOpeningCorpus(clients: ReadonlyMap<string, EngineAdapter>): Promise<XiangqiCalibrationOpeningCorpus> {
  const openings: XiangqiCalibrationOpening[] = []
  const positions = new Set<string>()
  const sequences = new Set<string>()
  const mirroredSequences = new Set<string>()
  const maxAttempts = generationCount * 30
  const game = new XiangqiGameEngine()
  for (let attempt = 0; openings.length < generationCount && attempt < maxAttempts; attempt += 1) {
    result.stage = `generating-opening-${openings.length + 1}-attempt-${attempt + 1}`
    render()
    let state = game.initializeGame()
    for (const client of clients.values()) client.newGame()
    const openingSeed = decisionSeed(seed, attempt)
    const prefix = selectOpening(openingSeed)
    let rejected = false
    for (const ucci of prefix.moves) {
      const move = game.findLegalActionByUcci(state, ucci)
      if (!move) { rejected = true; break }
      state = game.executeAction(state, move)
    }
    const targetPlies = 8 + (openingSeed % 13)
    while (!rejected && !state.result && state.history.length < targetPlies) {
      const sourceId = XIANGQI_CALIBRATION_ENGINE_IDS[(attempt + state.history.length) % XIANGQI_CALIBRATION_ENGINE_IDS.length]
      const client = clients.get(sourceId)
      if (!client) throw new Error(`语料生成缺少引擎：${sourceId}`)
      const response = await client.search(state.history.map((record) => record.ucci), searchTimeoutMs, {
        multiPv: 4,
        maxNodes: generationNodes,
      })
      const candidates = response.candidates.filter((candidate) => candidate.pv[0]).sort((a, b) => a.multipv - b.multipv)
      const candidate = candidates[decisionSeed(openingSeed, state.history.length) % Math.max(1, candidates.length)]
      const ucci = candidate?.pv[0] ?? response.bestmove
      const move = ucci ? game.findLegalActionByUcci(state, ucci) : null
      if (!move) { rejected = true; break }
      state = game.executeAction(state, move)
    }
    if (rejected || state.result || state.checkColor || state.history.length < 8) continue
    const moves = state.history.map((record) => record.ucci)
    const sequence = moves.join(' ')
    const mirroredSequence = moves.map(mirrorUcci).join(' ')
    const positionKey = serializePosition(state.board, state.turn)
    if (positions.has(positionKey) || sequences.has(sequence) || mirroredSequences.has(sequence) || sequences.has(mirroredSequence)) continue
    const evaluations = []
    for (const sourceId of XIANGQI_CALIBRATION_ENGINE_IDS) {
      const client = clients.get(sourceId)
      if (!client) throw new Error(`语料筛选缺少引擎：${sourceId}`)
      const response = await client.search(moves, searchTimeoutMs, { multiPv: 1, maxNodes: generationNodes })
      evaluations.push(response.info.score)
    }
    if (evaluations.some((score) => score?.kind === 'mate')) continue
    const cps = evaluations.flatMap((score) => score?.kind === 'cp' ? [score.value] : [])
    const allClearlyUnbalanced = cps.length === 3 && cps.every((value) => Math.abs(value) > balanceCentipawns) &&
      cps.every((value) => Math.sign(value) === Math.sign(cps[0]))
    if (allClearlyUnbalanced) continue
    positions.add(positionKey)
    sequences.add(sequence)
    mirroredSequences.add(mirroredSequence)
    openings.push({
      id: `xqcal-${String(openings.length + 1).padStart(4, '0')}`,
      family: prefix.redFamily as RedOpeningFamily,
      moves,
      positionKey,
      sourceEngines: [...XIANGQI_CALIBRATION_ENGINE_IDS],
      generationSeed: openingSeed,
    })
  }
  if (openings.length < generationCount) throw new Error(`只生成 ${openings.length}/${generationCount} 个合格开局。`)
  const unsigned = {
    schema: 'project10-xiangqi-opening-corpus-v1' as const,
    status: 'frozen' as const,
    generatedAt: new Date().toISOString(),
    generator: {
      engineIds: [...XIANGQI_CALIBRATION_ENGINE_IDS],
      nodesPerMove: generationNodes,
      multiPv: 4,
      seed,
      balanceCentipawns,
    },
    openings,
  }
  const sha256 = await openingCorpusSha256(unsigned)
  const corpus = { ...unsigned, sha256 }
  const validation = validateOpeningCorpus(corpus,
    evidenceTier === 'quick' ? 'quick' : generationCount >= 500 ? 'formal' : false)
  if (!validation.valid) throw new Error(`生成语料未通过校验：${validation.errors.slice(0, 5).join('；')}`)
  return corpus
}

function gameEvidence(
  entry: CalibrationScheduleEntry & { attempt: number },
  opening: XiangqiCalibrationOpening,
  moves: readonly string[],
  telemetry: NonNullable<CalibrationGameResult['telemetry']>,
  outcome: CalibrationGameResult['outcome'],
  termination: NonNullable<CalibrationGameResult['termination']>,
  technicalError?: string,
): CalibrationGameResult {
  return {
    ...entry,
    attempt: entry.attempt,
    openingId: opening.id,
    openingCorpusSha256: result.configuration.openingCorpusSha256 ?? undefined,
    outcome,
    plies: moves.length,
    moves: [...moves],
    telemetry,
    termination,
    technicalError,
  }
}

function remapPairOpening(
  entries: readonly CalibrationScheduleEntry[],
  opening: XiangqiCalibrationOpening,
  attempt: number,
): readonly (CalibrationScheduleEntry & { attempt: number })[] {
  const pairId = `${entries[0].pairId}:opening:${opening.id}:attempt:${attempt}`
  return entries.map((entry) => ({ ...entry, pairId, openingId: opening.id, attempt }))
}

function createClient(id: string): EngineAdapter {
  return engineRegistry.createEngine('xiangqi', id, {
    assetBase: new URL('./', window.location.href).href,
    onProgress: () => render(),
    onRuntimeFatal: (error) => { result.error = `Worker fatal (${id}): ${error.message}` },
  }, { threads: profileResources.threads, hash: profileResources.hashMb })
}

function decisionSeed(base: number, index: number): number {
  let value = (base ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b)
  value ^= value >>> 13
  return value >>> 0
}

function deadlineReached(): boolean {
  return deadlineEpochMs !== undefined && Date.now() >= deadlineEpochMs
}

function updateTimeBudget(): void {
  result.timeBudget.remainingMs = deadlineEpochMs === undefined ? null : Math.max(0, deadlineEpochMs - Date.now())
}

function markDeadlineReached(): void {
  result.timeBudget.reached = true
  result.timeBudget.remainingMs = 0
  result.timeBudget.stopReason = 'wall-clock-limit'
}

function setStatus(status: 'passed' | 'failed'): void {
  result.state = status
  result.status = status
  render()
}

function render(): void {
  output.textContent = JSON.stringify(result, null, 2)
  window.__AI_XIANGQI_CALIBRATION__ = result
  window.__AI_XIANGQI_BROWSER_VALIDATION__ =
    result as unknown as NonNullable<Window['__AI_XIANGQI_BROWSER_VALIDATION__']>
}

function requiredElement<T extends Element>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`缺少页面元素：${id}`)
  return element as unknown as T
}

function integerQuery(name: string, fallback: number, min: number, max: number): number {
  const value = Number(params.get(name) ?? fallback)
  if (!Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

function optionalIntegerQuery(name: string, min: number, max: number): number | undefined {
  const raw = params.get(name)
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} 必须在 ${min}–${max} 之间。`)
  return value
}

function optionalNumberQuery(name: string, min: number, max: number): number | undefined {
  const raw = params.get(name)
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} 必须在 ${min}–${max} 之间。`)
  return value
}

function enumQuery<const T extends readonly string[]>(name: string, values: T, fallback: T[number]): T[number] {
  const value = params.get(name)
  return value && values.includes(value) ? value as T[number] : fallback
}

interface StoredCheckpoint { games: CalibrationGameResult[]; attempts: number }

async function readCheckpoint(key: string): Promise<StoredCheckpoint | null> {
  const database = await checkpointDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction('runs', 'readonly').objectStore('runs').get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function writeCheckpoint(key: string, value: StoredCheckpoint): Promise<void> {
  const database = await checkpointDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction('runs', 'readwrite').objectStore('runs').put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function writeCorpus(corpus: XiangqiCalibrationOpeningCorpus): Promise<string> {
  const key = `quick-corpus:${corpus.sha256}`
  const database = await checkpointDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction('corpora', 'readwrite').objectStore('corpora').put(corpus, key)
    request.onsuccess = () => resolve(key)
    request.onerror = () => reject(request.error)
  })
}

async function readCorpus(key: string): Promise<XiangqiCalibrationOpeningCorpus | null> {
  const database = await checkpointDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction('corpora', 'readonly').objectStore('corpora').get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
}

function checkpointDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('project10-xiangqi-calibration-v2', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('runs')) request.result.createObjectStore('runs')
      if (!request.result.objectStoreNames.contains('corpora')) request.result.createObjectStore('corpora')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
