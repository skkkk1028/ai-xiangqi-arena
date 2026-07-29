import type { EngineProfile, SearchInfo, SearchResponse } from '../game/types'
import { parseBestmove, parseInfoLine } from './ucci'

export interface EngineProgress {
  phase: 'checking' | 'downloading' | 'loading' | 'verifying' | 'initializing' | 'ready'
  loaded: number
  total: number
  message: string
}

type WorkerEvent =
  | { type: 'progress'; progress: EngineProgress }
  | { type: 'ready'; profile: EngineProfile }
  | { type: 'line'; line: string; searchId: number }
  | { type: 'fatal'; message: string }

interface PendingSearch {
  id: number
  resolve: (response: SearchResponse) => void
  reject: (error: Error) => void
  info: SearchInfo
  onInfo?: (info: SearchInfo) => void
}

const EMPTY_INFO: SearchInfo = {
  depth: 0,
  nodes: 0,
  nps: 0,
  elapsedMs: 0,
  score: null,
  wdl: null,
  pv: [],
}

export class UcciEngineClient {
  private worker: Worker | null = null
  private pending: PendingSearch | null = null
  private initPromise: Promise<EngineProfile> | null = null
  private fatalHandler: ((error: Error) => void) | null = null
  private nextSearchId = 0

  constructor(
    private readonly assetBase: string,
    private readonly threads: number,
    private readonly hashMb: number,
    private readonly onProgress: (progress: EngineProgress) => void,
  ) {}

  init(): Promise<EngineProfile> {
    if (this.initPromise) return this.initPromise
    this.initPromise = new Promise((resolve, reject) => {
      const workerUrl = new URL('engine/ucci.worker.js', this.assetBase).href
      this.worker = new Worker(workerUrl)
      this.fatalHandler = reject
      this.worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        const message = event.data
        if (message.type === 'progress') this.onProgress(message.progress)
        else if (message.type === 'ready') {
          this.fatalHandler = null
          resolve(message.profile)
        } else if (message.type === 'line') this.handleLine(message.line, message.searchId)
        else if (message.type === 'fatal') this.handleFatal(new Error(message.message))
      }
      this.worker.onerror = (event) =>
        this.handleFatal(new Error(event.message || '专业引擎 Worker 启动失败。'))
      this.worker.postMessage({
        type: 'init',
        assetBase: new URL('engine/', this.assetBase).href,
        threads: this.threads,
        hashMb: this.hashMb,
      })
    })
    return this.initPromise
  }

  search(
    moves: string[],
    movetimeMs: number,
    onInfo?: (info: SearchInfo) => void,
  ): Promise<SearchResponse> {
    if (!this.worker) return Promise.reject(new Error('引擎尚未初始化。'))
    if (this.pending) return Promise.reject(new Error('引擎已有搜索任务。'))
    return new Promise((resolve, reject) => {
      const id = ++this.nextSearchId
      this.pending = { id, resolve, reject, info: { ...EMPTY_INFO, pv: [] }, onInfo }
      this.worker!.postMessage({
        type: 'search',
        searchId: id,
        moves,
        movetimeMs: Math.max(50, Math.floor(movetimeMs)),
      })
    })
  }

  stop(reason = '搜索已取消。'): void {
    if (this.pending) {
      const pending = this.pending
      this.pending = null
      pending.reject(new DOMException(reason, 'AbortError'))
    }
    this.worker?.postMessage({ type: 'stop' })
  }

  newGame(): void {
    this.stop('已开始新对局。')
    this.worker?.postMessage({ type: 'newgame' })
  }

  dispose(): void {
    this.stop('引擎已关闭。')
    this.worker?.terminate()
    this.worker = null
    this.initPromise = null
  }

  private handleLine(line: string, searchId: number): void {
    const pending = this.pending
    if (!pending || pending.id !== searchId) return
    const info = parseInfoLine(line, pending.info)
    if (info) {
      pending.info = info
      pending.onInfo?.(info)
    }
    const bestmove = parseBestmove(line)
    if (bestmove !== undefined) {
      this.pending = null
      pending.resolve({ bestmove, info: pending.info })
    }
  }

  private handleFatal(error: Error): void {
    this.fatalHandler?.(error)
    this.fatalHandler = null
    if (this.pending) {
      this.pending.reject(error)
      this.pending = null
    }
  }
}
