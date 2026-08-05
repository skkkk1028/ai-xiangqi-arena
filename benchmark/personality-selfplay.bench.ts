import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OPENING_PREFIXES } from '../src/engine/openings'
import { AI_PERSONALITIES, PERSONALITY_RUNTIME, selectPersonalityMove } from '../src/engine/personality'
import { selectSearchMultiPv } from '../src/engine/search-policy'
import { matchUcciMove, moveToUcci, parseBestmove, parseInfoLine } from '../src/engine/ucci'
import { applyMove, createInitialBoard, opposite, positionKey } from '../src/game/board'
import {
  getSimplifiedDrawReason,
  RESIGN_STREAK,
  TOTAL_TIME_MS,
  TURN_TIME_MS,
  updateResignationStreak,
} from '../src/game/adjudication'
import { getLegalMoves, isInCheck } from '../src/game/rules'
import type {
  BoardState,
  Color,
  EngineProfile,
  EngineScore,
  SearchCandidate,
  SearchCandidateSnapshot,
  SearchInfo,
  SearchResponse,
  Wdl,
} from '../src/game/types'

/**
 * Whole-game candidate-selection A/B harness.
 *
 * This deliberately starts every game after the same four-ply joint opening
 * prefix.  The project book encodes red and black replies together, so it
 * cannot attribute book strength to one side.  The test therefore measures
 * post-book candidate selection only; see `limitations` in the JSON report.
 */

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const networkName = 'xiangqi-c07e94a5c7cb.nnue'
const expectedNetworkSha256 = 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11'
const reportPath = resolve(projectRoot, 'benchmark', 'personality-selfplay-result.json')

type ControlId = 'product-baseline' | 'attribution-baseline'
type AgentMode = 'personality' | ControlId
type GameStatus = 'completed' | 'incomplete' | 'technical'
type GameReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'no-capture'
  | 'resignation'
  | 'clock-timeout'
  | 'ply-limit'
  | 'engine-timeout'
  | 'illegal-engine-move'
  | 'technical'

interface EngineModule {
  FS: { writeFile(path: string, data: Uint8Array): void }
  addMessageListener(listener: (line: unknown) => void): void
  postMessage(command: string): void
  terminate(): void
}

interface HarnessConfig {
  pairs: number
  maxPlies: number
  moveMs: number
  moveJitterMs: number
  totalTimeMs: number
  turnTimeMs: number
  threads: number
  hashMb: number
  searchGraceMs: number
  seed: number
  nonInferiorityMargin: number | null
  minPairsForInference: number | null
}

interface ValidatedOpening {
  id: string
  moves: string[]
}

interface SideStats {
  searches: number
  engineTimeouts: number
  illegalMoves: number
  technicalFailures: number
  totalEngineWallMs: number
  totalTurnWallMs: number
  totalEngineReportedMs: number
  totalDepth: number
  minDepth: number | null
  maxDepth: number | null
  multiPv: Record<'1' | '2' | '3' | '4', number>
  personalityCalls: number
  personalityChanges: number
  selectionReasons: Record<'personality' | 'forced-best' | 'insufficient-safe-candidates', number>
}

interface SearchTrace {
  ply: number
  positionKey: string
  color: Color
  agent: AgentMode
  multiPv: number
  multiPvReason: string
  budgetMs: number
  seed: number
  clocksBeforeMs: Record<Color, number>
  clocksAfterMs: Record<Color, number>
  wallElapsedMs: number
  engineElapsedMs: number
  depth: number
  bestmove: string | null
  selected: string | null
  selectedInfo: SearchInfo
  candidates: SearchCandidate[]
  selection: {
    usedPersonality: boolean
    reason: 'personality' | 'forced-best' | 'insufficient-safe-candidates' | 'engine-best'
    phase: string | null
    thresholdCp: number | null
  }
}

interface GameOutcome {
  id: string
  comparison: ControlId
  pairIndex: number
  leg: 'personality-red' | 'personality-black'
  opening: ValidatedOpening
  agents: Record<Color, AgentMode>
  personalityColor: Color
  initialSeed: number
  status: GameStatus
  reason: GameReason
  winner: Color | null
  plies: number
  history: string[]
  elapsedMs: number
  error: string | null
  sideStats: Record<Color, SideStats>
  traces: SearchTrace[]
}

interface PairOutcome {
  id: string
  comparison: ControlId
  pairIndex: number
  opening: ValidatedOpening
  gameIds: [string, string]
  status: 'scored' | 'incomplete'
  personalityPoints: number | null
  baselinePoints: number | null
  perGameScoreDifference: number | null
}

interface TimedSearch {
  response: SearchResponse
  wallElapsedMs: number
}

interface EngineAssetVerification {
  packageVersion: string
  networkSha256: string
  expectedNetworkSha256: string
  networkSha256MatchesExpected: boolean
  wasmSha256: string
  nnueEnabledLogObserved: boolean
}

interface RunIntegrity {
  expectedGames: number
  observedGames: number
  nnueLogConfirmed: boolean
  validatedOpenings: number
  technicalGames: number
  illegalMoves: number
  engineTimeouts: number
  passed: boolean
}

