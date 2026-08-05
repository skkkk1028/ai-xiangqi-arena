import type {
  EngineProfile,
  EngineSearchResponse,
  SearchCandidate,
  SearchCandidateSnapshot,
  SearchInfo,
} from '../game/types'
import { configureFairyStockfish } from './config'
import { UcciParser } from './parsers/ucci-parser'
import type { EngineAdapter } from './adapter'
import type {
  AIEngineConfig,
  EngineAdapterContext,
  EngineProgress,
  EngineSearchOptions,
} from './types'

export type { EngineProgress, EngineSearchOptions } from './types'

type WorkerEvent =
  | { type: 'progress'; progress: EngineProgress }
  | { type: 'ready'; profile: EngineProfile }
  | { type: 'search-started'; searchId: number }
  | { type: 'line'; line: string; searchId: number }
  | { type: 'fatal'; message: string }

interface PendingSearch {
  id: number
  resolve: (response: EngineSearchResponse) => void
  reject: (error: Error) => void
  info: SearchInfo
  candidates: Map<number, SearchCandidate>
  candidatesByMove: Map<string, SearchCandidate>
  onInfo?: (info: SearchInfo) => void
  timeoutId: number
  movetimeMs: number
}

const SEARCH_TIMEOUT_GRACE_MS = 5_000
const SEARCH_START_TIMEOUT_MS = 35_000

const EMPTY_INFO: SearchInfo = {
  depth: 0,
  nodes: 0,
  nps: 0,
  elapsedMs: 0,
  score: null,
  wdl: null,
  pv: [],
}

export class WorkerEngineAdapter implements EngineAdapter {
  readonly config: Readonly<AIEngineConfig>
  private readonly assetBase: string
  private readonly onProgress: (progress: EngineProgress) => void
  private readonly onRuntimeFatal?: (error: Error) => void
  private worker: Worker | null = null
  private pending: PendingSearch | null = null
  private initPromise: Promise<EngineProfile> | null = null
  private fatalHandler: ((error: Error) => void) | null = null
  private nextSearchId = 0
  private ready = false
  private readonly parser = new UcciParser()

  constructor(config: Readonly<AIEngineConfig>, context: EngineAdapterContext) {
    this.config = config
    this.assetBase = context.assetBase
    this.onProgress = context.onProgress
    this.onRuntimeFatal = context.onRuntimeFatal
  }

  static createFairyContext(
    assetBase: string,
    onProgress: (progress: EngineProgress) => void,
    onRuntimeFatal?: (error: Error) => void,
  ): EngineAdapterContext {
    return { assetBase, onProgress, onRuntimeFatal }
  }

