import type { BoardState, Move } from '../../../vendor/web-katago/types'
import {
  getKataGoEngineClient,
  resetKataGoEngineClientForTests,
} from '../../../vendor/web-katago/engine/katago/client'
import { GoGameEngine } from '../game-engine'
import type { GoGameState, GoMove } from '../types'
import { gtpToGoMove, goPointToGtp } from './coordinates'
import type {
  KataGoAnalyzeRequest,
  KataGoCapabilities,
  KataGoSearchProfile,
  KataGoWireAnalysisEvent,
} from './types'
import type { KataGoAnalyzeOptions, KataGoTransport } from './KataGoTransport'

const STRONG_MODEL_PATH = 'api/go/model/strong.bin.gz'
const FALLBACK_MODEL_PATH = 'models/katago-small.bin.gz'

const PROFILES: Readonly<Record<KataGoSearchProfile, { maxVisits: number; timeoutMs: number }>> = {
  fast: { maxVisits: 200, timeoutMs: 8_000 },
  strong: { maxVisits: 800, timeoutMs: 30_000 },
}

export interface BrowserKataGoTransportOptions {
  strongModelUrl?: string
  fallbackModelUrl?: string
  backend?: 'webgpu' | 'wasm' | 'cpu'
}

/**
 * Browser-only KataGo-style neural MCTS transport.
 *
 * The model and search both run in a dedicated Worker. No API key, native
 * executable, Docker service or remote move-generation endpoint is involved.
 */
export class BrowserKataGoTransport implements KataGoTransport {
  private readonly strongModelUrl: string
  private readonly fallbackModelUrl: string
  private readonly backend: 'webgpu' | 'wasm' | 'cpu'
  private initialization: Promise<KataGoCapabilities> | null = null
  private activeModelUrl: string
  private activeRequestId: string | null = null
  private activeReject: ((error: Error) => void) | null = null
  private disposed = false

  constructor(options: BrowserKataGoTransportOptions = {}) {
    this.strongModelUrl = options.strongModelUrl ?? resolvePublicAsset(STRONG_MODEL_PATH)
    this.fallbackModelUrl = options.fallbackModelUrl ?? resolvePublicAsset(FALLBACK_MODEL_PATH)
    this.backend = options.backend ?? 'webgpu'
    this.activeModelUrl = this.strongModelUrl
  }

  initialize(signal?: AbortSignal): Promise<KataGoCapabilities> {
    this.assertActive()
    if (!this.initialization) this.initialization = this.loadModel(signal)
    return this.initialization
  }

  async analyze(
    request: KataGoAnalyzeRequest,
    options: KataGoAnalyzeOptions = {},
  ): Promise<KataGoWireAnalysisEvent> {
    this.assertActive()
    await this.initialize(options.signal)
    if (this.activeRequestId) throw new Error('浏览器 KataGo 已有一个进行中的搜索。')

    const position = replayPosition(request)
    const profile = PROFILES[request.profile]
    const client = getKataGoEngineClient()
    this.activeRequestId = request.requestId
    const abortSearch = () => this.cancel(request.requestId)
    options.signal?.addEventListener('abort', abortSearch, { once: true })

    const startedAt = performance.now()
    const search = client.analyze({
      analysisGroup: 'interactive',
      positionId: request.requestId,
      modelUrl: this.loadedModelUrl(),
      backend: this.backend,
      board: position.board,
      previousBoard: position.previousBoard,
      previousPreviousBoard: position.previousPreviousBoard,
      currentPlayer: request.player,
      moveHistory: position.moveHistory,
      komi: request.komi,
      rules: 'chinese',
      topK: 5,
      analysisPvLen: 12,
      conservativePass: true,
      visits: profile.maxVisits,
      maxTimeMs: profile.timeoutMs,
      batchSize: this.backend === 'webgpu' ? 16 : 4,
      maxChildren: 48,
      reportDuringSearchEveryMs: 500,
      reuseTree: true,
      ownershipMode: 'root',
      onProgress: (analysis) => {
        if (this.activeRequestId !== request.requestId) return
        options.onUpdate?.(toWireEvent(request, analysis, startedAt, 'partial'))
      },
    })

    try {
      const analysis = await raceCancellation(search, options.signal, (reject) => {
        this.activeReject = reject
      })
      return toWireEvent(request, analysis, startedAt, 'final')
    } finally {
      options.signal?.removeEventListener('abort', abortSearch)
      if (this.activeRequestId === request.requestId) {
        this.activeRequestId = null
        this.activeReject = null
      }
    }
  }

  cancel(requestId: string): void {
    if (requestId !== this.activeRequestId) return
    this.activeReject?.(createAbortError('浏览器 KataGo 搜索已停止。'))
    getKataGoEngineClient().cancelAnalysis('interactive')
    this.activeRequestId = null
    this.activeReject = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.activeReject?.(createAbortError('浏览器 KataGo 已释放。'))
    this.resetWorker()
  }