interface Waiter {
  predicate: (line: string) => boolean
  resolve: (line: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Engine command timed out after ${timeoutMs} ms: ${command}`)
    this.name = 'CommandTimeoutError'
  }
}

class EngineSearchTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineSearchTimeoutError'
  }
}

const config: HarnessConfig = {
  // Defaults are intentionally a smoke-sized run.  Production-like time
  // controls are opt-in through the documented environment variables.
  pairs: readPositiveInteger('PERSONALITY_SELFPLAY_PAIRS', 1),
  maxPlies: readPositiveInteger('PERSONALITY_SELFPLAY_MAX_PLIES', 180, 4),
  moveMs: readPositiveInteger('PERSONALITY_SELFPLAY_MOVE_MS', 250, 50),
  moveJitterMs: readPositiveInteger('PERSONALITY_SELFPLAY_MOVE_JITTER_MS', 1, 1),
  totalTimeMs: readPositiveInteger('PERSONALITY_SELFPLAY_TOTAL_TIME_MS', TOTAL_TIME_MS, 1_000),
  turnTimeMs: readPositiveInteger('PERSONALITY_SELFPLAY_TURN_TIME_MS', TURN_TIME_MS, 100),
  threads: readPositiveInteger('PERSONALITY_SELFPLAY_THREADS', 1),
  hashMb: readPositiveInteger('PERSONALITY_SELFPLAY_HASH_MB', 128),
  searchGraceMs: readPositiveInteger('PERSONALITY_SELFPLAY_SEARCH_GRACE_MS', 5_000, 100),
  seed: readNonNegativeInteger('PERSONALITY_SELFPLAY_SEED', 0x20260801),
  nonInferiorityMargin: readOptionalNonNegativeNumber('PERSONALITY_SELFPLAY_NONINFERIORITY_MARGIN'),
  minPairsForInference: readOptionalPositiveInteger('PERSONALITY_SELFPLAY_MIN_PAIRS_FOR_INFERENCE'),
}

const controls: Array<{ id: ControlId; label: string }> = [
  {
    id: 'product-baseline',
    label: 'product baseline: MultiPV 1 plus engine bestmove',
  },
  {
    id: 'attribution-baseline',
    label: 'attribution baseline: dynamic MultiPV plus engine bestmove',
  },
]

class SelfPlayEngine {
  private module!: EngineModule
  private currentMultiPv = 1
  private searchLines: string[] | null = null
  private readonly waiters: Waiter[] = []
  private verification!: Omit<EngineAssetVerification, 'nnueEnabledLogObserved'>
  private nnueEnabledLogObserved = false
  private classicalEvaluationLogObserved = false

  async init(): Promise<EngineProfile> {
    const savedFetch = globalThis.fetch
    // Emscripten's Node loader needs direct filesystem access to the local WASM binary.
    // @ts-expect-error Intentionally hidden while loading the CommonJS engine module.
    globalThis.fetch = undefined
    try {
      const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js') as (
        options?: Record<string, unknown>,
      ) => Promise<EngineModule>
      this.module = await Stockfish({
        locateFile: (filename: string) =>
          resolve(projectRoot, 'node_modules', 'fairy-stockfish-nnue.wasm', filename),
      })
    } finally {
      globalThis.fetch = savedFetch
    }
    this.module.addMessageListener((raw) => this.handleLine(String(raw).trim()))

    await this.commandAndWait('ucci', (line) => line === 'ucciok')
    const network = readFileSync(resolve(projectRoot, 'public', 'engine', networkName))
    const networkSha256 = sha256(network)
    if (networkSha256 !== expectedNetworkSha256) {
      throw new Error(
        `NNUE SHA-256 mismatch: expected ${expectedNetworkSha256}, received ${networkSha256}`,
      )
    }
    const enginePackage = JSON.parse(
      readFileSync(
        resolve(projectRoot, 'node_modules', 'fairy-stockfish-nnue.wasm', 'package.json'),
        'utf8',
      ),
    ) as { version?: unknown }
    const packageVersion = typeof enginePackage.version === 'string' ? enginePackage.version : 'unknown'
    const wasmSha256 = sha256(
      readFileSync(resolve(projectRoot, 'node_modules', 'fairy-stockfish-nnue.wasm', 'stockfish.wasm')),
    )
    this.verification = {
      packageVersion,
      networkSha256,
      expectedNetworkSha256,
      networkSha256MatchesExpected: true,
      wasmSha256,
    }
    this.module.FS.writeFile(`/${networkName}`, network)
    ;[
      `setoption Threads ${config.threads}`,
      `setoption hashsize ${config.hashMb}`,
      'setoption Ponder false',
      'setoption MultiPV 1',
      'setoption Skill_Level 20',
      'setoption UCI_LimitStrength false',
      'setoption UCI_ShowWDL true',
      'setoption Use_NNUE true',
      `setoption EvalFile /${networkName}`,
      'setoption usemillisec true',
    ].forEach((command) => this.module.postMessage(command))
    await this.commandAndWait('isready', (line) => line === 'readyok')
    return {
      name: 'Fairy-Stockfish NNUE via UCCI',
      version: `fairy-stockfish-nnue.wasm@${packageVersion}`,
      commit: 'not independently verified by this harness',
      network: networkName,
      networkSha256,
      threads: config.threads,
      hashMb: config.hashMb,
    }
  }

  isNnueConfirmed(): boolean {
    return this.nnueEnabledLogObserved && !this.classicalEvaluationLogObserved
  }

  assetVerification(): EngineAssetVerification {
    return {
      ...this.verification,
      nnueEnabledLogObserved: this.isNnueConfirmed(),
    }
  }

  async newGame(): Promise<void> {
    this.module.postMessage('uccinewgame')
    // Reset only between games.  In-game hash use remains persistent, matching
    // the production worker's alternating-red/black search model.
    this.module.postMessage('setoption name Clear Hash')
    await this.commandAndWait('isready', (line) => line === 'readyok')
  }

  async search(history: string[], multiPv: number, movetimeMs: number): Promise<TimedSearch> {
    if (multiPv !== this.currentMultiPv) {
      this.module.postMessage(`setoption MultiPV ${multiPv}`)
      this.currentMultiPv = multiPv
    }
    this.searchLines = []
    this.module.postMessage(`position startpos${history.length ? ` moves ${history.join(' ')}` : ''}`)
    const startedAt = Date.now()
    let bestLine: string
    let lines: string[] = []
    try {
      bestLine = await this.commandAndWait(
        `go movetime ${movetimeMs}`,
        (line) => parseBestmove(line) !== undefined,
        movetimeMs + config.searchGraceMs,
      )
    } catch (error) {
      if (error instanceof CommandTimeoutError) {
        try {
          await this.commandAndWait(
            'stop',
            (line) => parseBestmove(line) !== undefined,
            config.searchGraceMs,
          )
        } catch {
          // The timed-out search is reported to the game result below.
        }
        throw new EngineSearchTimeoutError(error.message)
      }
      throw error
    } finally {
      // This avoids stale info lines from a later search contaminating the
      // just-completed candidate set, including after a timeout/stop sequence.
      lines = this.searchLines ?? []
      this.searchLines = null
    }
    const candidates = collectCandidates(lines ?? [])
    return {
      response: {
        bestmove: parseBestmove(bestLine) ?? null,
        info: candidates.find((candidate) => candidate.multipv === 1) ?? emptyInfo(),
        candidates,
      },
      wallElapsedMs: Date.now() - startedAt,
    }
  }

  close(): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeout)
      waiter.reject(new Error('Engine closed before completing a command.'))
    }
    this.module?.terminate()
  }

  private commandAndWait(
    command: string,
    predicate: (line: string) => boolean,
    timeoutMs = 30_000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new CommandTimeoutError(command, timeoutMs))
        }, timeoutMs),
      }
      this.waiters.push(waiter)
      this.module.postMessage(command)
    })
  }

  private handleLine(line: string): void {
    if (!line) return
    if (/NNUE evaluation using .* enabled/i.test(line)) this.nnueEnabledLogObserved = true
    if (/classical evaluation enabled/i.test(line)) this.classicalEvaluationLogObserved = true
    this.searchLines?.push(line)
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index]
      if (!waiter.predicate(line)) continue
      this.waiters.splice(index, 1)
      clearTimeout(waiter.timeout)
      waiter.resolve(line)
    }
  }
}

describe('personality on/off whole-game candidate-selection A/B', () => {
  const engine = new SelfPlayEngine()
  let profile: EngineProfile
  let openings: ValidatedOpening[]

  beforeAll(async () => {
    openings = validateOpenings()
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          purpose: 'fixed-opening, color-swapped personality on/off whole-game candidate-selection A/B',
          run: { state: 'initializing', integrity: 'not-yet-evaluated' },
          config,
        },
        null,
        2,
      )}\n`,
    )
    profile = await engine.init()
  })

  afterAll(() => engine.close())

  it('runs fixed-opening, color-swapped games and writes an auditable report', async () => {
    const startedAt = Date.now()
    const games: GameOutcome[] = []
    const pairs: PairOutcome[] = []
    const writeCheckpoint = (state: 'running' | 'completed') => {
      const integrity = evaluateIntegrity(engine, openings, games)
      const report = buildReport(
        profile,
        engine.assetVerification(),
        openings,
        games,
        pairs,
        Date.now() - startedAt,
        state,
        integrity,
      )
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
      return integrity
    }

    for (const control of controls) {
      for (let pairIndex = 0; pairIndex < config.pairs; pairIndex += 1) {
        const opening = openings[pairIndex % openings.length]
        const initialSeed = mixSeed(config.seed, pairIndex)
        const personalityRed = await playGame(engine, {
          control: control.id,
          pairIndex,
          opening,
          initialSeed,
          red: 'personality',
          black: control.id,
        })
        const personalityBlack = await playGame(engine, {
          control: control.id,
          pairIndex,
          opening,
          initialSeed,
          red: control.id,
          black: 'personality',
        })
        games.push(personalityRed, personalityBlack)
        pairs.push(makePairOutcome(control.id, pairIndex, opening, personalityRed, personalityBlack))
        writeCheckpoint('running')
        console.log(
          `[personality-selfplay] ${control.id} pair ${pairIndex + 1}/${config.pairs} ` +
            `${personalityRed.status}/${personalityBlack.status}`,
        )
      }
    }

    const integrity = writeCheckpoint('completed')
    console.log(`[personality-selfplay-report] ${reportPath}`)

    expect(integrity.passed).toBe(true)
  })
})