  init(): Promise<EngineProfile> {
    if (this.initPromise) return this.initPromise
    this.initPromise = new Promise((resolve, reject) => {
      const engineBase = new URL('engine/', this.assetBase).href
      const workerUrl = new URL(this.config.workerPath, engineBase).href
      this.worker = new Worker(workerUrl)
      this.fatalHandler = reject
      this.worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        const message = event.data
        if (message.type === 'progress') this.onProgress(message.progress)
        else if (message.type === 'ready') {
          this.ready = true
          this.fatalHandler = null
          resolve(message.profile)
        } else if (message.type === 'search-started') this.handleSearchStarted(message.searchId)
        else if (message.type === 'line') this.handleLine(message.line, message.searchId)
        else if (message.type === 'fatal') this.handleFatal(new Error(message.message))
      }
      this.worker.onerror = (event) =>
        this.handleFatal(new Error(event.message || '专业引擎 Worker 启动失败。'))
      this.worker.postMessage({
        type: 'init',
        assetBase: engineBase,
        adapterUrl: new URL(this.config.adapterPath, engineBase).href,
        config: this.config,
      })
    })
    return this.initPromise
  }

  search(
    moves: string[],
    movetimeMs: number,
    options: EngineSearchOptions,
  ): Promise<EngineSearchResponse> {
    if (!this.worker || !this.ready) return Promise.reject(new Error('引擎尚未就绪。'))
    if (this.pending) return Promise.reject(new Error('引擎已有搜索任务。'))
    return new Promise((resolve, reject) => {
      const id = ++this.nextSearchId
      const effectiveMovetimeMs = Math.max(50, Math.floor(movetimeMs))
      const timeoutId = window.setTimeout(
        () => this.handleSearchStartTimeout(id),
        SEARCH_START_TIMEOUT_MS,
      )
      this.pending = {
        id,
        resolve,
        reject,
        info: { ...EMPTY_INFO, pv: [] },
        candidates: new Map(),
        candidatesByMove: new Map(),
        onInfo: options.onInfo,
        timeoutId,
        movetimeMs: effectiveMovetimeMs,
      }
      this.worker!.postMessage({
        type: 'search',
        searchId: id,
        moves,
        movetimeMs: effectiveMovetimeMs,
        multiPv: options.multiPv,
        maxDepth: options.maxDepth,
      })
    })
  }

  sendCommand(command: string): void {
    if (!this.worker || !this.ready) throw new Error('引擎尚未就绪。')
    this.worker.postMessage({ type: 'command', command })
  }

  setPosition(moves: string[]): void {
    if (!this.worker || !this.ready) throw new Error('引擎尚未就绪。')
    this.worker.postMessage({ type: 'set-position', moves: [...moves] })
  }

  stop(reason = '搜索已取消。'): void {
    if (this.pending) {
      const pending = this.pending
      this.pending = null
      window.clearTimeout(pending.timeoutId)
      pending.reject(new DOMException(reason, 'AbortError'))
    }
    this.worker?.postMessage({ type: 'stop' })
  }

  newGame(): void {
    this.stop('已开始新对局。')
    this.worker?.postMessage({ type: 'newgame' })
  }

  dispose(): void {
    const rejectInitialization = this.fatalHandler
    this.fatalHandler = null
    rejectInitialization?.(new Error('引擎初始化已取消。'))
    this.stop('引擎已关闭。')
    const worker = this.worker
    this.worker = null
    this.ready = false
    this.initPromise = null
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
  }

  private handleLine(line: string, searchId: number): void {
    const pending = this.pending
    if (!pending || pending.id !== searchId) return
    const rank = this.parser.readMultiPvRank(line)
    const freshInfo = this.parser.parseInfo(line)
    if (freshInfo && this.parser.isCompleteRootInfo(line, freshInfo)) {
      const rootMove = freshInfo.pv[0]
      const lastForMove = pending.candidatesByMove.get(rootMove)
      const previous = previousSnapshot(lastForMove, freshInfo.depth)
      const lastForRank = pending.candidates.get(rank)
      const previousPrincipal =
        rank === 1 ? previousPrincipalSnapshot(lastForRank, freshInfo.depth) : undefined
      const candidate = { ...freshInfo, multipv: rank, previous, previousPrincipal }
      if (!lastForRank || candidate.depth >= lastForRank.depth) {
        pending.candidates.set(rank, candidate)
      }
      if (!lastForMove || candidate.depth >= lastForMove.depth) {
        pending.candidatesByMove.set(rootMove, candidate)
      }
    }
    if (rank === 1) {
      const liveInfo = this.parser.parseInfo(line, pending.info)
      if (liveInfo) {
        pending.info = liveInfo
        pending.onInfo?.(liveInfo)
      }
    }
    const bestmove = this.parser.parseBestmove(line)
    if (bestmove !== undefined) {
      this.pending = null
      window.clearTimeout(pending.timeoutId)
      const candidates = [...pending.candidates.values()].sort(
        (left, right) => left.multipv - right.multipv,
      )
      const principal = candidates.find(
        (candidate) => candidate.multipv === 1 && candidate.pv[0] === bestmove,
      )
      pending.resolve({
        bestmove,
        info: principal ?? pending.info,
        candidates,
      })
    }
  }

  private handleSearchStarted(searchId: number): void {
    const pending = this.pending
    if (!pending || pending.id !== searchId) return
    window.clearTimeout(pending.timeoutId)
    pending.timeoutId = window.setTimeout(
      () => this.handleSearchTimeout(searchId, pending.movetimeMs),
      pending.movetimeMs + SEARCH_TIMEOUT_GRACE_MS,
    )
  }

  private handleSearchStartTimeout(searchId: number): void {
    const pending = this.pending
    if (!pending || pending.id !== searchId) return
    this.pending = null
    this.worker?.postMessage({ type: 'stop' })
    pending.reject(new Error(`引擎未在 ${SEARCH_START_TIMEOUT_MS} ms 内开始搜索，已停止并准备恢复。`))
  }

  private handleSearchTimeout(searchId: number, movetimeMs: number): void {
    const pending = this.pending
    if (!pending || pending.id !== searchId) return
    this.pending = null
    this.worker?.postMessage({ type: 'stop' })
    pending.reject(
      new Error(`引擎搜索超过 ${movetimeMs + SEARCH_TIMEOUT_GRACE_MS} ms，已停止并准备恢复。`),
    )
  }

  private handleFatal(error: Error): void {
    const initializing = this.fatalHandler !== null
    const searching = this.pending !== null
    this.fatalHandler?.(error)
    this.fatalHandler = null
    this.ready = false
    if (this.pending) {
      window.clearTimeout(this.pending.timeoutId)
      this.pending.reject(error)
      this.pending = null
    }
    if (!initializing && !searching) this.onRuntimeFatal?.(error)
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

export class FairyStockfishAdapter extends WorkerEngineAdapter {
  constructor(config: Readonly<AIEngineConfig>, context: EngineAdapterContext)
  constructor(
    assetBase: string,
    threads: number,
    hashMb: number,
    onProgress: (progress: EngineProgress) => void,
    onRuntimeFatal?: (error: Error) => void,
  )
  constructor(
    configOrAssetBase: Readonly<AIEngineConfig> | string,
    contextOrThreads: EngineAdapterContext | number,
    hashMb?: number,
    onProgress?: (progress: EngineProgress) => void,
    onRuntimeFatal?: (error: Error) => void,
  ) {
    if (typeof configOrAssetBase === 'string') {
      super(
        configureFairyStockfish(contextOrThreads as number, hashMb ?? 64),
        WorkerEngineAdapter.createFairyContext(
          configOrAssetBase,
          onProgress ?? (() => undefined),
          onRuntimeFatal,
        ),
      )
    } else {
      super(configOrAssetBase, contextOrThreads as EngineAdapterContext)
    }
  }
}

export class PikafishAdapter extends WorkerEngineAdapter {
  constructor(config: Readonly<AIEngineConfig>, context: EngineAdapterContext) {
    super(config, context)
  }
}

export { FairyStockfishAdapter as UcciEngineClient }
