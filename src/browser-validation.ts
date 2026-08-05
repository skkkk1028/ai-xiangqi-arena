import type { EngineAdapter } from './engine/adapter'
import { DEFAULT_ENGINE_ID, engineRegistry } from './engine/default-registry'
import { selectOpening } from './engine/openings'
import { selectPersonalityMove } from './engine/personality'
import { selectSearchMultiPv, type MultiPvCount } from './engine/search-policy'
import { detectEngineSupport } from './engine/support'
import { matchUcciMove } from './engine/ucci'
import { applyMove, createInitialBoard, opposite } from './game/board'
import { getLegalMoves } from './game/rules'
import type { BoardState, Color, EngineProfile } from './game/types'

type ValidationState = 'running' | 'passed' | 'failed'
type RunKind = 'long-run' | 'low-time-probe' | 'middlegame-policy-probe' | 'depth-probe' | 'pair-probe'

interface ValidationRun {
  index: number
  kind: RunKind
  multiPv: number
  policyReason: string
  requestedMs: number
  elapsedMs: number
  depth: number
  candidateRanks: number[]
  bestmove: string | null
  selected: string | null
  usedPersonality: boolean
  selectionReason: string | null
  error: string | null
}

interface BrowserValidationResult {
  state: ValidationState
  status: ValidationState
  stage: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  page: {
    href: string
    userAgent: string
    crossOriginIsolated: boolean
    sharedArrayBuffer: boolean
    deviceMemory?: number
  }
  configuration: {
    engineId: string
    opponentEngineId: string | null
    smokeMode: boolean
    requestedLongSearches: number
    longGameSearches: number
    requestedProbeMs: number
    profile: EngineProfile | null
    opponentProfile: EngineProfile | null
  }
  runs: ValidationRun[]
  runtimeErrors: string[]
  mainThread: {
    frames: number
    maxFrameGapMs: number
    timerTicks: number
    maxTimerDriftMs: number
  }
  summary?: {
    longRuns: number
    multiPvCounts: Record<string, number>
    timeouts: number
    rankCoverageFailures: number
    maxOverrunMs: number
    medianDepthByMultiPv: Record<string, number | null>
    depthDropTwoToThree: number | null
    depthDropTwoToFour: number | null
    assertions: Record<string, boolean>
  }
  error?: string
}

declare global {
  interface Window {
    __AI_XIANGQI_BROWSER_VALIDATION__?: BrowserValidationResult
  }
}

interface GameCursor {
  board: BoardState
  color: Color
  history: string[]
  seed: number
  remainingMs: Record<Color, number>
}

const SEARCH_MIN_MS = 12_000
const SEARCH_RANGE_MS = 6_001
const CLOCK_SAFETY_MS = 500
const TOTAL_TIME_MS = 20 * 60 * 1000
const TURN_TIME_MS = 60 * 1000
const CLIENT_SEARCH_GRACE_MS = 5_000
const MAIN_THREAD_MAX_GAP_MS = 1_000
const DEPTH_DROP_TWO_TO_THREE_MAX = 3
const DEPTH_DROP_TWO_TO_FOUR_MAX = 4

const output = requiredElement<HTMLPreElement>('validation-output')
const longSearches = integerQuery('long-searches', 48, 1, 500)
const longGameSearches = integerQuery('long-game-searches', 24, 1, 120)
const probeMs = integerQuery('probe-ms', 5_000, 1_000, 30_000)
const engineId = new URLSearchParams(window.location.search).get('engine') ?? DEFAULT_ENGINE_ID
const opponentEngineId = new URLSearchParams(window.location.search).get('opponent')
const smokeMode = new URLSearchParams(window.location.search).get('smoke') === '1'

const result: BrowserValidationResult = {
  state: 'running',
  status: 'running',
  stage: 'page-loaded',
  startedAt: new Date().toISOString(),
  page: {
    href: window.location.href,
    userAgent: navigator.userAgent,
    crossOriginIsolated: window.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  },
  configuration: {
    engineId,
    opponentEngineId,
    smokeMode,
    requestedLongSearches: longSearches,
    longGameSearches,
    requestedProbeMs: probeMs,
    profile: null,
    opponentProfile: null,
  },
  runs: [],
  runtimeErrors: [],
  mainThread: { frames: 0, maxFrameGapMs: 0, timerTicks: 0, maxTimerDriftMs: 0 },
}

