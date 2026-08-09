import type { KataGoMoveTuple } from './types'

export interface LeelaZeroCapabilities {
  ready: boolean
  engineVersion: string
  modelName: string
  runtimeBackend: 'native-leela-zero'
  playouts: number
  timeoutMs: number
}

export interface LeelaZeroAnalyzeRequest {
  requestId: string
  gameId: 'go'
  player: 'black' | 'white'
  boardSize: 19
  komi: 7.5
  moves: readonly KataGoMoveTuple[]
}

export interface LeelaZeroAnalyzeResult {
  requestId: string
  move: string
  elapsedMs: number
  requestedPlayouts: number
  timedOut: boolean
  engineVersion: string
  modelName: string
}

export interface LeelaZeroTransport {
  initialize(signal?: AbortSignal): Promise<LeelaZeroCapabilities>
  analyze(request: LeelaZeroAnalyzeRequest, signal?: AbortSignal): Promise<LeelaZeroAnalyzeResult>
  cancel(requestId: string): void
  dispose(): void | Promise<void>
}

export class HttpLeelaZeroTransport implements LeelaZeroTransport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly requests = new Map<string, AbortController>()
  private initialization: Promise<LeelaZeroCapabilities> | null = null
  private disposed = false

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/go/leela-zero').replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
  }

  initialize(signal?: AbortSignal): Promise<LeelaZeroCapabilities> {
    this.assertActive()
    if (!this.initialization) this.initialization = this.loadCapabilities(signal)
    return this.initialization
  }

  async analyze(request: LeelaZeroAnalyzeRequest, signal?: AbortSignal): Promise<LeelaZeroAnalyzeResult> {
    this.assertActive()
    await this.initialize(signal)
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    this.requests.set(request.requestId, controller)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/analyze`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(await readError(response))
      return await response.json() as LeelaZeroAnalyzeResult
    } finally {
      signal?.removeEventListener('abort', abort)
      this.requests.delete(request.requestId)
    }
  }

  cancel(requestId: string): void {
    this.requests.get(requestId)?.abort(new DOMException('Leela Zero 搜索已停止。', 'AbortError'))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
    this.initialization = null
  }

  private async loadCapabilities(signal?: AbortSignal): Promise<LeelaZeroCapabilities> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/capabilities`, {
        credentials: 'same-origin',
        signal,
      })
      if (!response.ok) throw new Error(await readError(response))
      const capabilities = await response.json() as LeelaZeroCapabilities
      if (!capabilities.ready) throw new Error('Leela Zero 服务尚未就绪。')
      return capabilities
    } catch (error) {
      this.initialization = null
      throw error
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Leela Zero 传输层已经释放。')
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string }
    if (body.message) return body.message
  } catch {
    // Use the HTTP status below.
  }
  return `Leela Zero 服务请求失败（${response.status} ${response.statusText}）。`
}
