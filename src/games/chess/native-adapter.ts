import type { EngineAdapter } from '../../engine/adapter'
import { WorkerEngineAdapter } from '../../engine/client'
import { CHESS_STOCKFISH_18_CONFIG, CHESS_STOCKFISH_18_SINGLE_CONFIG } from '../../engine/config'
import type { AIEngineConfig, EngineAdapterContext, EngineSearchOptions } from '../../engine/types'
import type { EngineProfile, EngineSearchResponse } from '../../game/types'

interface NativeCapabilities {
  ready: boolean
  engineVersion: string
  binarySha256: string
  runtimeBackend: 'native-stockfish-18'
  threads: number
  hashMb: number
}

export class ChessNativeStockfishAdapter implements EngineAdapter {
  readonly config: Readonly<AIEngineConfig>
  private readonly context: EngineAdapterContext
  private fallback: WorkerEngineAdapter | null = null
  private native = false
  private abort: AbortController | null = null
  private closed = false

  constructor(config: Readonly<AIEngineConfig>, context: EngineAdapterContext) {
    this.config = config
    this.context = context
  }

  async init(): Promise<EngineProfile> {
    if (this.closed) throw new DOMException('引擎会话已结束。', 'AbortError')
    this.context.onProgress({ phase: 'checking', loaded: 0, total: 1, message: '检查本地 Stockfish 18 原生桥接' })
    try {
      const response = await fetch('/api/chess/stockfish/capabilities', { signal: AbortSignal.timeout(5_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const capabilities = await response.json() as NativeCapabilities
      if (!capabilities.ready || capabilities.runtimeBackend !== 'native-stockfish-18') throw new Error('桥接身份校验失败。')
      if (this.closed) throw new DOMException('引擎会话已结束。', 'AbortError')
      this.native = true
      this.context.onProgress({ phase: 'ready', loaded: 1, total: 1, message: 'Stockfish 18 原生桥接已就绪' })
      return {
        id: this.config.id,
        engineType: this.config.engineType,
        protocol: 'UCI',
        name: 'Stockfish 18 · Native UCI',
        version: capabilities.engineVersion,
        commit: 'cb3d4ee',
        network: 'Stockfish 18 embedded NNUE',
        networkSha256: capabilities.binarySha256,
        threads: capabilities.threads,
        hashMb: capabilities.hashMb,
      }
    } catch {
      if (this.closed) throw new DOMException('引擎会话已结束。', 'AbortError')
      const multithread = typeof SharedArrayBuffer === 'function' && window.crossOriginIsolated === true
      const base = multithread ? CHESS_STOCKFISH_18_CONFIG : CHESS_STOCKFISH_18_SINGLE_CONFIG
      const fallbackConfig: AIEngineConfig = {
        ...base,
        options: { ...base.options },
        timeControl: { ...base.timeControl },
        threads: multithread ? this.config.threads : 1,
        hash: multithread ? this.config.hash : 64,
      }
      this.context.onProgress({ phase: 'loading', loaded: 0, total: 1, message: '原生桥接不可用，回退完整浏览器 Stockfish 18' })
      this.fallback = new WorkerEngineAdapter(fallbackConfig, this.context)
      return this.fallback.init()
    }
  }

  async search(moves: string[], movetimeMs: number, options: EngineSearchOptions): Promise<EngineSearchResponse> {
    if (!this.native) return this.fallback!.search(moves, movetimeMs, options)
    this.abort = new AbortController()
    try {
      const response = await fetch('/api/chess/stockfish/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: `chess-${crypto.randomUUID()}`,
          moves,
          initialFen: options.initialFen,
          movetimeMs,
          multiPv: options.multiPv,
          threads: this.config.threads,
          hashMb: this.config.hash,
          ...(options.maxDepth ? { maxDepth: options.maxDepth } : {}),
        }),
        signal: this.abort.signal,
      })
      if (!response.ok) throw new Error(`Stockfish 18 原生桥接搜索失败：HTTP ${response.status} ${await response.text()}`)
      const result = await response.json() as EngineSearchResponse
      options.onInfo?.(result.info)
      return result
    } finally {
      this.abort = null
    }
  }

  sendCommand(command: string): void { this.fallback?.sendCommand(command) }
  setPosition(moves: string[]): void { this.fallback?.setPosition(moves) }
  stop(reason = '搜索已取消。'): void { this.abort?.abort(new DOMException(reason, 'AbortError')); this.abort = null; this.fallback?.stop(reason) }
  newGame(): void { this.fallback?.newGame() }
  dispose(): void { this.closed = true; this.stop('引擎已关闭。'); this.fallback?.dispose(); this.fallback = null; this.native = false }
}
