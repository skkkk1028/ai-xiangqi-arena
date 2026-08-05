import type {
  AIEngine,
  AIInitialization,
  AIThinkRequest,
  AIThinkResult,
} from '../../core'
import { isGoPassMove, type GoGameState, type GoMove, type GoMoveRecord, type GoPlayer } from '../types'
import { goRecordToKataGoTuple, gtpToGoMove } from './coordinates'
import { HttpKataGoTransport, type KataGoTransport } from './KataGoTransport'
import {
  KATAGO_CHINESE_PSK_RULES,
  KataGoMatchAnalysisStore,
  type KataGoAnalysis,
  type KataGoAnalysisListener,
  type KataGoSearchProfile,
  type KataGoWireAnalysisEvent,
} from './types'

export interface KataGoEngineOptions {
  transport?: KataGoTransport
  profile?: KataGoSearchProfile
  analysisStore?: KataGoMatchAnalysisStore
  endpoint?: string
}

export class KataGoEngine
  implements AIEngine<GoGameState, GoMove, GoPlayer, GoMoveRecord, KataGoAnalysis>
{
  readonly id: string
  readonly name = 'KataGo'
  readonly profile: KataGoSearchProfile

  private readonly transport: KataGoTransport
  private readonly ownsTransport: boolean
  private readonly analysisStore: KataGoMatchAnalysisStore
  private readonly listeners = new Set<KataGoAnalysisListener>()
  private context: AIInitialization<GoPlayer> | null = null
  private activeRequestId: string | null = null
  private disposed = false

  constructor(id: string, options: KataGoEngineOptions = {}) {
    this.id = id
    this.profile = options.profile ?? 'fast'
    this.transport = options.transport ?? new HttpKataGoTransport({ baseUrl: options.endpoint })
    this.ownsTransport = !options.transport
    this.analysisStore = options.analysisStore ?? new KataGoMatchAnalysisStore()
  }

  async initialize(context: AIInitialization<GoPlayer>): Promise<void> {
    this.assertActive()
    if (context.gameId !== 'go') throw new Error('KataGoEngine 只能用于围棋对局。')
    if (this.context && this.context.player !== context.player) {
      throw new Error('同一个 KataGoEngine 实例不能同时绑定两个座位。')
    }
    await this.transport.initialize()
    this.context = context
  }

  /** Standalone alias requested by the Go module API. */
  async init(context: AIInitialization<GoPlayer>): Promise<void> {
    await this.initialize(context)
  }

  async newGame(): Promise<void> {
    await this.stop('新棋局已开始。')
    this.analysisStore.reset()
  }

  async think(
    request: AIThinkRequest<GoGameState, GoMove, GoPlayer, GoMoveRecord>,
  ): Promise<AIThinkResult<GoMove, KataGoAnalysis>> {
    this.assertActive()
    if (!this.context) throw new Error('请先初始化 KataGoEngine。')
    if (this.context.player !== request.player) throw new Error('KataGoEngine 座位与当前行棋方不一致。')
    if (request.state.phase !== 'playing') throw new Error('KataGo 只能分析行棋阶段的局面。')
    if (this.activeRequestId) throw new Error('KataGoEngine 已经有一个进行中的搜索。')

    const requestId = createRequestId(this.id)
    this.activeRequestId = requestId
    try {
      const finalEvent = await this.transport.analyze(
        {
          requestId,
          gameId: this.context.gameId,
          player: request.player,
          profile: this.profile,
          boardSize: 19,
          komi: 7.5,
          rules: KATAGO_CHINESE_PSK_RULES,
          moves: request.record.map((record) => goRecordToKataGoTuple(record)),
        },
        {
          signal: request.signal,
          onUpdate: (event) => this.publishPartial(event, request.player),
        },
      )
      const analysis = this.toAnalysis(finalEvent, request.player)
      const canonicalAction = request.legalActions.find((action) => actionsEqual(action, analysis.action))
      if (!canonicalAction) {
        throw new Error('KataGo 返回的着法不符合当前围棋规则，已拒绝执行。')
      }
      const acceptedAnalysis = { ...analysis, action: canonicalAction }
      this.analysisStore.commit(analysis.blackWinRate)
      this.emit(acceptedAnalysis)
      return { action: canonicalAction, analysis: acceptedAnalysis }
    } finally {
      if (this.activeRequestId === requestId) this.activeRequestId = null
    }
  }

  async stop(_reason?: string): Promise<void> {
    const requestId = this.activeRequestId
    if (!requestId) return
    this.transport.cancel(requestId)
    this.activeRequestId = null
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.stop('KataGoEngine 已释放。')
    this.disposed = true
    this.listeners.clear()
    this.context = null
    if (this.ownsTransport) await this.transport.dispose()
  }

  subscribe(listener: KataGoAnalysisListener): () => void {
    this.assertActive()
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publishPartial(event: KataGoWireAnalysisEvent, player: GoPlayer): void {
    if (event.stage !== 'partial' || event.candidates.length === 0) return
    try {
      this.emit(this.toAnalysis(event, player))
    } catch {
      // A malformed partial update must not hide a later valid final result.
    }
  }

  private toAnalysis(event: KataGoWireAnalysisEvent, player: GoPlayer): KataGoAnalysis {
    const ordered = [...event.candidates].sort((left, right) => left.order - right.order).slice(0, 5)
    const first = ordered[0]
    if (!first) throw new Error('KataGo 没有返回候选着。')
    const candidates = ordered.map((candidate) => ({
      action: gtpToGoMove(candidate.move),
      notation: candidate.move,
      order: candidate.order,
      visits: candidate.visits,
      prior: candidate.prior,
      blackWinRate: clampProbability(candidate.winrate),
      scoreLeadBlack: finiteOrNull(candidate.scoreLead),
      pv: candidate.pv.map((move) => gtpToGoMove(move)),
      pvNotation: [...candidate.pv],
    }))
    const blackWinRate = clampProbability(event.root.winrate)
    const previous = this.analysisStore.getPreviousBlackWinRate()
    const currentPlayerWinRate = player === 'black' ? blackWinRate : 1 - blackWinRate
    const previousForPlayer = previous === null ? null : player === 'black' ? previous : 1 - previous
    return {
      requestId: event.requestId,
      player,
      stage: event.stage,
      action: candidates[0].action,
      blackWinRate,
      whiteWinRate: 1 - blackWinRate,
      currentPlayerWinRate,
      winRateChange: previousForPlayer === null ? null : currentPlayerWinRate - previousForPlayer,
      scoreLeadBlack: finiteOrNull(event.root.scoreLead),
      visits: Math.max(0, Math.trunc(event.root.visits)),
      elapsedMs: Math.max(0, Math.trunc(event.elapsedMs)),
      truncated: event.truncated,
      pv: candidates[0].pv,
      pvNotation: candidates[0].pvNotation,
      candidates,
      engineVersion: event.engineVersion,
      modelName: event.modelName,
      profile: event.profile,
    }
  }

  private emit(analysis: KataGoAnalysis): void {
    for (const listener of this.listeners) listener(analysis)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('KataGoEngine 已经释放。')
  }
}

function actionsEqual(left: GoMove, right: GoMove): boolean {
  if (isGoPassMove(left) || isGoPassMove(right)) {
    return isGoPassMove(left) && isGoPassMove(right)
  }
  return left.row === right.row && left.col === right.col
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) throw new Error('KataGo 返回了无效胜率。')
  return Math.min(1, Math.max(0, value))
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}

function createRequestId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${id}`
}
