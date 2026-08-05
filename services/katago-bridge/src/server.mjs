import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { KataGoProcess } from './katago-process.mjs'
import {
  KATAGO_RULES,
  ProtocolError,
  SEARCH_PROFILES,
  buildKataGoQuery,
  normalizeAnalysisResult,
  validateAnalyzeRequest,
} from './protocol.mjs'
import {
  AnalysisLimiter,
  createSessionToken,
  readSessionCookie,
  sessionCookie,
  verifySessionToken,
} from './security.mjs'

export function createKataGoBridgeServer(options) {
  const engine = options.engine
  const sessionSecret = requireSecret(options.sessionSecret, 'KATAGO_SESSION_SECRET')
  const proxySecret = options.proxySecret ?? ''
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  const secureCookies = options.secureCookies ?? true
  const limiter = options.limiter ?? new AnalysisLimiter(options.limits)

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://bridge.local')
      if (url.pathname === '/health/live') return json(response, 200, { live: true })
      if (url.pathname === '/health/ready') {
        return json(response, engine.ready ? 200 : 503, { ready: Boolean(engine.ready) })
      }
      assertProxy(request, proxySecret, allowedOrigins)

      if (request.method === 'POST' && url.pathname === '/api/go/katago/session') {
        const token = createSessionToken(sessionSecret)
        response.setHeader('Set-Cookie', sessionCookie(token, secureCookies))
        return json(response, 201, { ok: true, expiresIn: 3600 })
      }

      const session = verifySessionToken(readSessionCookie(request), sessionSecret)
      if (!session) return json(response, 401, { code: 'SESSION_REQUIRED', message: 'KataGo 会话无效或已过期。' })

      if (request.method === 'GET' && url.pathname === '/api/go/katago/capabilities') {
        if (!engine.ready) return json(response, 503, { code: 'ENGINE_NOT_READY', message: 'KataGo 服务尚未就绪。' })
        return json(response, 200, {
          ready: true,
          engineVersion: engine.capabilities.engineVersion,
          modelName: engine.capabilities.modelName,
          profiles: SEARCH_PROFILES,
        })
      }

      if (request.method === 'POST' && url.pathname === '/api/go/katago/analyze') {
        return await handleAnalyze({ request, response, engine, session, limiter })
      }
      return json(response, 404, { code: 'NOT_FOUND', message: '接口不存在。' })
    } catch (error) {
      if (response.writableEnded || response.destroyed) return
      const status = Number(error.status) || (error instanceof ProtocolError ? error.status : 500)
      json(response, status, {
        code: error.code ?? 'INTERNAL_ERROR',
        message: status >= 500 ? 'KataGo 服务暂时不可用。' : error.message,
      })
    }
  })
  return server
}

async function handleAnalyze({ request, response, engine, session, limiter }) {
  if (!engine.ready) throw httpError(503, 'ENGINE_NOT_READY', 'KataGo 服务尚未就绪。')
  const body = await readJsonBody(request, 256 * 1024)
  const input = validateAnalyzeRequest(body)
  const disconnect = new AbortController()
  const onAborted = () => disconnect.abort()
  const onClose = () => {
    if (!response.writableEnded) disconnect.abort()
  }
  request.once('aborted', onAborted)
  response.once('close', onClose)
  const ip = String(request.headers['cf-connecting-ip'] ?? request.socket.remoteAddress ?? 'unknown')
  const release = await limiter.acquire(session.id, ip, disconnect.signal)
  const profile = SEARCH_PROFILES[input.profile]
  const metadata = {
    requestId: input.requestId,
    engineVersion: engine.capabilities.engineVersion,
    modelName: engine.capabilities.modelName,
    profile: input.profile,
    startedAt: Date.now(),
    truncated: false,
  }

  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Content-Type-Options': 'nosniff',
  })
  response.flushHeaders?.()

  const timeout = setTimeout(() => {
    metadata.truncated = true
    engine.terminate(input.requestId)
  }, profile.timeoutMs)
  timeout.unref?.()
  let forcedAbort = false
  const forceAbort = setTimeout(() => {
    if (metadata.truncated) {
      forcedAbort = true
      disconnect.abort()
    }
  }, profile.timeoutMs + 5_000)
  forceAbort.unref?.()

  try {
    const result = await engine.analyze(buildKataGoQuery(input), {
      signal: disconnect.signal,
      onUpdate: (raw) => {
        if (!raw.isDuringSearch || response.destroyed) return
        try {
          response.write(`${JSON.stringify(normalizeAnalysisResult(raw, metadata))}\n`)
        } catch {
          // Ignore incomplete intermediary reports; final validation is strict.
        }
      },
    })
    const event = normalizeAnalysisResult(result, metadata)
    event.stage = 'final'
    if (!response.destroyed) response.end(`${JSON.stringify(event)}\n`)
  } catch (error) {
    if (!response.destroyed && (!disconnect.signal.aborted || forcedAbort)) {
      response.end(`${JSON.stringify({
        type: 'error',
        requestId: input.requestId,
        code: forcedAbort ? 'ANALYSIS_TIMEOUT' : error.code ?? 'ANALYSIS_FAILED',
        message: forcedAbort ? 'KataGo 搜索终止后未及时返回结果。' : error.message,
      })}\n`)
    }
  } finally {
    clearTimeout(timeout)
    clearTimeout(forceAbort)
    request.off('aborted', onAborted)
    response.off('close', onClose)
    release()
    process.stdout.write(`[katago-analysis] id=${input.requestId} profile=${input.profile} elapsedMs=${Date.now() - metadata.startedAt} truncated=${metadata.truncated}\n`)
  }
}

