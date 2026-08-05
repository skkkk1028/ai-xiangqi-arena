import type { EngineAdapter } from '../../engine/adapter'
import {
  difficultyProfile,
  difficultyThinkTime,
  mapDifficultyToEngine,
  selectDifficultyMove,
  type DifficultyLevel,
} from '../../engine/difficulty'
import { engineRegistry } from '../../engine/default-registry'
import { selectPersonalityMove } from '../../engine/personality'
import { selectSearchMultiPv } from '../../engine/search-policy'
import { detectEngineSupport } from '../../engine/support'
import { matchUcciMove, moveToUcci } from '../../engine/ucci'
import { opposite } from '../../game/board'
import type {
  ClockState,
  Color,
  EngineProfile,
  EngineSearchResponse,
  GameResult,
  Move,
  SearchInfo,
} from '../../game/types'
import type { AIEngine, AIThinkRequest, AIThinkResult } from '../core'
import type { XiangqiGameState, XiangqiRecordEntry } from './game-engine'

const SEARCH_MIN_MS = 12_000
const SEARCH_RANGE_MS = 6_001
const CLOCK_SAFETY_MS = 500
const TURN_TIME_MS = 60_000
const OPENING_DELAY_MS = 250

export const EMPTY_XIANGQI_SEARCH_INFO: SearchInfo = {
  depth: 0,
  nodes: 0,
  nps: 0,
  elapsedMs: 0,
  score: null,
  wdl: null,
  pv: [],
}

type ThinkRequest = AIThinkRequest<XiangqiGameState, Move, Color, XiangqiRecordEntry>

export interface XiangqiTurnAnalysis {
  info: SearchInfo
  ucci: string
  source: 'opening' | 'engine'
  response?: EngineSearchResponse
  budgetMs?: number
  multiPv?: number
}

export class XiangqiAIResignedError extends Error {
  constructor(
    readonly player: Color,
    readonly info: SearchInfo,
  ) {
    super(`${player} AI 触发认输策略。`)
    this.name = 'XiangqiAIResignedError'
  }
}

export class XiangqiNoBestMoveError extends Error {
  constructor(readonly result: GameResult) {
    super('引擎没有返回 bestmove。')
    this.name = 'XiangqiNoBestMoveError'
  }
}

export class XiangqiIllegalEngineMoveError extends Error {
  constructor(readonly moveText: string | null) {
    super(`引擎返回非法或不同步着法：${moveText ?? 'null'}`)
    this.name = 'XiangqiIllegalEngineMoveError'
  }
}

function noBestMoveResult(state: XiangqiGameState): GameResult {
  return {
    winner: opposite(state.turn),
    loser: state.turn,
    reason: state.checkColor === state.turn ? 'checkmate' : 'stalemate',
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('AI 行棋已取消。', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('AI 行棋已取消。', 'AbortError'))
      },
      { once: true },
    )
  })
}

function uniqueAdapters(adapters: readonly (EngineAdapter | null)[]): EngineAdapter[] {
  return [...new Set(adapters.filter((adapter): adapter is EngineAdapter => adapter !== null))]
}

interface ManagedAILifecycle {
  getAdapter(player: Color): EngineAdapter | null
  getAdapters(): readonly (EngineAdapter | null)[]
}

abstract class ManagedXiangqiAI
  implements
    AIEngine<
      XiangqiGameState,
      Move,
      Color,
      XiangqiRecordEntry,
      XiangqiTurnAnalysis
    >
{
  abstract readonly id: string
  abstract readonly name: string

  constructor(protected readonly lifecycle: ManagedAILifecycle) {}

  async initialize(context: { player: Color }): Promise<void> {
    if (!this.lifecycle.getAdapter(context.player)) {
      throw new Error(`${this.name} 尚未绑定已就绪的 EngineAdapter。`)
    }
  }

  newGame(): void {
    for (const adapter of uniqueAdapters(this.lifecycle.getAdapters())) adapter.newGame()
  }

  stop(reason?: string): void {
    for (const adapter of uniqueAdapters(this.lifecycle.getAdapters())) adapter.stop(reason)
  }

  dispose(): void {
    // Worker ownership stays in the existing React lifecycle compatibility layer.
  }

  abstract think(request: ThinkRequest): Promise<AIThinkResult<Move, XiangqiTurnAnalysis>>
}

export interface AIMatchTurnContext {
  mode: 'fairy-duel' | 'engine-battle'
  seed: number
  openingMoves: readonly string[]
  clocks: ClockState
  profile: EngineProfile | null
  requestToken: number
}

export interface AIMatchControllerAIOptions extends ManagedAILifecycle {
  getContext(player: Color): AIMatchTurnContext
  onInfo(player: Color, info: SearchInfo, requestToken: number): void
  shouldResign(player: Color, info: SearchInfo): boolean
}

export class AIMatchControllerAI extends ManagedXiangqiAI {
  readonly id = 'xiangqi-ai-match-controller'
  readonly name = '中国象棋 AI 对战兼容引擎'

  constructor(private readonly options: AIMatchControllerAIOptions) {
    super(options)
  }