async function playGame(
  engine: SelfPlayEngine,
  plan: {
    control: ControlId
    pairIndex: number
    opening: ValidatedOpening
    initialSeed: number
    red: AgentMode
    black: AgentMode
  },
): Promise<GameOutcome> {
  const startedAt = Date.now()
  let board = createInitialBoard()
  let turn: Color = 'red'
  let seed = plan.initialSeed
  let history: string[] = []
  let noCapturePlies = 0
  const repetitions = new Map<string, number>([[positionKey(board, turn), 1]])
  const clocks: Record<Color, number> = { red: config.totalTimeMs, black: config.totalTimeMs }
  const resignation: Record<Color, number> = { red: 0, black: 0 }
  const sideStats: Record<Color, SideStats> = { red: createSideStats(), black: createSideStats() }
  const traces: SearchTrace[] = []
  const personalityColor: Color = plan.red === 'personality' ? 'red' : 'black'

  const finish = (
    status: GameStatus,
    reason: GameReason,
    winner: Color | null,
    error: string | null = null,
  ): GameOutcome => ({
    id: `${plan.control}-${plan.pairIndex + 1}-${personalityColor}`,
    comparison: plan.control,
    pairIndex: plan.pairIndex,
    leg: personalityColor === 'red' ? 'personality-red' : 'personality-black',
    opening: { id: plan.opening.id, moves: [...plan.opening.moves] },
    agents: { red: plan.red, black: plan.black },
    personalityColor,
    initialSeed: plan.initialSeed,
    status,
    reason,
    winner,
    plies: history.length,
    history: [...history],
    elapsedMs: Date.now() - startedAt,
    error,
    sideStats,
    traces,
  })

  try {
    await engine.newGame()
  } catch (error) {
    sideStats.red.technicalFailures += 1
    return finish('technical', 'technical', null, errorMessage(error))
  }

  for (const ucci of plan.opening.moves) {
    const legalMoves = getLegalMoves(board, turn)
    const move = matchUcciMove(board, legalMoves, ucci)
    if (!move) {
      sideStats[turn].technicalFailures += 1
      return finish('technical', 'technical', null, `Opening move is not legal: ${ucci}`)
    }
    history.push(ucci)
    board = applyMove(board, move)
    turn = opposite(turn)
    noCapturePlies = move.captured ? 0 : noCapturePlies + 1
    seed = nextProductSeed(seed, history.length)
    const key = positionKey(board, turn)
    repetitions.set(key, (repetitions.get(key) ?? 0) + 1)
  }

  for (let ply = history.length; ply < config.maxPlies; ply += 1) {
    const turnStartedAt = Date.now()
    const legalMoves = getLegalMoves(board, turn)
    if (legalMoves.length === 0) {
      return finish('completed', isInCheck(board, turn) ? 'checkmate' : 'stalemate', opposite(turn))
    }
    if (clocks[turn] <= 0) return finish('completed', 'clock-timeout', opposite(turn))

    const agent = turn === 'red' ? plan.red : plan.black
    const budgetMs = budgetForTurn(seed, clocks[turn])
    const clocksBeforeMs = { ...clocks }
    const policy = selectPolicy(agent, board, turn, history.length, clocks[turn], budgetMs)
    const stat = sideStats[turn]
    let timed: TimedSearch
    try {
      timed = await engine.search(history, policy.multiPv, budgetMs)
    } catch (error) {
      clocks[turn] -= Date.now() - turnStartedAt
      stat.technicalFailures += 1
      if (error instanceof EngineSearchTimeoutError) stat.engineTimeouts += 1
      return finish(
        'technical',
        error instanceof EngineSearchTimeoutError ? 'engine-timeout' : 'technical',
        null,
        errorMessage(error),
      )
    }

    const response = timed.response
    let selected = response.bestmove
    let selectedInfo = response.info
    let selection: SearchTrace['selection'] = {
      usedPersonality: false,
      reason: 'engine-best',
      phase: null,
      thresholdCp: null,
    }

    if (agent === 'personality') {
      stat.personalityCalls += 1
      const decision = selectPersonalityMove({
        board,
        color: turn,
        legalMoves,
        bestmove: response.bestmove,
        bestInfo: response.info,
        candidates: response.candidates,
        seed,
      })
      selected = decision.ucci
      selectedInfo = decision.info
      selection = {
        usedPersonality: decision.usedPersonality,
        reason: decision.reason,
        phase: decision.phase,
        thresholdCp: decision.thresholdCp,
      }
      stat.selectionReasons[decision.reason] += 1
      if (decision.usedPersonality) stat.personalityChanges += 1
    }

    const fullTurnWallElapsedMs = Date.now() - turnStartedAt
    clocks[turn] -= fullTurnWallElapsedMs
    recordSearch(stat, policy.multiPv, timed, fullTurnWallElapsedMs)

    traces.push({
      ply: history.length + 1,
      positionKey: positionKey(board, turn),
      color: turn,
      agent,
      multiPv: policy.multiPv,
      multiPvReason: policy.reason,
      budgetMs,
      seed,
      clocksBeforeMs,
      clocksAfterMs: { ...clocks },
      wallElapsedMs: timed.wallElapsedMs,
      fullTurnWallElapsedMs,
      engineElapsedMs: response.info.elapsedMs,
      depth: response.info.depth,
      bestmove: response.bestmove,
      selected,
      selectedInfo: cloneSearchInfo(selectedInfo),
      candidates: response.candidates.map(cloneCandidate),
      selection,
    })

    const move = selected ? matchUcciMove(board, legalMoves, selected) : null
    if (!move) {
      stat.illegalMoves += 1
      return finish(
        'technical',
        'illegal-engine-move',
        null,
        `Engine returned no legal move: ${selected ?? response.bestmove ?? 'nobestmove'}`,
      )
    }

    const forcedMateAgainst = selectedInfo.score?.kind === 'mate' && selectedInfo.score.value < 0
    resignation[turn] = updateResignationStreak(
      resignation[turn],
      history.length,
      selectedInfo.wdl?.loss ?? 0,
      forcedMateAgainst,
    )
    if (resignation[turn] >= RESIGN_STREAK) {
      return finish('completed', 'resignation', opposite(turn))
    }
    if (clocks[turn] <= 0 || timed.wallElapsedMs > config.turnTimeMs) {
      return finish('completed', 'clock-timeout', opposite(turn))
    }

    history.push(moveToUcci(move))
    board = applyMove(board, move)
    turn = opposite(turn)
    noCapturePlies = move.captured ? 0 : noCapturePlies + 1
    seed = nextProductSeed(seed, history.length)
    const key = positionKey(board, turn)
    const repetitionsCount = (repetitions.get(key) ?? 0) + 1
    repetitions.set(key, repetitionsCount)
    const drawReason = getSimplifiedDrawReason(repetitionsCount, noCapturePlies)
    if (drawReason) return finish('completed', drawReason, null)
  }

  return finish('incomplete', 'ply-limit', null)
}