window.__AI_XIANGQI_BROWSER_VALIDATION__ = result
render()

async function validate(): Promise<void> {
  const monitor = new MainThreadMonitor(result.mainThread)
  let client: EngineAdapter | null = null
  let opponentClient: EngineAdapter | null = null
  const started = performance.now()

  try {
    monitor.start()
    result.stage = 'main-thread-monitor-started'
    render()
    const support = detectEngineSupport()
    result.stage = 'support-checked'
    render()
    if (!support.supported) throw new Error(`Engine support unavailable: ${support.reason ?? 'unknown reason'}`)

    client = engineRegistry.createEngine(
      engineId,
      {
        assetBase: new URL('./', window.location.href).href,
        onProgress: () => render(),
        onRuntimeFatal: (error) => result.runtimeErrors.push(error.message),
      },
      { threads: support.threads, hash: support.hashMb },
    )
    result.stage = 'engine-initializing'
    render()
    result.configuration.profile = await client.init()
    result.stage = 'engine-ready'
    render()

    if (opponentEngineId) {
      if (opponentEngineId === engineId) throw new Error('Pair validation requires distinct engine ids')
      opponentClient = engineRegistry.createEngine(
        opponentEngineId,
        {
          assetBase: new URL('./', window.location.href).href,
          onProgress: () => render(),
          onRuntimeFatal: (error) => result.runtimeErrors.push(error.message),
        },
        { threads: support.threads, hash: support.hashMb },
      )
      result.stage = 'opponent-initializing'
      render()
      result.configuration.opponentProfile = await opponentClient.init()
      const pairCursor = createOpeningCursor(0x65c21f47)
      await runSearch(client, pairCursor, {
        kind: 'pair-probe',
        multiPv: 2,
        policyReason: `${engineId}-pair-move`,
        requestedMs: probeMs,
        usePersonality: false,
      })
      await runSearch(opponentClient, pairCursor, {
        kind: 'pair-probe',
        multiPv: 2,
        policyReason: `${opponentEngineId}-pair-reply`,
        requestedMs: probeMs,
        usePersonality: false,
      })
      result.stage = 'pair-probe-complete'
      render()
    }

    await runEqualTimeDepthProbes(client)
    result.stage = 'depth-probes-complete'
    if (smokeMode) {
      client.newGame()
      await runSearch(client, createOpeningCursor(0x41b7d2e3), {
        kind: 'depth-probe',
        multiPv: 3,
        policyReason: 'newgame-smoke-probe',
        requestedMs: probeMs,
        usePersonality: false,
      })
      result.stage = 'newgame-smoke-complete'
    } else {
      await runLongMatchSequence(client)
      result.stage = 'long-sequence-complete'
      await runMiddlegamePolicyProbe(client)
      result.stage = 'middlegame-policy-probe-complete'
      await runLowTimeProbe(client)
      result.stage = 'low-time-probe-complete'
    }

    result.summary = assess(result)
    const failed = Object.values(result.summary.assertions).some((passed) => !passed)
    setStatus(failed ? 'failed' : 'passed')
  } catch (error) {
    setStatus('failed')
    result.stage = 'failed'
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    client?.dispose()
    opponentClient?.dispose()
    monitor.stop()
    result.finishedAt = new Date().toISOString()
    if (result.state === 'passed') result.stage = 'completed'
    result.durationMs = Math.round(performance.now() - started)
    if (!result.summary) result.summary = assess(result)
    window.__AI_XIANGQI_BROWSER_VALIDATION__ = result
    render()
  }
}

async function runEqualTimeDepthProbes(client: EngineAdapter): Promise<void> {
  // Rotate 2/3/4 rather than always warming one MultiPV setting first.
  const order: MultiPvCount[] = [2, 4, 3, 3, 2, 4]
  for (let index = 0; index < order.length; index += 1) {
    // Every probe starts from the identical legal post-opening position. The
    // engine still receives a fresh `position` command for each measurement.
    await runSearch(client, createOpeningCursor(0x21c4a91d), {
      kind: 'depth-probe',
      multiPv: order[index],
      policyReason: 'equal-time-depth-probe',
      requestedMs: probeMs,
      usePersonality: false,
    })
  }
}

