import { goRecordToKataGoTuple } from './ai/coordinates'
import type { KataGoTransport } from './ai/KataGoTransport'
import { KATAGO_CHINESE_PSK_RULES, kataGoRuntimeBackendLabel } from './ai/types'
import type { GoGameState } from './types'

export const GO_WIN_RATE_ANALYSIS = Object.freeze({
  profile: 'winrate' as const,
  requestedVisits: 256,
  timeoutMs: 12_000,
  boardSize: 19 as const,
  komi: 7.5 as const,
})

export interface GoWinRatePoint {
  moveNumber: number
  blackWinRate: number
  whiteWinRate: number
  visits: number
  requestedVisits: number
  elapsedMs: number
  timedOut: boolean
  runtimeLabel: string
  engineVersion: string
  modelName: string
}

/**
 * Computes chart data from KataGo's root winrate for an already-played position.
 * It never selects or applies a move and therefore cannot change match behavior.
 */
export class GoWinRateAnalyzer {
  constructor(private readonly transport: KataGoTransport) {}

  async analyze(state: GoGameState, signal?: AbortSignal): Promise<GoWinRatePoint> {
    if (state.history.length === 0) throw new Error('胜率分析需要至少一手正式棋谱。')
    const requestId = createRequestId(state.history.length)
    const event = await this.transport.analyze({
      requestId,
      gameId: 'go',
      player: state.turn,
      profile: GO_WIN_RATE_ANALYSIS.profile,
      boardSize: GO_WIN_RATE_ANALYSIS.boardSize,
      komi: GO_WIN_RATE_ANALYSIS.komi,
      rules: KATAGO_CHINESE_PSK_RULES,
      moves: state.history.map((record) => goRecordToKataGoTuple(record)),
    }, {
      signal,
      analysisGroup: 'background',
    })

    const blackWinRate = probability(event.root.winrate)
    return {
      moveNumber: state.history.length,
      blackWinRate,
      whiteWinRate: 1 - blackWinRate,
      visits: Math.max(0, Math.trunc(event.root.visits)),
      requestedVisits: Math.max(0, Math.trunc(event.requestedVisits)),
      elapsedMs: Math.max(0, Math.trunc(event.elapsedMs)),
      timedOut: event.timedOut,
      runtimeLabel: kataGoRuntimeBackendLabel(event.runtimeBackend),
      engineVersion: event.engineVersion,
      modelName: event.modelName,
    }
  }

  cancel(requestId: string): void {
    this.transport.cancel(requestId)
  }
}

function probability(value: number): number {
  if (!Number.isFinite(value)) throw new Error('KataGo 返回了无效的根节点胜率。')
  return Math.min(1, Math.max(0, value))
}

function createRequestId(moveNumber: number): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `go-winrate-${moveNumber}-${suffix}`
}
