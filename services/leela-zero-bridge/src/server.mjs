import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LeelaZeroProcess } from './gtp-process.mjs'
import { MATCH_SETTINGS, ProtocolError, validateAnalyzeRequest } from './protocol.mjs'

export function createLeelaZeroBridgeServer({ engine, playouts = MATCH_SETTINGS.playouts, timeoutMs = MATCH_SETTINGS.timeoutMs }) {
  let busy = false
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://bridge.local')
      if (url.pathname === '/health/live') return json(response, 200, { live: true })
      if (url.pathname === '/health/ready') return json(response, engine.ready ? 200 : 503, { ready: Boolean(engine.ready) })
      if (request.method === 'GET' && url.pathname === '/api/go/leela-zero/capabilities') {
        if (!engine.ready) await engine.start()
        return json(response, 200, {
          ready: true,
          engineVersion: engine.capabilities.engineVersion,
          modelName: engine.capabilities.modelName,
          runtimeBackend: 'native-leela-zero',
          playouts,
          timeoutMs,
        })
      }
      if (request.method === 'POST' && url.pathname === '/api/go/leela-zero/analyze') {
        if (busy) return json(response, 429, { code: 'ENGINE_BUSY', message: 'Leela Zero 正在处理上一手。' })
        const input = validateAnalyzeRequest(await readJsonBody(request, 256 * 1024))
        const abort = new AbortController()
        const onAborted = () => abort.abort()
        request.once('aborted', onAborted)
        response.once('close', onAborted)
        busy = true
        const startedAt = Date.now()
        try {
          const result = await engine.analyze(input, abort.signal)
          return json(response, 200, {
            requestId: input.requestId,
            move: result.move,
            elapsedMs: result.elapsedMs ?? Date.now() - startedAt,
            requestedPlayouts: playouts,
            timedOut: false,
            engineVersion: engine.capabilities.engineVersion,
            modelName: engine.capabilities.modelName,
          })
        } finally {
          busy = false
          request.off('aborted', onAborted)
          response.off('close', onAborted)
        }
      }
      return json(response, 404, { code: 'NOT_FOUND', message: '接口不存在。' })
    } catch (error) {
      if (response.writableEnded || response.destroyed) return
      const status = error instanceof ProtocolError ? error.status : 503
      json(response, status, {
        code: error.code ?? 'LEELA_ZERO_UNAVAILABLE',
        message: status >= 500 ? `Leela Zero 服务不可用：${error.message}` : error.message,
      })
    }
  })
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) reject(new ProtocolError('BODY_TOO_LARGE', '请求体过大。', 413))
      else chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new ProtocolError('INVALID_JSON', '请求体不是有效 JSON。')) }
    })
    request.on('error', reject)
  })
}

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

async function startMain() {
  const playouts = positiveInt(process.env.LEELA_ZERO_PLAYOUTS, MATCH_SETTINGS.playouts)
  const timeoutMs = positiveInt(process.env.LEELA_ZERO_TIMEOUT_MS, MATCH_SETTINGS.timeoutMs)
  const engine = new LeelaZeroProcess({
    binaryPath: process.env.LEELA_ZERO_BIN_PATH,
    binarySha256: process.env.LEELA_ZERO_BIN_SHA256,
    modelPath: process.env.LEELA_ZERO_MODEL_PATH,
    modelSha256: process.env.LEELA_ZERO_MODEL_SHA256,
    playouts,
    timeoutMs,
    threads: positiveInt(process.env.LEELA_ZERO_THREADS, 8),
  })
  const server = createLeelaZeroBridgeServer({ engine, playouts, timeoutMs })
  engine.start().catch((error) => process.stderr.write(`[leela-zero-bridge] ${error.message}\n`))
  const port = positiveInt(process.env.PORT, 8789)
  server.listen(port, '127.0.0.1', () => process.stdout.write(`[leela-zero-bridge] listening on ${port}\n`))
  const shutdown = async () => {
    server.close()
    await engine.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startMain()