function selectPolicy(
  agent: AgentMode,
  board: BoardState,
  color: Color,
  historyLength: number,
  remainingTimeMs: number,
  turnBudgetMs: number,
): { multiPv: number; reason: string } {
  if (agent === 'product-baseline') return { multiPv: 1, reason: 'product-baseline-single-pv' }
  const dynamic = selectSearchMultiPv({
    board,
    color,
    historyLength,
    threads: config.threads,
    hashMb: config.hashMb,
    remainingTimeMs,
    turnBudgetMs,
  })
  return dynamic
}

function budgetForTurn(seed: number, remainingTimeMs: number): number {
  const preferred = config.moveMs + (config.moveJitterMs > 1 ? seed % config.moveJitterMs : 0)
  const lowTimeBudget =
    remainingTimeMs < 45_000 ? Math.min(5_000, remainingTimeMs - 500) : preferred
  return Math.max(50, Math.floor(Math.min(preferred, lowTimeBudget, remainingTimeMs - 500, config.turnTimeMs - 500)))
}

function recordSearch(
  stat: SideStats,
  multiPv: number,
  timed: TimedSearch,
  fullTurnWallElapsedMs: number,
): void {
  const info = timed.response.info
  stat.searches += 1
  stat.totalEngineWallMs += timed.wallElapsedMs
  stat.totalTurnWallMs += fullTurnWallElapsedMs
  stat.totalEngineReportedMs += info.elapsedMs
  stat.totalDepth += info.depth
  stat.minDepth = stat.minDepth === null ? info.depth : Math.min(stat.minDepth, info.depth)
  stat.maxDepth = stat.maxDepth === null ? info.depth : Math.max(stat.maxDepth, info.depth)
  const key = String(Math.max(1, Math.min(4, multiPv))) as keyof SideStats['multiPv']
  stat.multiPv[key] += 1
}