async function runLongMatchSequence(client: EngineAdapter): Promise<void> {
  let cursor = createOpeningCursor(0x8bc61f73)
  for (let index = 0; index < longSearches; index += 1) {
    if (index > 0 && index % longGameSearches === 0) {
      // Exercise the real Worker uccinewgame + readyok barrier before it accepts a search.
      client.newGame()
      cursor = createOpeningCursor((0x8bc61f73 + index * 0x9e3779b9) >>> 0)
    }
    const requestedMs = productionBudget(cursor.seed, cursor.remainingMs[cursor.color])
    const policy = selectSearchMultiPv({
      board: cursor.board,
      color: cursor.color,
      historyLength: cursor.history.length,
      threads: result.configuration.profile?.threads ?? 1,
      hashMb: result.configuration.profile?.hashMb ?? 64,
      remainingTimeMs: cursor.remainingMs[cursor.color],
      turnBudgetMs: requestedMs,
    })
    await runSearch(client, cursor, {
      kind: 'long-run',
      multiPv: policy.multiPv,
      policyReason: policy.reason,
      requestedMs,
      usePersonality: true,
    })
  }
}

async function runLowTimeProbe(client: EngineAdapter): Promise<void> {
  const cursor = createOpeningCursor(0xa3e176d9)
  const remainingMs = 30_000
  const requestedMs = productionBudget(cursor.seed, remainingMs)
  const policy = selectSearchMultiPv({
    board: cursor.board,
    color: cursor.color,
    historyLength: cursor.history.length,
    threads: result.configuration.profile?.threads ?? 1,
    hashMb: result.configuration.profile?.hashMb ?? 64,
    remainingTimeMs: remainingMs,
    turnBudgetMs: requestedMs,
  })
  await runSearch(client, cursor, {
    kind: 'low-time-probe',
    multiPv: policy.multiPv,
    policyReason: policy.reason,
    requestedMs,
    usePersonality: true,
  })
}

async function runMiddlegamePolicyProbe(client: EngineAdapter): Promise<void> {
  const cursor = createOpeningCursor(0x2f4a9d11)
  const requestedMs = productionBudget(cursor.seed, cursor.remainingMs[cursor.color])
  // The normal long sequence may legitimately turn tactical before ply 16 and
  // therefore select MPV 2. This controlled policy fixture holds a quiet,
  // legal post-opening board while supplying the normal middlegame phase
  // input, so Chromium also exercises the Worker transition to MPV 3.
  const policy = selectSearchMultiPv({
    board: cursor.board,
    color: cursor.color,
    historyLength: 16,
    threads: result.configuration.profile?.threads ?? 1,
    hashMb: result.configuration.profile?.hashMb ?? 64,
    remainingTimeMs: cursor.remainingMs[cursor.color],
    turnBudgetMs: requestedMs,
  })
  await runSearch(client, cursor, {
    kind: 'middlegame-policy-probe',
    multiPv: policy.multiPv,
    policyReason: policy.reason,
    requestedMs,
    usePersonality: true,
  })
}

