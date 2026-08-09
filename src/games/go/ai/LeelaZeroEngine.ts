import type { AIEngine, AIInitialization, AIThinkRequest, AIThinkResult } from '../../core'
import { isGoPassMove, type GoGameState, type GoMove, type GoMoveRecord, type GoPlayer } from '../types'
import { goRecordToKataGoTuple, gtpToGoMove } from './coordinates'
import type { GoAIAnalysis, GoAIAnalysisListener } from './go-ai'
import type { LeelaZeroTransport } from './LeelaZeroTransport'

export class LeelaZeroEngine implements AIEngine<GoGameState, GoMove, GoPlayer, GoMoveRecord, GoAIAnalysis> {
  readonly id: string
  readonly name = 'Leela Zero'
  private readonly transport: LeelaZeroTransport
  private readonly listeners = new Set<GoAIAnalysisListener>()
  private context: AIInitialization<GoPlayer> | null = null
  private activeRequestId: string | null = null
  private disposed = false

  constructor(id: string, transport: LeelaZeroTransport) {
    this.id = id
    this.transport = transport
  }

  async initialize(context: AIInitialization<GoPlayer>): Promise<void> {
    this.assertActive()
    if (context.gameId !== 'go') throw new Error('LeelaZeroEngine 只能用于围棋对局。')
    await this.transport.initialize()
    this.context = context
  }

  async newGame(): Promise<void> {
    await this.stop()
  }

  async think(request: AIThinkRequest<GoGameState, GoMove, GoPlayer, GoMoveRecord>): Promise<AIThinkResult<GoMove, GoAIAnalysis>> {
    this.assertActive()
    if (!this.context || this.context.player !== request.player) throw new Error('Leela Zero 座位与当前行棋方不一致。')
    if (request.state.phase !== 'playing') throw new Error('Leela Zero 只能在行棋阶段搜索。')
    if (this.activeRequestId) throw new Error('Leela Zero 已有进行中的搜索。')
    const requestId = `${this.id}-${crypto.randomUUID()}`
    this.activeRequestId = requestId
    try {
      const result = await this.transport.analyze({
        requestId,
        gameId: 'go',
        player: request.player,
        boardSize: 19,
        komi: 7.5,
        moves: request.record.map((record) => goRecordToKataGoTuple(record)),
      }, request.signal)
      const action = gtpToGoMove(result.move)
      const canonical = request.legalActions.find((legal) => actionsEqual(legal, action))
      if (!canonical) throw new Error('Leela Zero 返回的着法不符合当前围棋规则，已拒绝执行。')
      const analysis: GoAIAnalysis = {
        engineId: 'leela-zero',
        engineName: 'Leela Zero',
        requestId,
        player: request.player,
        stage: 'final',
        action: canonical,
        blackWinRate: 0.5,
        whiteWinRate: 0.5,
        currentPlayerWinRate: 0.5,
        winRateAvailable: false,
        winRateChange: null,
        scoreLeadBlack: null,
        visits: result.requestedPlayouts,
        elapsedMs: result.elapsedMs,
        requestedVisits: result.requestedPlayouts,
        runtimeLabel: 'Native Leela Zero · OpenCL',
        timedOut: result.timedOut,
        truncated: result.timedOut,
        stopReason: result.timedOut ? 'time-limit' : 'visit-limit',
        pv: [canonical],
        pvNotation: [result.move],
        candidates: [{
          action: canonical,
          notation: result.move,
          order: 0,
          visits: result.requestedPlayouts,
          prior: null,
          blackWinRate: 0.5,
          scoreLeadBlack: null,
          pv: [canonical],
          pvNotation: [result.move],
        }],
        engineVersion: result.engineVersion,
        modelName: result.modelName,
        profileLabel: `MATCH · ${result.requestedPlayouts} playouts`,
      }
      for (const listener of this.listeners) listener(analysis)
      return { action: canonical, analysis }
    } finally {
      if (this.activeRequestId === requestId) this.activeRequestId = null
    }
  }

  async stop(): Promise<void> {
    if (this.activeRequestId) this.transport.cancel(this.activeRequestId)
    this.activeRequestId = null
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.stop()
    this.disposed = true
    this.context = null
    this.listeners.clear()
  }

  subscribe(listener: GoAIAnalysisListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('LeelaZeroEngine 已经释放。')
  }
}

function actionsEqual(left: GoMove, right: GoMove): boolean {
  if (isGoPassMove(left) || isGoPassMove(right)) return isGoPassMove(left) && isGoPassMove(right)
  return left.row === right.row && left.col === right.col
}
