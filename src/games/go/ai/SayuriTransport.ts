import type { KataGoMoveTuple } from './types'

export interface SayuriCapabilities {
  ready: boolean
  engineVersion: string
  modelName: string
  runtimeBackend: 'native-sayuri'
  playouts: number
  timeoutMs: number
  threads: number
  batchSize: number
}

export interface SayuriAnalyzeRequest {
  requestId: string
  gameId: 'go'
  player: 'black' | 'white'
  boardSize: 19
  komi: 7.5
  moves: readonly KataGoMoveTuple[]
}

export interface SayuriAnalyzeResult {
  requestId: string
  move: string
  elapsedMs: number
  requestedPlayouts: number
  timedOut: boolean
  engineVersion: string
  modelName: string
}

export interface SayuriTransport {
  initialize(signal?: AbortSignal): Promise<SayuriCapabilities>
  analyze(request: SayuriAnalyzeRequest, signal?: AbortSignal): Promise<SayuriAnalyzeResult>
  cancel(requestId: string): void
  dispose(): void | Promise<void>
}

export class HttpSayuriTransport implements SayuriTransport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly requests = new Map<string, AbortController>()
  private initialization: Promise<SayuriCapabilities> | null = null
  private disposed = false

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/go/sayuri').replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
  }

  initialize(signal?: AbortSignal): Promise<SayuriCapabilities> {
    this.assertActive()
    if (!this.initialization) this.initialization = this.loadCapabilities(signal)
    return this.initialization
  }

  async analyze(request: SayuriAnalyzeRequest, signal?: AbortSignal): Promise<SayuriAnalyzeResult> {
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
      return await response.json() as SayuriAnalyzeResult
    } finally {
      signal?.removeEventListener('abort', abort)
      this.requests.delete(request.requestId)
    }
  }

  cancel(requestId: string): void {
    this.requests.get(requestId)?.abort(new DOMException('Sayuri 搜索已停止。', 'AbortError'))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
    this.initialization = null
  }

  private async loadCapabilities(signal?: AbortSignal): Promise<SayuriCapabilities> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/capabilities`, {
        credentials: 'same-origin',
        signal,
      })
      if (!response.ok) throw new Error(await readError(response))
      const capabilities = await response.json() as SayuriCapabilities
      if (!capabilities.ready) throw new Error('Sayuri 服务尚未就绪。')
      return capabilities
    } catch (error) {
      this.initialization = null
      if (error instanceof TypeError) {
        throw new Error('Sayuri 本地服务未启动。请先运行 npm run setup:sayuri，然后重新双击 start-local-preview.cmd。')
      }
      throw error
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Sayuri 传输层已经释放。')
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string }
    if (body.message) return body.message
  } catch {
    // Fall through to the status text.
  }
  return `Sayuri 服务请求失败（${response.status} ${response.statusText}）。`
}