async function runSearch(
  client: EngineAdapter,
  cursor: GameCursor,
  request: {
    kind: RunKind
    multiPv: MultiPvCount
    policyReason: string
    requestedMs: number
    usePersonality: boolean
  },
): Promise<void> {
  const started = performance.now()
  const run: ValidationRun = {
    index: result.runs.length + 1,
    kind: request.kind,
    multiPv: request.multiPv,
    policyReason: request.policyReason,
    requestedMs: request.requestedMs,
    elapsedMs: 0,
    depth: 0,
    candidateRanks: [],
    bestmove: null,
    selected: null,
    usedPersonality: false,
    selectionReason: null,
    error: null,
  }

  try {
    const response = await client.search(cursor.history, request.requestedMs, { multiPv: request.multiPv })
    run.elapsedMs = Math.round(performance.now() - started)
    run.depth = response.info.depth
    run.candidateRanks = response.candidates.map((candidate) => candidate.multipv).sort((a, b) => a - b)
    run.bestmove = response.bestmove

    const legalMoves = getLegalMoves(cursor.board, cursor.color)
    const decision = request.usePersonality
      ? selectPersonalityMove({
          board: cursor.board,
          color: cursor.color,
          legalMoves,
          bestmove: response.bestmove,
          bestInfo: response.info,
          candidates: response.candidates,
          seed: cursor.seed,
        })
      : {
          ucci: response.bestmove,
          usedPersonality: false,
          reason: 'engine-best',
        }
    run.selected = decision.ucci
    run.usedPersonality = decision.usedPersonality
    run.selectionReason = decision.reason

    const move = decision.ucci ? matchUcciMove(cursor.board, legalMoves, decision.ucci) : null
    if (!move) throw new Error(`Engine returned an illegal or empty move: ${decision.ucci ?? response.bestmove}`)
    cursor.board = applyMove(cursor.board, move)
    cursor.history.push(decision.ucci!)
    cursor.color = opposite(cursor.color)
    cursor.seed = (cursor.seed + 0x9e3779b9 + cursor.history.length * 97) >>> 0
    cursor.remainingMs[opposite(cursor.color)] = Math.max(
      0,
      cursor.remainingMs[opposite(cursor.color)] - run.elapsedMs,
    )
  } catch (error) {
    run.elapsedMs = Math.round(performance.now() - started)
    run.error = error instanceof Error ? error.message : String(error)
  }

  result.runs.push(run)
  render()
  if (run.error) throw new Error(run.error)
}

function createOpeningCursor(seed: number): GameCursor {
  const opening = selectOpening(seed)
  let board = createInitialBoard()
  let color: Color = 'red'
  const history: string[] = []
  for (const ucci of opening.moves) {
    const move = matchUcciMove(board, getLegalMoves(board, color), ucci)
    if (!move) throw new Error(`Opening ${opening.id} became illegal at ${ucci}`)
    board = applyMove(board, move)
    color = opposite(color)
    history.push(ucci)
  }
  return {
    board,
    color,
    history,
    seed,
    remainingMs: { red: TOTAL_TIME_MS, black: TOTAL_TIME_MS },
  }
}

function productionBudget(seed: number, remainingMs: number): number {
  const preferred = SEARCH_MIN_MS + (seed % SEARCH_RANGE_MS)
  const lowTimeBudget = remainingMs < 45_000 ? Math.min(5_000, remainingMs - CLOCK_SAFETY_MS) : preferred
  return Math.max(50, Math.min(preferred, lowTimeBudget, remainingMs - CLOCK_SAFETY_MS, TURN_TIME_MS - CLOCK_SAFETY_MS))
}