  private async loadModel(signal?: AbortSignal): Promise<KataGoCapabilities> {
    try {
      await raceCancellation(
        getKataGoEngineClient().init(this.strongModelUrl, this.backend),
        signal,
        () => undefined,
      )
      this.activeModelUrl = this.strongModelUrl
    } catch (strongError) {
      if (signal?.aborted) throw signal.reason ?? strongError
      resetKataGoEngineClientForTests()
      try {
        await raceCancellation(
          getKataGoEngineClient().init(this.fallbackModelUrl, this.backend),
          signal,
          () => undefined,
        )
        this.activeModelUrl = this.fallbackModelUrl
      } catch (fallbackError) {
        this.initialization = null
        throw new Error(
          `浏览器围棋 AI 模型加载失败：${errorText(fallbackError)}（强模型错误：${errorText(strongError)}）`,
        )
      }
    }

    const info = getKataGoEngineClient().getEngineInfo()
    return {
      ready: true,
      engineVersion: `Browser KataGo MCTS / ${info.backend ?? this.backend}`,
      modelName: info.modelName ?? modelNameFromUrl(this.loadedModelUrl()),
      profiles: PROFILES,
    }
  }

  private loadedModelUrl(): string {
    return this.activeModelUrl
  }

  private resetWorker(): void {
    resetKataGoEngineClientForTests()
    this.initialization = null
    this.activeRequestId = null
    this.activeReject = null
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('浏览器 KataGo 已经释放。')
  }
}

type BrowserAnalysis = Awaited<ReturnType<ReturnType<typeof getKataGoEngineClient>['analyze']>>

function toWireEvent(
  request: KataGoAnalyzeRequest,
  analysis: BrowserAnalysis,
  startedAt: number,
  stage: 'partial' | 'final',
): KataGoWireAnalysisEvent {
  const info = getKataGoEngineClient().getEngineInfo()
  return {
    type: 'analysis',
    stage,
    requestId: request.requestId,
    engineVersion: `Browser KataGo MCTS / ${info.backend ?? 'unknown'}`,
    modelName: info.modelName ?? 'KataGo browser model',
    profile: request.profile,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    truncated: stage === 'final' && analysis.rootVisits < PROFILES[request.profile].maxVisits,
    root: {
      winrate: analysis.rootWinRate,
      scoreLead: finiteOrNull(analysis.rootScoreLead),
      visits: analysis.rootVisits,
    },
    candidates: analysis.moves.slice(0, 5).map((move, order) => ({
      move: move.x < 0 || move.y < 0 ? 'pass' : goPointToGtp({ row: move.y, col: move.x }),
      order,
      visits: move.visits,
      prior: finiteOrNull(move.prior),
      winrate: move.winRate,
      scoreLead: finiteOrNull(move.scoreLead),
      pv: move.pv ?? [],
    })),
  }
}

function replayPosition(request: KataGoAnalyzeRequest): {
  board: BoardState
  previousBoard: BoardState
  previousPreviousBoard: BoardState
  moveHistory: Move[]
} {
  const engine = new GoGameEngine()
  let state: GoGameState = engine.init()
  const boards: BoardState[] = [copyBoard(state.board)]
  const moveHistory: Move[] = []

  for (const [color, notation] of request.moves) {
    const expectedColor = color === 'B' ? 'black' : 'white'
    if (state.turn !== expectedColor) throw new Error('围棋棋谱行棋方顺序无效。')
    const move = gtpToGoMove(notation)
    moveHistory.push(toBrowserMove(move, expectedColor))
    state = engine.applyMove(state, move)
    boards.push(copyBoard(state.board))
  }

  const current = boards.at(-1) ?? copyBoard(state.board)
  return {
    board: current,
    previousBoard: boards.at(-2) ?? current,
    previousPreviousBoard: boards.at(-3) ?? boards.at(-2) ?? current,
    moveHistory,
  }
}

function toBrowserMove(move: GoMove, player: 'black' | 'white'): Move {
  return move.kind === 'pass'
    ? { x: -1, y: -1, player }
    : { x: move.col, y: move.row, player }
}

function copyBoard(board: GoGameState['board']): BoardState {
  return board.map((row) => [...row])
}

function resolvePublicAsset(path: string): string {
  if (typeof document !== 'undefined') return new URL(path, document.baseURI).toString()
  return `/${path}`
}

function modelNameFromUrl(url: string): string {
  return url.split('/').at(-1)?.split('?')[0] ?? url
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createAbortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

function raceCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  exposeReject: (reject: (error: Error) => void) => void,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? createAbortError('操作已取消。'))
  return new Promise<T>((resolve, reject) => {
    const rejectError = (error: Error) => reject(error)
    exposeReject(rejectError)
    const abort = () => reject(signal?.reason ?? createAbortError('操作已取消。'))
    signal?.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
  })
}
