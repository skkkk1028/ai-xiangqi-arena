import type { EngineAdapter } from '../../engine/adapter'
import { WorkerEngineAdapter } from '../../engine/client'
import { CHESS_STOCKFISH_18_CONFIG, CHESS_STOCKFISH_18_SINGLE_CONFIG } from '../../engine/config'
import type { AIEngineConfig, EngineAdapterContext, EngineSearchOptions } from '../../engine/types'
import type { EngineProfile, EngineSearchResponse } from '../../game/types'
import type { ChessArenaEngineId } from './types'

interface ArenaSession {
  token: string
  engineId: ChessArenaEngineId
  engineVersion: string
  commit: string
  binarySha256: string
  networkSha256: string | null
  threads: number
  hashMb: number
}

export class ChessArenaNativeAdapter implements EngineAdapter {
  readonly config: Readonly<AIEngineConfig>
  private session: ArenaSession | null = null
  private fallback: WorkerEngineAdapter | null = null
  private abort: AbortController | null = null

  constructor(
    config: Readonly<AIEngineConfig>,
    private readonly context: EngineAdapterContext,
    private readonly engineId: Extract<ChessArenaEngineId, 'stockfish-18' | 'obsidian-16'>,
  ) { this.config = config }

  async init(): Promise<EngineProfile> {
    this.context.onProgress({ phase: 'checking', loaded: 0, total: 1, message: `检查 ${this.config.name} 竞技场桥接` })
    try {
      this.session = await this.createNativeSession()
      this.context.onProgress({ phase: 'ready', loaded: 1, total: 1, message: `${this.config.name} 独立原生会话已就绪` })
      return {
        id: this.config.id, engineType: this.config.engineType, protocol: 'UCI',
        name: `${this.session.engineVersion} · Arena Native`, version: this.session.engineVersion,
        commit: this.session.commit, network: this.config.nnuePath,
        networkSha256: this.session.networkSha256 ?? this.session.binarySha256,
        threads: this.session.threads, hashMb: this.session.hashMb,
      }
    } catch (error) {
      if (this.engineId === 'obsidian-16') {
        throw new Error(`Obsidian 16 需要本地竞技场桥接：${error instanceof Error ? error.message : String(error)}`)
      }
      const multithread = typeof SharedArrayBuffer === 'function' && window.crossOriginIsolated === true
      const base = multithread ? CHESS_STOCKFISH_18_CONFIG : CHESS_STOCKFISH_18_SINGLE_CONFIG
      const fallbackConfig: AIEngineConfig = {
        ...base, options: { ...base.options }, timeControl: { ...base.timeControl },
        threads: multithread ? this.config.threads : 1, hash: multithread ? this.config.hash : 64,
      }
      this.context.onProgress({ phase: 'loading', loaded: 0, total: 1, message: '竞技场桥接不可用，回退浏览器 Stockfish 18' })
      this.fallback = new WorkerEngineAdapter(fallbackConfig, this.context)
      return this.fallback.init()
    }
  }

  async search(moves: string[], movetimeMs: number, options: EngineSearchOptions): Promise<EngineSearchResponse> {
    if (!this.session) return this.fallback!.search(moves, movetimeMs, options)
    this.abort = new AbortController()
    try {
      const response = await fetch(`/api/chess/arena/sessions/${encodeURIComponent(this.session.token)}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves, movetimeMs, multiPv: 1, ...(options.maxDepth ? { maxDepth: options.maxDepth } : {}) }),
        signal: this.abort.signal,
      })
      if (!response.ok) throw new Error(`${this.config.name} 搜索失败：HTTP ${response.status} ${await response.text()}`)
      const result = await response.json() as EngineSearchResponse
      options.onInfo?.(result.info)
      return result
    } finally { this.abort = null }
  }

  sendCommand(command: string): void { this.fallback?.sendCommand(command) }
  setPosition(moves: string[]): void { this.fallback?.setPosition(moves) }
  stop(reason = '搜索已取消。'): void {
    this.abort?.abort(new DOMException(reason, 'AbortError'))
    if (this.session) void fetch(`/api/chess/arena/sessions/${encodeURIComponent(this.session.token)}/cancel`, { method: 'POST' }).catch(() => undefined)
    this.abort = null
    this.fallback?.stop(reason)
  }
  newGame(): void { this.fallback?.newGame() }
  async releaseSession(): Promise<void> {
    const session = this.session
    this.session = null
    if (session) await fetch(`/api/chess/arena/sessions/${encodeURIComponent(session.token)}`, { method: 'DELETE', keepalive: true }).catch(() => undefined)
  }
  dispose(): void {
    this.stop('引擎已关闭。')
    void this.releaseSession()
    this.fallback?.dispose()
    this.fallback = null
  }

  private async createNativeSession(): Promise<ArenaSession> {
    const response = await fetch('/api/chess/arena/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineId: this.engineId, threads: this.config.threads, hashMb: this.config.hash }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    return response.json() as Promise<ArenaSession>
  }
}