function createSideStats(): SideStats {
  return {
    searches: 0,
    engineTimeouts: 0,
    illegalMoves: 0,
    technicalFailures: 0,
    totalEngineWallMs: 0,
    totalTurnWallMs: 0,
    totalEngineReportedMs: 0,
    totalDepth: 0,
    minDepth: null,
    maxDepth: null,
    multiPv: { '1': 0, '2': 0, '3': 0, '4': 0 },
    personalityCalls: 0,
    personalityChanges: 0,
    selectionReasons: { personality: 0, 'forced-best': 0, 'insufficient-safe-candidates': 0 },
  }
}

function validateOpenings(): ValidatedOpening[] {
  return OPENING_PREFIXES.map((moves, index) => {
    let board = createInitialBoard()
    let turn: Color = 'red'
    for (const ucci of moves) {
      const move = matchUcciMove(board, getLegalMoves(board, turn), ucci)
      if (!move) throw new Error(`Opening ${index + 1} is illegal at ${ucci}`)
      board = applyMove(board, move)
      turn = opposite(turn)
    }
    return {
      id: `joint-opening-${String(index + 1).padStart(2, '0')}`,
      moves: [...moves],
    }
  })
}

function makePairOutcome(
  comparison: ControlId,
  pairIndex: number,
  opening: ValidatedOpening,
  personalityRed: GameOutcome,
  personalityBlack: GameOutcome,
): PairOutcome {
  const scores = [gamePersonalityScore(personalityRed), gamePersonalityScore(personalityBlack)]
  if (scores.some((score) => score === null)) {
    return {
      id: `${comparison}-${pairIndex + 1}`,
      comparison,
      pairIndex,
      opening: { id: opening.id, moves: [...opening.moves] },
      gameIds: [personalityRed.id, personalityBlack.id],
      status: 'incomplete',
      personalityPoints: null,
      baselinePoints: null,
      perGameScoreDifference: null,
    }
  }
  const personalityPoints = scores[0]! + scores[1]!
  const baselinePoints = 2 - personalityPoints
  return {
    id: `${comparison}-${pairIndex + 1}`,
    comparison,
    pairIndex,
    opening: { id: opening.id, moves: [...opening.moves] },
    gameIds: [personalityRed.id, personalityBlack.id],
    status: 'scored',
    personalityPoints,
    baselinePoints,
    perGameScoreDifference: (personalityPoints - baselinePoints) / 2,
  }
}

