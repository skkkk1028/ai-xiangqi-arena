import type { EngineAdapter } from '../../engine/adapter'
import { matchUcciMove } from '../../engine/ucci'
import type { EngineSearchOptions } from '../../engine/types'
import type {
  EngineProfile,
  EngineSearchResponse,
  Move,
} from '../../game/types'
import type { AIEngine, AIThinkRequest, AIThinkResult } from '../core'
import type { Color } from '../../game/types'
import type { XiangqiGameState, XiangqiRecordEntry } from './game-engine'

type XiangqiThinkRequest = AIThinkRequest<
  XiangqiGameState,
  Move,
  Color,
  XiangqiRecordEntry
>

export interface XiangqiAIEngineOptions {
  movetimeMs: number | ((request: XiangqiThinkRequest) => number)
  search: EngineSearchOptions
  selectMove?: (
    response: EngineSearchResponse,
    request: XiangqiThinkRequest,
  ) => string | null
}

/** Bridges the current UCCI/UCI Worker adapter into the game-neutral AI contract. */
export class XiangqiAIEngineAdapter
  implements
    AIEngine<
      XiangqiGameState,
      Move,
      Color,
      XiangqiRecordEntry,
      EngineSearchResponse
    >
{
  readonly id: string
  readonly name: string
  private profile: EngineProfile | null = null

  constructor(
    private readonly adapter: EngineAdapter,
    private readonly options: XiangqiAIEngineOptions,
  ) {
    this.id = adapter.config.id
    this.name = adapter.config.name
  }

  get engineProfile(): EngineProfile | null {
    return this.profile
  }

  async initialize(): Promise<void> {
    this.profile = await this.adapter.init()
  }

  newGame(): void {
    this.adapter.newGame()
  }

  async think(
    request: XiangqiThinkRequest,
  ): Promise<AIThinkResult<Move, EngineSearchResponse>> {
    if (request.signal?.aborted) throw new DOMException('AI 行棋已取消。', 'AbortError')
    const abortSearch = () => this.adapter.stop('AI 行棋已取消。')
    request.signal?.addEventListener('abort', abortSearch, { once: true })
    try {
      const movetimeMs =
        typeof this.options.movetimeMs === 'function'
          ? this.options.movetimeMs(request)
          : this.options.movetimeMs
      const response = await this.adapter.search(
        request.record.map((entry) => entry.ucci),
        movetimeMs,
        this.options.search,
      )
      if (request.signal?.aborted) throw new DOMException('AI 行棋已取消。', 'AbortError')
      const ucci = this.options.selectMove?.(response, request) ?? response.bestmove
      const action = ucci
        ? matchUcciMove(request.state.board, [...request.legalActions], ucci)
        : null
      if (!action) throw new Error(`${this.name} 返回了无效或非法着法。`)
      return { action, analysis: response }
    } finally {
      request.signal?.removeEventListener('abort', abortSearch)
    }
  }

  stop(reason?: string): void {
    this.adapter.stop(reason)
  }

  dispose(): void {
    this.profile = null
    this.adapter.dispose()
  }
}
