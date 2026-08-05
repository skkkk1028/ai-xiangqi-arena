import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'katago_session'

export function createSessionToken(secret, now = Date.now(), ttlMs = 60 * 60 * 1_000) {
  const payload = Buffer.from(JSON.stringify({ id: cryptoRandomId(), exp: now + ttlMs })).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  const expected = sign(payload, secret)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof value.id !== 'string' || !Number.isFinite(value.exp) || value.exp <= now) return null
    return value
  } catch {
    return null
  }
}

export function readSessionCookie(request) {
  const cookies = String(request.headers.cookie ?? '').split(';')
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split('=')
    if (name === COOKIE_NAME) return decodeURIComponent(value.join('='))
  }
  return null
}

export function sessionCookie(token, secure = true) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/go/katago; HttpOnly; SameSite=Strict; Max-Age=3600${secure ? '; Secure' : ''}`
}

export class AnalysisLimiter {
  constructor({ maxConcurrent = 1, maxQueue = 8, maxPerIp = 2 } = {}) {
    this.maxConcurrent = maxConcurrent
    this.maxQueue = maxQueue
    this.maxPerIp = maxPerIp
    this.active = 0
    this.queue = []
    this.sessions = new Set()
    this.ipReservations = new Map()
  }

  acquire(sessionId, ip, signal) {
    if (this.sessions.has(sessionId)) return Promise.reject(limitError(409, 'SESSION_BUSY', '该棋局已有一个进行中的分析。'))
    const ipCount = this.ipReservations.get(ip) ?? 0
    if (ipCount >= this.maxPerIp) return Promise.reject(limitError(429, 'IP_BUSY', '该来源的并发分析数已达上限。'))
    if (this.active >= this.maxConcurrent && this.queue.length >= this.maxQueue) {
      return Promise.reject(limitError(503, 'QUEUE_FULL', 'KataGo 分析队列已满，请稍后重试。'))
    }

    this.sessions.add(sessionId)
    this.ipReservations.set(ip, ipCount + 1)
    return new Promise((resolve, reject) => {
      const entry = { sessionId, ip, resolve, reject, signal, abort: null }
      entry.abort = () => {
        const index = this.queue.indexOf(entry)
        if (index >= 0) this.queue.splice(index, 1)
        this.releaseReservation(entry)
        reject(abortError())
      }
      if (signal?.aborted) return entry.abort()
      signal?.addEventListener('abort', entry.abort, { once: true })
      if (this.active < this.maxConcurrent) this.start(entry)
      else this.queue.push(entry)
    })
  }

  start(entry) {
    this.active += 1
    entry.signal?.removeEventListener('abort', entry.abort)
    let released = false
    entry.resolve(() => {
      if (released) return
      released = true
      this.active -= 1
      this.releaseReservation(entry)
      const next = this.queue.shift()
      if (next) this.start(next)
    })
  }

  releaseReservation(entry) {
    this.sessions.delete(entry.sessionId)
    const count = this.ipReservations.get(entry.ip) ?? 0
    if (count <= 1) this.ipReservations.delete(entry.ip)
    else this.ipReservations.set(entry.ip, count - 1)
  }
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function cryptoRandomId() {
  return globalThis.crypto.randomUUID()
}

function limitError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function abortError() {
  const error = new Error('请求已取消。')
  error.name = 'AbortError'
  return error
}