function gamePersonalityScore(game: GameOutcome): number | null {
  if (game.status !== 'completed') return null
  if (game.winner === null) return 0.5
  return game.winner === game.personalityColor ? 1 : 0
}

function evaluateIntegrity(
  engine: SelfPlayEngine,
  openings: ValidatedOpening[],
  games: GameOutcome[],
): RunIntegrity {
  const expectedGames = config.pairs * controls.length * 2
  const technicalGames = games.filter((game) => game.status === 'technical').length
  const illegalMoves = games.reduce(
    (sum, game) => sum + game.sideStats.red.illegalMoves + game.sideStats.black.illegalMoves,
    0,
  )
  const engineTimeouts = games.reduce(
    (sum, game) => sum + game.sideStats.red.engineTimeouts + game.sideStats.black.engineTimeouts,
    0,
  )
  const nnueLogConfirmed = engine.isNnueConfirmed()
  return {
    expectedGames,
    observedGames: games.length,
    nnueLogConfirmed,
    validatedOpenings: openings.length,
    technicalGames,
    illegalMoves,
    engineTimeouts,
    passed:
      games.length === expectedGames &&
      openings.length === OPENING_PREFIXES.length &&
      nnueLogConfirmed &&
      technicalGames === 0 &&
      illegalMoves === 0 &&
      engineTimeouts === 0,
  }
}

function buildReport(
  profile: EngineProfile,
  assetVerification: EngineAssetVerification,
  openings: ValidatedOpening[],
  games: GameOutcome[],
  pairs: PairOutcome[],
  elapsedMs: number,
  runState: 'running' | 'completed',
  integrity: RunIntegrity,
) {
  const openingsUsed = Object.fromEntries(
    openings.map((opening) => [
      opening.id,
      pairs.filter((pair) => pair.opening.id === opening.id).length,
    ]),
  )
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'fixed-opening, color-swapped personality on/off whole-game candidate-selection A/B',
    limitations: [
      'Each opening prefix is a joint red/black four-ply line. This report attributes only post-book candidate selection, not opening-policy Elo.',
      'The product-baseline control intentionally uses MultiPV 1 and is a product reference, not an attribution-isolated control.',
      'The attribution-baseline control uses the same dynamic MultiPV policy as personality and differs only by always selecting engine bestmove.',
      'There are 18 distinct joint-opening prefixes, including mirrored lines. They are not claimed to be statistically independent fixtures; repeating the cycle does not create a new opening prefix.',
      'This Node/WASM runner is not Chromium Worker/UI performance validation.',
      'Ply-limit pairs are excluded from descriptive score summaries, so any incomplete pair makes strength inference inconclusive rather than favourable to either side.',
      'No non-inferiority conclusion is emitted by this 18-prefix harness. A separately predeclared, sufficiently diverse fixture corpus and statistical plan are required.',
    ],
    engine: profile,
    engineAssetVerification: assetVerification,
    source: {
      personalityRuntime: PERSONALITY_RUNTIME,
      personalities: AI_PERSONALITIES,
      sourceSha256: sourceFingerprint(),
    },
    run: {
      state: runState,
      integrity,
    },
    fairness: {
      skillLevel: 20,
      useNnue: true,
      uciLimitStrength: false,
      equalThreads: config.threads,
      equalHashMb: config.hashMb,
      equalMoveBudgetRule: {
        baseMoveMs: config.moveMs,
        jitterMs: config.moveJitterMs,
        totalTimeMs: config.totalTimeMs,
        turnTimeMs: config.turnTimeMs,
      },
      hashResetBetweenGamesOnly: true,
    },
    config,
    controls,
    openings: {
      validatedCount: openings.length,
      allJointFourPly: true,
      distinctFixedPrefixCount: openings.length,
      coverageByOpening: openingsUsed,
      entries: openings,
    },
    results: {
      elapsedMs,
      games: summarizeGames(games),
      controls: Object.fromEntries(
        controls.map((control) => [
          control.id,
          summarizePairs(
            pairs.filter((pair) => pair.comparison === control.id),
            games.filter((game) => game.comparison === control.id),
          ),
        ]),
      ),
    },
    pairs,
    games,
  }
}

