import type {
  KataGoAnalyzeRequest,
  KataGoCapabilities,
  KataGoWireAnalysisEvent,
  KataGoWireEvent,
} from './types'

export interface KataGoAnalyzeOptions {
  signal?: AbortSignal
  onUpdate?: (event: KataGoWireAnalysisEvent) => void
}

export interface KataGoTransport {
  initialize(signal?: AbortSignal): Promise<KataGoCapabilities>
  analyze(
    request: KataGoAnalyzeRequest,
    options?: KataGoAnalyzeOptions,
  ): Promise<KataGoWireAnalysisEvent>
  cancel(requestId: string): void
  dispose(): void | Promise<void>
}

export interface HttpKataGoTransportOptions {
  baseUrl?: string
  fetch?: typeof fetch
}

export class HttpKataGoTransport implements KataGoTransport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly requests = new Map<string, AbortController>()
  private initialization: Promise<KataGoCapabilities> | null = null
  private disposed = false

  constructor(options: HttpKataGoTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/go/katago').replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
  }

  initialize(signal?: AbortSignal): Promise<KataGoCapabilities> {
    this.assertActive()
    if (!this.initialization) this.initialization = this.createSession(signal)
    return this.initialization
  }

  async analyze(
    request: KataGoAnalyzeRequest,
    options: KataGoAnalyzeOptions = {},
  ): Promise<KataGoWireAnalysisEvent> {
    this.assertActive()
    await this.initialize(options.signal)
    if (this.requests.has(request.requestId)) {
      throw new Error(`KataGo 请求编号重复：${request.requestId}`)
    }

    const controller = new AbortController()
    const unlink = forwardAbort(options.signal, controller)
    this.requests.set(request.requestId, controller)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/analyze`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(await readHttpError(response))
      if (!response.body) throw new Error('KataGo 服务没有返回分析数据流。')

      let finalEvent: KataGoWireAnalysisEvent | null = null
      for await (const event of readNdjsonEvents(response.body)) {
        if (event.type === 'error') throw new Error(event.message)
        if (event.requestId !== request.requestId) continue
        options.onUpdate?.(event)
        if (event.stage === 'final') finalEvent = event
      }
      if (!finalEvent) throw new Error('KataGo 分析流在最终结果前结束。')
      return finalEvent
    } finally {
      unlink()
      this.requests.delete(request.requestId)
    }
  }

  cancel(requestId: string): void {
    this.requests.get(requestId)?.abort(createAbortError('KataGo 搜索已停止。'))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.requests.values()) {
      controller.abort(createAbortError('KataGo 传输层已释放。'))
    }
    this.requests.clear()
    this.initialization = null
  }

  private async createSession(signal?: AbortSignal): Promise<KataGoCapabilities> {
    try {
      const session = await this.fetchImpl(`${this.baseUrl}/session`, {
        method: 'POST',
        credentials: 'same-origin',
        signal,
      })
      if (!session.ok) throw new Error(await readHttpError(session))
      const response = await this.fetchImpl(`${this.baseUrl}/capabilities`, {
        credentials: 'same-origin',
        signal,
      })
      if (!response.ok) throw new Error(await readHttpError(response))
      const capabilities = (await response.json()) as KataGoCapabilities
      if (!capabilities.ready) throw new Error('KataGo 服务尚未就绪。')
      return capabilities
    } catch (error) {
      this.initialization = null
      throw error
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('KataGo 传输层已经释放。')
  }
}

export async function* readNdjsonEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<KataGoWireEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) yield parseWireEvent(line)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield parseWireEvent(buffer)
  } finally {
    reader.releaseLock()
  }
}

function parseWireEvent(line: string): KataGoWireEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error('KataGo 服务返回了无效的 NDJSON 数据。')
  }
  if (!value || typeof value !== 'object' || !("type" in value)) {
    throw new Error('KataGo 服务返回了未知事件。')
  }
  return value as KataGoWireEvent
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined
  const abort = () => target.abort(source.reason ?? createAbortError('KataGo 请求已取消。'))
  if (source.aborted) abort()
  else source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}

function createAbortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

async function readHttpError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) return body.message
  } catch {
    // Fall through to status text when the proxy did not return JSON.
  }
  return `KataGo 服务请求失败（${response.status} ${response.statusText}）。`
}