function assess(current: BrowserValidationResult): NonNullable<BrowserValidationResult['summary']> {
  const runs = current.runs
  const longRuns = runs.filter((run) => run.kind === 'long-run')
  const multiPvCounts: Record<string, number> = {}
  const byMultiPv = new Map<number, number[]>()
  let timeouts = 0
  let rankCoverageFailures = 0
  let maxOverrunMs = 0
  for (const run of runs) {
    multiPvCounts[String(run.multiPv)] = (multiPvCounts[String(run.multiPv)] ?? 0) + 1
    if (run.error || run.elapsedMs > run.requestedMs + CLIENT_SEARCH_GRACE_MS) timeouts += 1
    maxOverrunMs = Math.max(maxOverrunMs, run.elapsedMs - run.requestedMs)
    const expected = Array.from({ length: run.multiPv }, (_, index) => index + 1)
    if (expected.some((rank) => !run.candidateRanks.includes(rank))) rankCoverageFailures += 1
    if (run.kind === 'depth-probe' && run.depth > 0) {
      const depths = byMultiPv.get(run.multiPv) ?? []
      depths.push(run.depth)
      byMultiPv.set(run.multiPv, depths)
    }
  }
  const medianDepthByMultiPv: Record<string, number | null> = {
    '2': median(byMultiPv.get(2) ?? []),
    '3': median(byMultiPv.get(3) ?? []),
    '4': median(byMultiPv.get(4) ?? []),
  }
  const two = medianDepthByMultiPv['2']
  const three = medianDepthByMultiPv['3']
  const four = medianDepthByMultiPv['4']
  const depthDropTwoToThree = two !== null && three !== null ? two - three : null
  const depthDropTwoToFour = two !== null && four !== null ? two - four : null

  return {
    longRuns: longRuns.length,
    multiPvCounts,
    timeouts,
    rankCoverageFailures,
    maxOverrunMs,
    medianDepthByMultiPv,
    depthDropTwoToThree,
    depthDropTwoToFour,
    assertions: {
      supported: current.page.crossOriginIsolated && current.page.sharedArrayBuffer,
      desktopProfile: current.configuration.smokeMode
        ? Boolean(current.configuration.profile)
        : current.configuration.profile?.threads === 2 && current.configuration.profile.hashMb === 128,
      longRunCompleted: current.configuration.smokeMode
        ? true
        : longRuns.length === current.configuration.requestedLongSearches,
      dynamicMultiPvCovered:
        current.configuration.smokeMode
          ? [2, 3, 4].every((rank) => runs.some((run) => run.multiPv === rank))
          : longRuns.some((run) => run.policyReason === 'opening' && run.multiPv === 4) &&
            runs.some(
              (run) =>
                run.kind === 'middlegame-policy-probe' &&
                run.policyReason === 'middlegame' &&
                run.multiPv === 3,
            ) &&
            runs.some((run) => run.kind === 'low-time-probe' && run.policyReason === 'low-time' && run.multiPv === 2),
      noWorkerOrSearchError: current.runtimeErrors.length === 0 && !current.error && runs.every((run) => !run.error),
      noSearchTimeout: timeouts === 0,
      allRequestedRanksReturned: rankCoverageFailures === 0,
      mainThreadResponsive:
        current.mainThread.frames > 0 &&
        current.mainThread.maxFrameGapMs <= MAIN_THREAD_MAX_GAP_MS &&
        current.mainThread.maxTimerDriftMs <= MAIN_THREAD_MAX_GAP_MS,
      depthReported: runs.every((run) => run.depth > 0),
      multiPvThreeDepthStable:
        depthDropTwoToThree !== null && depthDropTwoToThree <= DEPTH_DROP_TWO_TO_THREE_MAX,
      multiPvFourDepthStable:
        depthDropTwoToFour !== null && depthDropTwoToFour <= DEPTH_DROP_TWO_TO_FOUR_MAX,
    },
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

function integerQuery(name: string, fallback: number, min: number, max: number): number {
  const value = Number(new URLSearchParams(window.location.search).get(name))
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function requiredElement<T extends Element>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as unknown as T
}

function render(): void {
  output.textContent = JSON.stringify(window.__AI_XIANGQI_BROWSER_VALIDATION__, null, 2)
}

function setStatus(status: ValidationState): void {
  result.state = status
  result.status = status
}

class MainThreadMonitor {
  private frameId: number | null = null
  private intervalId: number | null = null
  private lastFrameMs = 0
  private lastTickMs = 0

  constructor(private readonly metrics: BrowserValidationResult['mainThread']) {}

  start(): void {
    this.lastFrameMs = performance.now()
    this.lastTickMs = this.lastFrameMs
    const frame = (now: number) => {
      this.metrics.frames += 1
      this.metrics.maxFrameGapMs = Math.max(this.metrics.maxFrameGapMs, now - this.lastFrameMs)
      this.lastFrameMs = now
      this.frameId = window.requestAnimationFrame(frame)
    }
    this.frameId = window.requestAnimationFrame(frame)
    this.intervalId = window.setInterval(() => {
      const now = performance.now()
      this.metrics.timerTicks += 1
      this.metrics.maxTimerDriftMs = Math.max(this.metrics.maxTimerDriftMs, Math.max(0, now - this.lastTickMs - 100))
      this.lastTickMs = now
    }, 100)
  }

  stop(): void {
    if (this.frameId !== null) window.cancelAnimationFrame(this.frameId)
    if (this.intervalId !== null) window.clearInterval(this.intervalId)
    this.frameId = null
    this.intervalId = null
  }
}

// `MainThreadMonitor` is a class declaration, so start only after its binding
// has been initialized. Invoking the async harness above the class would leave
// an unhandled TDZ rejection before it can publish a useful failure result.
void validate()