function summarizeGames(games: GameOutcome[]) {
  const byAgent: Record<AgentMode, SideStats> = {
    personality: createSideStats(),
    'product-baseline': createSideStats(),
    'attribution-baseline': createSideStats(),
  }
  const reasons: Record<GameReason, number> = {
    checkmate: 0,
    stalemate: 0,
    repetition: 0,
    'no-capture': 0,
    resignation: 0,
    'clock-timeout': 0,
    'ply-limit': 0,
    'engine-timeout': 0,
    'illegal-engine-move': 0,
    technical: 0,
  }
  for (const game of games) {
    reasons[game.reason] += 1
    mergeSideStats(byAgent[game.agents.red], game.sideStats.red)
    mergeSideStats(byAgent[game.agents.black], game.sideStats.black)
  }
  return {
    total: games.length,
    completed: games.filter((game) => game.status === 'completed').length,
    incomplete: games.filter((game) => game.status === 'incomplete').length,
    technical: games.filter((game) => game.status === 'technical').length,
    reasons,
    byAgent: Object.fromEntries(
      Object.entries(byAgent).map(([agent, stats]) => [agent, finalizeSideStats(stats)]),
    ),
  }
}

function summarizePairs(pairs: PairOutcome[], games: GameOutcome[]) {
  const scored = pairs.filter((pair) => pair.status === 'scored')
  const values = scored.map((pair) => pair.perGameScoreDifference!)
  const personalityStats = games.reduce(
    (total, game) => {
      const color = game.personalityColor
      total.calls += game.sideStats[color].personalityCalls
      total.changes += game.sideStats[color].personalityChanges
      return total
    },
    { calls: 0, changes: 0 },
  )
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const sampleVariance =
    values.length > 1 && mean !== null
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : null
  const standardError = sampleVariance === null ? null : Math.sqrt(sampleVariance / values.length)
  const oneSided95LowerBound = mean === null || standardError === null ? null : mean - 1.645 * standardError
  return {
    totalPairs: pairs.length,
    scoredPairs: scored.length,
    incompletePairs: pairs.length - scored.length,
    personalityPoints: scored.reduce((sum, pair) => sum + pair.personalityPoints!, 0),
    baselinePoints: scored.reduce((sum, pair) => sum + pair.baselinePoints!, 0),
    personalityScorePerGame:
      scored.length ? scored.reduce((sum, pair) => sum + pair.personalityPoints!, 0) / (2 * scored.length) : null,
    pairedMeanPerGameDifference: mean,
    descriptiveOneSided95LowerBound: oneSided95LowerBound,
    treatmentExposure: {
      personalityCalls: personalityStats.calls,
      personalityChanges: personalityStats.changes,
      changeRate: personalityStats.calls ? personalityStats.changes / personalityStats.calls : null,
      status:
        personalityStats.calls === 0
          ? 'no-personality-searches'
          : personalityStats.changes === 0
            ? 'no-treatment-exposure'
            : 'treatment-observed',
    },
    distinctFixedPrefixesRepresented: new Set(pairs.map((pair) => pair.opening.id)).size,
    censoring: {
      incompletePairs: pairs.length - scored.length,
      handling: 'Excluded from descriptive score only; any strength inference is inconclusive.',
    },
    nonInferiority: {
      predeclaredMargin: config.nonInferiorityMargin,
      predeclaredMinimumPairs: config.minPairsForInference,
      status:
        pairs.length !== scored.length
          ? 'inconclusive-incomplete-pairs'
          : personalityStats.changes === 0
            ? 'inconclusive-no-treatment-exposure'
            : 'not-evaluable-with-current-fixed-prefix-corpus',
      note:
        'The value above is descriptive only. This harness intentionally never emits a non-inferiority pass/fail because its 18 prefixes include mirrors and are not a predeclared independent fixture corpus.',
    },
  }
}

function mergeSideStats(target: SideStats, source: SideStats): void {
  target.searches += source.searches
  target.engineTimeouts += source.engineTimeouts
  target.illegalMoves += source.illegalMoves
  target.technicalFailures += source.technicalFailures
  target.totalEngineWallMs += source.totalEngineWallMs
  target.totalTurnWallMs += source.totalTurnWallMs
  target.totalEngineReportedMs += source.totalEngineReportedMs
  target.totalDepth += source.totalDepth
  target.minDepth = minDefined(target.minDepth, source.minDepth)
  target.maxDepth = maxDefined(target.maxDepth, source.maxDepth)
  for (const key of ['1', '2', '3', '4'] as const) target.multiPv[key] += source.multiPv[key]
  target.personalityCalls += source.personalityCalls
  target.personalityChanges += source.personalityChanges
  for (const reason of Object.keys(target.selectionReasons) as Array<keyof SideStats['selectionReasons']>) {
    target.selectionReasons[reason] += source.selectionReasons[reason]
  }
}

