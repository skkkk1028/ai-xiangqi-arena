import type { EngineAdapter } from './engine/adapter'
import { engineRegistry } from './engine/default-registry'
import { selectOpening } from './engine/openings'
import { detectEngineSupport } from './engine/support'
import { matchUcciMove } from './engine/ucci'
import type { EngineProfile, GameResult } from './game/types'
import { XiangqiGameEngine } from './games/xiangqi/game-engine'
import {
  createCalibrationSchedule,
  summarizeCalibration,
  winnerForResult,
  type CalibrationGameResult,
  type CalibrationSummary,
} from './games/xiangqi/calibration'

interface CalibrationPageResult {
  state: 'running' | 'passed' | 'failed'
  status: 'running' | 'passed' | 'failed'
  stage: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  configuration: {
    engineId: string
    opponentEngineId: string
    pairCount: number
    nodes: number
    maxPlies: number
    threads: number
    hashMb: number
    profile: EngineProfile | null
    opponentProfile: EngineProfile | null
  }
  games: CalibrationGameResult[]
  summary: CalibrationSummary | null
  error?: string
}

declare global {
  interface Window {
    __AI_XIANGQI_CALIBRATION__?: CalibrationPageResult
  }
}

const params = new URLSearchParams(window.location.search)
const engineId = params.get('engine') ?? 'pikafish-2026-nnue'
const opponentEngineId = params.get('opponent') ?? 'fairy-stockfish-nnue'
const pairCount = integerQuery('pairs', 20, 1, 500)
const nodes = integerQuery('nodes', 100_000, 10_000, 5_000_000)
const maxPlies = integerQuery('max-plies', 240, 20, 600)
const searchTimeoutMs = integerQuery('search-timeout-ms', 120_000, 30_000, 300_000)
const output = requiredElement<HTMLPreElement>('calibration-output')
const startedAtMs = performance.now()

const result: CalibrationPageResult = {
  state: 'running',
  status: 'running',
  stage: 'page-loaded',
  startedAt: new Date().toISOString(),
  configuration: {
    engineId,
    opponentEngineId,
    pairCount,
    nodes,
    maxPlies,
    threads: 1,
    hashMb: 64,
    profile: null,
    opponentProfile: null,
  },
  games: [],
  summary: null,
}

window.__AI_XIANGQI_CALIBRATION__ = result
render()
void run()

async function run(): Promise<void> {
  let client: EngineAdapter | null = null
  let opponentClient: EngineAdapter | null = null
  try {
    if (engineId === opponentEngineId) throw new Error('校准必须选择两个不同的引擎配置。')
    const support = detectEngineSupport()
    if (!support.supported) throw new Error(support.reason ?? '当前浏览器不支持专业引擎。')
    const first = engineRegistry.getEngine('xiangqi', engineId)
    const second = engineRegistry.getEngine('xiangqi', opponentEngineId)
    if (!first || !second) throw new Error('校准引擎不在中国象棋 Engine Registry 中。')

    result.stage = 'initializing-engines'
    render()
    const context = (onProgress: () => void) => ({
      assetBase: new URL('./', window.location.href).href,
      onProgress,
      onRuntimeFatal: (error: Error) => result.games.push({
        pairIndex: -1,
        gameIndex: -1,
        openingSeed: 0,
        redEngineId: engineId,
        blackEngineId: opponentEngineId,
        outcome: 'technical',
        plies: 0,
        termination: 'technical',
        technicalError: error.message,
      }),
    })
    client = engineRegistry.createEngine('xiangqi', engineId, context(() => render()), { threads: 1, hash: 64 })
    opponentClient = engineRegistry.createEngine('xiangqi', opponentEngineId, context(() => render()), { threads: 1, hash: 64 })
    result.configuration.profile = await client.init()
    result.stage = 'first-engine-ready'
    render()
    result.configuration.opponentProfile = await opponentClient.init()
    result.stage = 'opponent-engine-ready'
    render()

    const schedule = createCalibrationSchedule(engineId, opponentEngineId, pairCount)
    const game = new XiangqiGameEngine()
    for (const entry of schedule) {
      result.stage = `game-${entry.gameIndex + 1}-of-${schedule.length}`
      render()
      const red = entry.redEngineId === engineId ? client : opponentClient
      const black = entry.blackEngineId === engineId ? client : opponentClient
      red.newGame()
      black.newGame()
      const gameResult = await playGame(game, red, black, entry.openingSeed)
      result.games.push({
        ...entry,
        outcome: gameResult.outcome,
        plies: gameResult.plies,
        termination: gameResult.termination,
        technicalError: gameResult.technicalError,
      })
      render()
    }
    result.summary = summarizeCalibration(result.games, engineId, opponentEngineId)
    result.stage = 'completed'
    setStatus(result.summary.technicalFailures === 0 ? 'passed' : 'failed')
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.stage = 'failed'
    setStatus('failed')
  } finally {
    client?.dispose()
    opponentClient?.dispose()
    result.finishedAt = new Date().toISOString()
    result.durationMs = Math.round(performance.now() - startedAtMs)
    window.__AI_XIANGQI_CALIBRATION__ = result
    render()
  }
}

async function playGame(
  game: XiangqiGameEngine,
  red: EngineAdapter,
  black: EngineAdapter,
  openingSeed: number,
): Promise<{
  outcome: CalibrationGameResult['outcome']
  plies: number
  termination: CalibrationGameResult['termination']
  technicalError?: string
}> {
  let state = game.initializeGame()
  try {
    const opening = selectOpening(openingSeed)
    for (const ucci of opening.moves) {
      const move = game.findLegalActionByUcci(state, ucci)
      if (!move) throw new Error(`开局 ${opening.id} 包含非法着法：${ucci}`)
      state = game.executeAction(state, move)
    }
    while (!state.result && state.history.length < maxPlies) {
      const adapter = state.turn === 'red' ? red : black
      const response = await adapter.search(
        state.history.map((record) => record.ucci),
        searchTimeoutMs,
        { multiPv: 1, maxNodes: nodes },
      )
      if (!response.bestmove) throw new Error('引擎未返回 bestmove。')
      const move = matchUcciMove(state.board, [...game.getLegalActions(state)], response.bestmove)
      if (!move) throw new Error(`引擎返回非法着法：${response.bestmove}`)
      state = game.executeAction(state, move)
    }
    const terminal: GameResult = state.result ?? {
      winner: null,
      loser: null,
      reason: 'technical',
      detail: '达到校准单局半回合上限，按和棋计入。',
    }
    return {
      outcome: winnerForResult(terminal),
      plies: state.history.length,
      termination: state.result?.reason ?? 'move-limit',
    }
  } catch (error) {
    return {
      outcome: 'technical',
      plies: state.history.length,
      termination: 'technical',
      technicalError: error instanceof Error ? error.message : String(error),
    }
  }
}

function setStatus(status: 'passed' | 'failed'): void {
  result.state = status
  result.status = status
  render()
}

function render(): void {
  output.textContent = JSON.stringify(result, null, 2)
  window.__AI_XIANGQI_CALIBRATION__ = result
  // Reuse the repository's browser-validation runner contract so this page
  // can be driven headlessly without a second polling protocol.
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
