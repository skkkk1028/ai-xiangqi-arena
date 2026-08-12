import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname } from 'node:path'

export class SayuriProcess {
  constructor(options) {
    this.binaryPath = options.binaryPath
    this.modelPath = options.modelPath
    this.binarySha256 = options.binarySha256
    this.modelSha256 = options.modelSha256
    this.playouts = options.playouts ?? 250
    this.threads = options.threads ?? 16
    this.batchSize = options.batchSize ?? 8
    this.timeoutMs = options.timeoutMs ?? 180_000
    this.startupTimeoutMs = options.startupTimeoutMs ?? 600_000
    this.spawn = options.spawn ?? nodeSpawn
    this.child = null
    this.ready = false
    this.starting = null
    this.pending = new Map()
    this.stdoutBuffer = ''
    this.nextCommandId = 1
    this.analysisTail = Promise.resolve()
    this.capabilities = { engineVersion: 'unknown', modelName: modelFileName(this.modelPath) }
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
    await Promise.all([
      verifyFile(this.binaryPath, this.binarySha256, 'Sayuri binary'),
      verifyFile(this.modelPath, this.modelSha256, 'Sayuri model'),
    ])
    const child = this.spawn(this.binaryPath, [
      '-w', this.modelPath,
      '-p', String(this.playouts),
      '-t', String(this.threads),
      '--batch-size', String(this.batchSize),
      '--use-optimistic-policy',
      '--friendly-pass',
      '--resign-threshold', '0',
    ], { cwd: dirname(this.binaryPath), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.stdoutBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.consumeStdout(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(`[sayuri] ${chunk}`))
    child.once('error', (error) => this.handleExit(error))
    child.once('exit', (code, signal) => this.handleExit(new Error(`Sayuri exited (${code ?? signal ?? 'unknown'}).`)))
    try {
      const name = await this.command('name', this.startupTimeoutMs)
      const version = await this.command('version', this.startupTimeoutMs)
      this.capabilities = {
        engineVersion: `${name || 'Sayuri'} ${version || '0.10.0'}`.trim(),
        modelName: modelFileName(this.modelPath),
      }
      this.ready = true
      return this.capabilities
    } catch (error) {
      await this.close()
      throw error
    }
  }

  analyze(position, signal) {
    const run = async () => {
      await this.start()
      if (signal?.aborted) throw abortError()
      const abort = () => this.interrupt()
      signal?.addEventListener('abort', abort, { once: true })
      const startedAt = Date.now()
      try {
        await this.command('boardsize 19')
        await this.command('clear_board')
        await this.command('komi 7.5')
        for (const [color, vertex] of position.moves) {
          await this.command(`play ${color === 'B' ? 'black' : 'white'} ${vertex}`)
        }
        const color = position.player === 'black' ? 'black' : 'white'
        const move = (await this.command(`genmove ${color}`, this.timeoutMs)).trim().split(/\s+/)[0]
        if (!move) throw new Error('Sayuri 没有返回着法。')
        if (move.toLowerCase() === 'resign') throw new Error('Sayuri 意外返回认输；匹配配置已要求禁用认输。')
        return { move, elapsedMs: Date.now() - startedAt }
      } finally {
        signal?.removeEventListener('abort', abort)
      }
    }
    const result = this.analysisTail.then(run, run)
    this.analysisTail = result.catch(() => undefined)
    return result
  }

  command(text, timeoutMs = 30_000) {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('Sayuri stdin 不可写。'))
    const id = this.nextCommandId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.interrupt()
        reject(new Error(`Sayuri GTP command timed out: ${text}`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer, text })
      this.child.stdin.write(`${id} ${text}\n`)
    })
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk.replace(/\r\n/g, '\n')
    let boundary
    while ((boundary = this.stdoutBuffer.indexOf('\n\n')) >= 0) {
      const block = this.stdoutBuffer.slice(0, boundary).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(boundary + 2)
      if (block) this.handleResponse(block)
    }
  }

  handleResponse(block) {
    const match = /^([=?])(\d+)?\s?(.*)$/s.exec(block)
    if (!match) return
    const id = Number(match[2])
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (match[1] === '=') pending.resolve(match[3].trim())
    else pending.reject(new Error(`${pending.text}: ${match[3].trim() || 'Sayuri GTP command failed.'}`))
  }

  interrupt() {
    const child = this.child
    if (!child) return
    this.child = null
    this.ready = false
    child.kill('SIGTERM')
    this.rejectAll(abortError())
  }

  async close() {
    const child = this.child
    this.child = null
    this.ready = false
    if (!child) return
    child.stdin.end()
    child.kill('SIGTERM')
    this.rejectAll(new Error('Sayuri 进程已停止。'))
  }

  handleExit(error) {
    if (!this.child && !this.ready) return
    this.child = null
    this.ready = false
    this.rejectAll(error)
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
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

function modelFileName(path) {
  return String(path ?? 'unknown').split(/[\\/]/).pop() ?? 'unknown'
}

function abortError() {
  const error = new Error('Sayuri analysis aborted.')
  error.name = 'AbortError'
  return error
}