function assertProxy(request, proxySecret, allowedOrigins) {
  if (proxySecret && request.headers['x-katago-proxy-secret'] !== proxySecret) {
    throw httpError(403, 'PROXY_REQUIRED', '请求必须通过受信任的同源代理。')
  }
  const origin = request.headers.origin
  if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
    throw httpError(403, 'ORIGIN_DENIED', '请求来源不在允许列表中。')
  }
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(httpError(413, 'BODY_TOO_LARGE', '请求体过大。'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(httpError(400, 'INVALID_JSON', '请求体不是有效 JSON。'))
      }
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

function requireSecret(value, name) {
  if (typeof value !== 'string' || value.length < 32) throw new Error(`${name} must contain at least 32 characters.`)
  return value
}

function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

async function startMain() {
  let restartAttempt = 0
  let restartTimer = null
  let shuttingDown = false
  const scheduleRestart = (error) => {
    if (shuttingDown || restartTimer) return
    const delayMs = Math.min(30_000, 1_000 * (2 ** restartAttempt))
    restartAttempt += 1
    process.stderr.write(`[katago-bridge] engine unavailable: ${error.message}; retrying in ${delayMs}ms\n`)
    restartTimer = setTimeout(() => {
      restartTimer = null
      startEngine()
    }, delayMs)
    restartTimer.unref?.()
  }
  const engine = new KataGoProcess({
    binaryPath: process.env.KATAGO_BIN_PATH,
    binarySha256: process.env.KATAGO_BIN_SHA256,
    modelPath: process.env.KATAGO_MODEL_PATH,
    modelSha256: process.env.KATAGO_MODEL_SHA256,
    configPath: process.env.KATAGO_CONFIG_PATH ?? '/app/config/analysis.cfg',
    onExit: scheduleRestart,
  })
  const startEngine = () => {
    engine.start()
      .then(() => { restartAttempt = 0 })
      .catch(scheduleRestart)
  }
  const server = createKataGoBridgeServer({
    engine,
    sessionSecret: process.env.KATAGO_SESSION_SECRET,
    proxySecret: process.env.KATAGO_PROXY_SECRET,
    allowedOrigins: String(process.env.KATAGO_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    secureCookies: process.env.NODE_ENV !== 'development',
    limits: {
      maxConcurrent: Number(process.env.KATAGO_MAX_CONCURRENT ?? 1),
      maxQueue: Number(process.env.KATAGO_MAX_QUEUE ?? 8),
      maxPerIp: 2,
    },
  })
  startEngine()
  const port = Number(process.env.PORT ?? 8788)
  server.listen(port, '0.0.0.0', () => process.stdout.write(`[katago-bridge] listening on ${port}\n`))
  const shutdown = async () => {
    shuttingDown = true
    if (restartTimer) clearTimeout(restartTimer)
    server.close()
    await engine.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startMain()