function finalizeSideStats(stats: SideStats) {
  return {
    ...stats,
    meanDepth: stats.searches ? stats.totalDepth / stats.searches : null,
    meanEngineWallMs: stats.searches ? stats.totalEngineWallMs / stats.searches : null,
    meanTurnWallMs: stats.searches ? stats.totalTurnWallMs / stats.searches : null,
    meanEngineReportedMs: stats.searches ? stats.totalEngineReportedMs / stats.searches : null,
    personalityChangeRate: stats.personalityCalls ? stats.personalityChanges / stats.personalityCalls : null,
  }
}

function minDefined(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.min(left, right)
}

function maxDefined(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

function collectCandidates(lines: string[]): SearchCandidate[] {
  const byRank = new Map<number, SearchCandidate>()
  const byMove = new Map<string, SearchCandidate>()
  for (const line of lines) {
    const rankMatch = /(?:^|\s)multipv\s+(\d+)(?:\s|$)/.exec(line)
    const rank = rankMatch ? Math.max(1, Number(rankMatch[1])) : 1
    const info = parseInfoLine(line)
    if (!info || !isCompleteRootInfo(line, info)) continue
    const rootMove = info.pv[0]
    const lastForMove = byMove.get(rootMove)
    const previous = previousSnapshot(lastForMove, info.depth)
    const lastForRank = byRank.get(rank)
    const previousPrincipal =
      rank === 1 ? previousPrincipalSnapshot(lastForRank, info.depth) : undefined
    const candidate: SearchCandidate = { ...info, multipv: rank, previous, previousPrincipal }
    if (!lastForRank || candidate.depth >= lastForRank.depth) byRank.set(rank, candidate)
    if (!lastForMove || candidate.depth >= lastForMove.depth) byMove.set(rootMove, candidate)
  }
  return [...byRank.values()].sort((left, right) => left.multipv - right.multipv)
}

function emptyInfo(): SearchInfo {
  return { depth: 0, nodes: 0, nps: 0, elapsedMs: 0, score: null, wdl: null, pv: [] }
}

function cloneSearchInfo(info: SearchInfo): SearchInfo {
  return {
    ...info,
    score: info.score && { ...info.score },
    wdl: info.wdl && { ...info.wdl },
    pv: [...info.pv],
  }
}

function cloneCandidate(candidate: SearchCandidate): SearchCandidate {
  return {
    ...cloneSearchInfo(candidate),
    multipv: candidate.multipv,
    previous: candidate.previous && cloneCandidateSnapshot(candidate.previous),
    previousPrincipal:
      candidate.previousPrincipal && cloneCandidateSnapshot(candidate.previousPrincipal),
  }
}

function cloneCandidateSnapshot(snapshot: SearchCandidateSnapshot): SearchCandidateSnapshot {
  return {
    depth: snapshot.depth,
    score: snapshot.score && { ...snapshot.score },
    wdl: snapshot.wdl && { ...snapshot.wdl },
  }
}

function previousSnapshot(
  previous: SearchCandidate | undefined,
  nextDepth: number,
): SearchCandidateSnapshot | undefined {
  if (!previous) return undefined
  if (nextDepth === previous.depth) return previous.previous
  if (nextDepth > previous.depth) {
    return { depth: previous.depth, score: previous.score, wdl: previous.wdl }
  }
  return undefined
}

function previousPrincipalSnapshot(
  previous: SearchCandidate | undefined,
  nextDepth: number,
): SearchCandidateSnapshot | undefined {
  if (!previous) return undefined
  if (nextDepth === previous.depth) return previous.previousPrincipal
  if (nextDepth > previous.depth) {
    return { depth: previous.depth, score: previous.score, wdl: previous.wdl }
  }
  return undefined
}

function isCompleteRootInfo(line: string, info: SearchInfo): boolean {
  return (
    info.depth > 0 &&
    info.score !== null &&
    info.wdl !== null &&
    info.pv.length > 0 &&
    /(?:^|\s)depth\s+\d+(?:\s|$)/.test(line) &&
    /(?:^|\s)score\s+/.test(line) &&
    /(?:^|\s)wdl\s+/.test(line) &&
    /(?:^|\s)pv\s+/.test(line) &&
    !/(?:^|\s)(?:lowerbound|upperbound)(?:\s|$)/.test(line)
  )
}

function nextProductSeed(seed: number, historyLength: number): number {
  return (seed + 0x9e3779b9 + historyLength * 97) >>> 0
}

function mixSeed(seed: number, pairIndex: number): number {
  let value = (seed ^ Math.imul(pairIndex + 1, 0x9e3779b9)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b) >>> 0
  value ^= value >>> 13
  return (value ^ (value >>> 16)) >>> 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sha256(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

function sourceFingerprint(): string {
  const files = [
    'benchmark/personality-selfplay.bench.ts',
    'src/engine/personality.ts',
    'src/engine/search-policy.ts',
    'src/engine/openings.ts',
  ]
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(resolve(projectRoot, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readPositiveInteger(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`)
  return value
}

function readNonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function readOptionalNonNegativeNumber(name: string): number | null {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`)
  return value
}

function readOptionalPositiveInteger(name: string): number | null {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}
