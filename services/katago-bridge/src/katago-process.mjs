import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { spawn as nodeSpawn } from 'node:child_process'

export class KataGoProcess {
  constructor(options) {
    this.binaryPath = options.binaryPath
    this.modelPath = options.modelPath
    this.configPath = options.configPath
    this.binarySha256 = options.binarySha256
    this.modelSha256 = options.modelSha256
    this.spawn = options.spawn ?? nodeSpawn
    this.onExit = options.onExit ?? null
    this.child = null
    this.stdoutBuffer = ''
    this.pending = new Map()
    this.starting = null
    this.ready = false
    this.closing = false
    this.capabilities = { engineVersion: 'unknown', modelName: 'unknown' }
  }

  async start() {
    if (this.ready) return this.capabilities
    if (this.starting) return this.starting
    this.starting = this.startInternal()
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  async startInternal() {
    this.closing = false
    await Promise.all([
      verifyFile(this.binaryPath, this.binarySha256, 'KataGo binary'),
      verifyFile(this.modelPath, this.modelSha256, 'KataGo model'),
      access(this.configPath),
    ])
    const child = this.spawn(this.binaryPath, [
      'analysis',
      '-config', this.configPath,
      '-model', this.modelPath,
      '-quit-without-waiting',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.stdoutBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.consumeStdout(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(`[katago] ${chunk}`))
    child.on('error', (error) => this.handleExit(error))
    child.on('exit', (code, signal) => this.handleExit(new Error(`KataGo exited (${code ?? signal ?? 'unknown'}).`)))

    const version = await this.control('query_version', 15_000)
    const models = await this.control('query_models', 15_000)
    this.capabilities = {
      engineVersion: String(version.version ?? 'unknown'),
      modelName: String(models.models?.[0]?.name ?? this.modelPath.split(/[\\/]/).pop() ?? 'unknown'),
    }
    this.ready = true
    return this.capabilities
  }

  analyze(query, { onUpdate, signal } = {}) {
    if (!this.ready || !this.child) return Promise.reject(new Error('KataGo 进程尚未就绪。'))
    if (this.pending.has(query.id)) return Promise.reject(new Error(`KataGo query id already exists: ${query.id}`))
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.terminate(query.id)
        this.pending.delete(query.id)
        reject(abortError())
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(query.id, {
        kind: 'analysis',
        resolve,
        reject,
        onUpdate,
        cleanup: () => signal?.removeEventListener('abort', abort),
      })
      try {
        this.write(query)
      } catch (error) {
        this.pending.delete(query.id)
        signal?.removeEventListener('abort', abort)
        reject(error)
      }
    })
  }

  terminate(queryId) {
    if (!this.child) return
    try {
      this.write({ id: `terminate-${randomUUID()}`, action: 'terminate', terminateId: queryId })
    } catch {
      // Process exit handling will reject the original request.
    }
  }

  async close() {
    this.closing = true
    this.ready = false
    const child = this.child
    this.child = null
    if (!child) return
    child.stdin.end()
    child.kill('SIGTERM')
    this.rejectAll(new Error('KataGo 进程已停止。'))
  }

  control(action, timeoutMs) {
    const id = `${action}-${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`KataGo ${action} timed out.`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        kind: 'control',
        resolve,
        reject,
        cleanup: () => clearTimeout(timer),
      })
      this.write({ id, action })
    })
  }

  write(value) {
    if (!this.child?.stdin.writable) throw new Error('KataGo stdin 不可写。')
    this.child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this.handleMessage(JSON.parse(line))
      } catch (error) {
        process.stderr.write(`[katago-bridge] Ignored invalid KataGo output: ${error.message}\n`)
      }
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return
    const pending = typeof message.id === 'string' ? this.pending.get(message.id) : null
    if (!pending) return
    if (message.warning) {
      process.stderr.write(`[katago-warning] ${message.warning}\n`)
      return
    }
    if (message.error) {
      this.pending.delete(message.id)
      pending.cleanup?.()
      pending.reject(new Error(String(message.error)))
      return
    }
    if (pending.kind === 'control') {
      this.pending.delete(message.id)
      pending.cleanup?.()
      pending.resolve(message)
      return
    }
    pending.onUpdate?.(message)
    if (message.isDuringSearch === false) {
      this.pending.delete(message.id)
      pending.cleanup?.()
      pending.resolve(message)
    }
  }

  handleExit(error) {
    if (!this.child && !this.ready) return
    this.child = null
    this.ready = false
    this.rejectAll(error)
    if (!this.closing) this.onExit?.(error)
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.cleanup?.()
      pending.reject(error)
    }
    this.pending.clear()
  }
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyFile(path, expectedHash, label) {
  if (!path) throw new Error(`${label} path is required.`)
  if (!expectedHash || !/^[a-f\d]{64}$/i.test(expectedHash)) throw new Error(`${label} SHA-256 is required.`)
  await access(path)
  const actual = await sha256File(path)
  if (actual.toLowerCase() !== expectedHash.toLowerCase()) throw new Error(`${label} SHA-256 mismatch.`)
}

function abortError() {
  const error = new Error('KataGo analysis aborted.')
  error.name = 'AbortError'
  return error
}