  async think(request: ThinkRequest): Promise<AIThinkResult<Move, XiangqiTurnAnalysis>> {
    const adapter = this.options.getAdapter(request.player)
    if (!adapter) throw new Error('当前 AI EngineAdapter 不存在。')
    const context = this.options.getContext(request.player)
    const openingUcci = context.openingMoves[request.record.length]
    if (openingUcci) {
      const openingMove = matchUcciMove(
        request.state.board,
        [...request.legalActions],
        openingUcci,
      )
      if (openingMove) {
        await wait(OPENING_DELAY_MS, request.signal)
        const info = { ...EMPTY_XIANGQI_SEARCH_INFO }
        if (this.options.shouldResign(request.player, info)) {
          throw new XiangqiAIResignedError(request.player, info)
        }
        return {
          action: openingMove,
          analysis: { info, ucci: openingUcci, source: 'opening' },
        }
      }
    }

    const remainingTotal = context.clocks[request.player]
    const remainingTurn = TURN_TIME_MS - context.clocks.turn
    const preferred = SEARCH_MIN_MS + (context.seed % SEARCH_RANGE_MS)
    const lowTimeBudget =
      remainingTotal < 45_000
        ? Math.min(5_000, remainingTotal - CLOCK_SAFETY_MS)
        : preferred
    const budget = Math.max(
      50,
      Math.min(
        preferred,
        lowTimeBudget,
        remainingTotal - CLOCK_SAFETY_MS,
        remainingTurn - CLOCK_SAFETY_MS,
      ),
    )
    const multiPv = selectSearchMultiPv({
      board: request.state.board,
      color: request.player,
      historyLength: request.record.length,
      threads: context.profile?.threads ?? 1,
      hashMb: context.profile?.hashMb ?? 64,
      remainingTimeMs: remainingTotal,
      turnBudgetMs: budget,
    }).multiPv
    const response = await adapter.search(
      request.record.map((record) => record.ucci),
      budget,
      {
        multiPv,
        onInfo: (info) =>
          this.options.onInfo(request.player, info, context.requestToken),
      },
    )
    if (!response.bestmove) throw new XiangqiNoBestMoveError(noBestMoveResult(request.state))
    const decision =
      context.mode === 'fairy-duel'
        ? selectPersonalityMove({
            board: request.state.board,
            color: request.player,
            legalMoves: [...request.legalActions],
            bestmove: response.bestmove,
            bestInfo: response.info,
            candidates: response.candidates,
            seed: context.seed,
          })
        : { ucci: response.bestmove, info: response.info }
    const action = decision.ucci
      ? matchUcciMove(request.state.board, [...request.legalActions], decision.ucci)
      : null
    if (!action) throw new XiangqiIllegalEngineMoveError(decision.ucci ?? response.bestmove)
    if (this.options.shouldResign(request.player, decision.info)) {
      throw new XiangqiAIResignedError(request.player, decision.info)
    }
    return {
      action,
      analysis: {
        info: decision.info,
        ucci: moveToUcci(action),
        source: 'engine',
        response,
        budgetMs: budget,
        multiPv,
      },
    }
  }
}

export interface HumanMatchTurnContext {
  engineId: string
  difficulty: DifficultyLevel
  seed: number
  requestToken: number
}

export interface HumanMatchControllerAIOptions extends ManagedAILifecycle {
  getContext(): HumanMatchTurnContext
  onInfo(player: Color, info: SearchInfo, requestToken: number): void
}

export function resolveHumanThinkPlan(context: HumanMatchTurnContext) {
  const profile = difficultyProfile(context.difficulty)
  const engineConfig = engineRegistry.getEngine(context.engineId)
  if (!engineConfig) throw new Error('选择了未注册的 AI 引擎。')
  const support = detectEngineSupport()
  const mapped = mapDifficultyToEngine(profile, engineConfig, {
    threads: support.threads,
    hashMb: support.hashMb,
  })
  return {
    profile,
    mapped,
    budget: difficultyThinkTime(profile, context.seed),
  }
}

export class HumanMatchControllerAI extends ManagedXiangqiAI {
  readonly id = 'xiangqi-human-match-controller'
  readonly name = '中国象棋人机兼容引擎'

  constructor(private readonly options: HumanMatchControllerAIOptions) {
    super(options)
  }

  async think(request: ThinkRequest): Promise<AIThinkResult<Move, XiangqiTurnAnalysis>> {
    const adapter = this.options.getAdapter(request.player)
    if (!adapter) throw new Error('人机对战 EngineAdapter 不存在。')
    const context = this.options.getContext()
    const { profile, mapped, budget } = resolveHumanThinkPlan(context)
    const response = await adapter.search(
      request.record.map((record) => record.ucci),
      budget,
      {
        multiPv: mapped.multiPv,
        maxDepth: mapped.maxDepth,
        onInfo: (info) =>
          this.options.onInfo(request.player, info, context.requestToken),
      },
    )
    if (!response.bestmove) throw new XiangqiNoBestMoveError(noBestMoveResult(request.state))
    const decision = selectDifficultyMove(response, profile, context.seed)
    const action = decision.ucci
      ? matchUcciMove(request.state.board, [...request.legalActions], decision.ucci)
      : null
    if (!action) throw new XiangqiIllegalEngineMoveError(decision.ucci ?? response.bestmove)
    return {
      action,
      analysis: {
        info: decision.info,
        ucci: moveToUcci(action),
        source: 'engine',
        response,
        budgetMs: budget,
        multiPv: mapped.multiPv,
      },
    }
  }
}
