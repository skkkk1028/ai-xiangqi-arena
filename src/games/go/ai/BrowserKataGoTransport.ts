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
  KataGoRuntimeBackend,
  KataGoSearchProfile,
  KataGoWireAnalysisEvent,
} from './types'
import type { KataGoAnalyzeOptions, KataGoTransport } from './KataGoTransport'

const STRONG_MODEL_PATH = 'api/go/model/strong.bin.gz'
const FALLBACK_MODEL_PATH = 'models/katago-small.bin.gz'

const PROFILES: Readonly<
  Record<KataGoSearchProfile | 'winrate', { maxVisits: number; timeoutMs: number }>
> = {
  fast: { maxVisits: 2_000, timeoutMs: 30_000 },
  strong: { maxVisits: 20_000, timeoutMs: 180_000 },
  winrate: { maxVisits: 256, timeoutMs: 12_000 },
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
  private modelFallback = false
  private modelFallbackReason: string | null = null
  private readonly activeRequests = new Map<string, 'interactive' | 'background'>()
  private readonly activeRejects = new Map<string, (error: Error) => void>()
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
    if (request.profile === 'battle-matched') {
      throw new Error('AI 互对弈的匹配档位仅支持本机 Native KataGo。')
    }
    const capabilities = await this.initialize(options.signal)
    const analysisGroup = options.analysisGroup ?? 'interactive'
    if ([...this.activeRequests.values()].includes(analysisGroup)) {
      throw new Error(`浏览器 KataGo 的 ${analysisGroup} 分析组已有一个进行中的搜索。`)
    }

    const position = replayPosition(request)
    const profile = PROFILES[request.profile]
    const client = getKataGoEngineClient()
    this.activeRequests.set(request.requestId, analysisGroup)
    const abortSearch = () => this.cancel(request.requestId)
    options.signal?.addEventListener('abort', abortSearch, { once: true })

    const startedAt = performance.now()
    const search = client.analyze({
      analysisGroup,
      positionId: position.positionKey,
      parentPositionId: position.parentPositionKey,
      positionKey: position.positionKey,
      parentPositionKey: position.parentPositionKey,
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
      maxChildren: 361,
      reportDuringSearchEveryMs: 500,
      reuseTree: true,
      ownershipMode: 'root',
      wideRootNoise: 0,
      nnRandomize: false,
      onProgress: (analysis) => {
        if (!this.activeRequests.has(request.requestId)) return
        options.onUpdate?.(toWireEvent(request, analysis, startedAt, 'partial', capabilities))
      },
    })

    try {
      const analysis = await raceCancellation(search, options.signal, (reject) => {
        this.activeRejects.set(request.requestId, reject)
      })
      return toWireEvent(request, analysis, startedAt, 'final', capabilities)
    } finally {
      options.signal?.removeEventListener('abort', abortSearch)
      this.activeRequests.delete(request.requestId)
      this.activeRejects.delete(request.requestId)
    }
  }

  cancel(requestId: string): void {
    const group = this.activeRequests.get(requestId)
    if (!group) return
    this.activeRejects.get(requestId)?.(createAbortError('浏览器 KataGo 搜索已停止。'))
    getKataGoEngineClient().cancelAnalysis(group)
    this.activeRequests.delete(requestId)
    this.activeRejects.delete(requestId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const reject of this.activeRejects.values()) reject(createAbortError('浏览器 KataGo 已释放。'))
    this.activeRequests.clear()
    this.activeRejects.clear()
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
      this.modelFallback = false
      this.modelFallbackReason = null
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
        this.modelFallback = true
        this.modelFallbackReason = `强模型加载失败：${errorText(strongError)}`
      } catch (fallbackError) {
        this.initialization = null
        throw new Error(
          `浏览器围棋 AI 模型加载失败：${errorText(fallbackError)}（强模型错误：${errorText(strongError)}）`,
        )
      }
    }

    const info = getKataGoEngineClient().getEngineInfo()
    const actualBackend = browserRuntimeBackend(info.backend ?? this.backend)
    const requestedBackend = browserRuntimeBackend(this.backend)
    return {
      ready: true,
      engineVersion: `Browser KataGo MCTS / ${info.backend ?? this.backend}`,
      modelName: info.modelName ?? modelNameFromUrl(this.loadedModelUrl()),
      runtimeBackend: actualBackend,
      requestedBackend,
      backendFallback: actualBackend !== requestedBackend,
      backendFallbackReason: backendFallbackReason(requestedBackend, actualBackend),
      modelFallback: this.modelFallback,
      modelFallbackReason: this.modelFallbackReason,
      profiles: PROFILES,
    }
  }

  private loadedModelUrl(): string {
    return this.activeModelUrl
  }

  private resetWorker(): void {
    resetKataGoEngineClientForTests()
    this.initialization = null
    this.activeRequests.clear()
    this.activeRejects.clear()
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
  capabilities: KataGoCapabilities,
): KataGoWireAnalysisEvent {
  if (request.profile === 'battle-matched') {
    throw new Error('浏览器 KataGo 不支持 battle-matched 档位。')
  }
  const info = getKataGoEngineClient().getEngineInfo()
  const requestedVisits = PROFILES[request.profile].maxVisits
  const visits = analysis.rootVisits
  const timedOut = stage === 'final' && visits < requestedVisits
  const actualBackend = info.backend
    ? browserRuntimeBackend(info.backend)
    : capabilities.runtimeBackend
  const requestedBackend = capabilities.requestedBackend
  return {
    type: 'analysis',
    stage,
    requestId: request.requestId,
    engineVersion: `Browser KataGo MCTS / ${info.backend ?? 'unknown'}`,
    modelName: info.modelName ?? 'KataGo browser model',
    profile: request.profile,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    requestedVisits,
    runtimeBackend: actualBackend,
    requestedBackend,
    backendFallback: actualBackend !== requestedBackend,
    backendFallbackReason: backendFallbackReason(requestedBackend, actualBackend),
    modelFallback: capabilities.modelFallback,
    modelFallbackReason: capabilities.modelFallbackReason,
    timedOut,
    truncated: timedOut,
    stopReason: stage === 'partial' ? 'in-progress' : timedOut ? 'time-limit' : 'visit-limit',
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
  positionKey: string
  parentPositionKey?: string
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
    positionKey: stablePositionKey(request.moves),
    parentPositionKey: request.moves.length > 0
      ? stablePositionKey(request.moves.slice(0, -1))
      : undefined,
  }
}

function stablePositionKey(moves: KataGoAnalyzeRequest['moves']): string {
  return moves.map(([color, move]) => `${color}:${move.toUpperCase()}`).join('|') || 'initial'
}

function browserRuntimeBackend(value: string): KataGoRuntimeBackend {
  if (value.toLowerCase() === 'webgpu') return 'browser-webgpu'
  if (value.toLowerCase() === 'wasm') return 'browser-wasm'
  return 'browser-cpu'
}

function backendFallbackReason(
  requested: KataGoRuntimeBackend,
  actual: KataGoRuntimeBackend,
): string | null {
  if (requested === actual) return null
  return `请求 ${runtimeBackendLabel(requested)}，实际使用 ${runtimeBackendLabel(actual)}`
}

function runtimeBackendLabel(backend: KataGoRuntimeBackend): string {
  if (backend === 'browser-webgpu') return 'Browser WebGPU'
  if (backend === 'browser-wasm') return 'Browser WASM'
  if (backend === 'browser-cpu') return 'CPU fallback'
  return 'Native KataGo'
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
