import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

export class UciSession {
  constructor({ engine, binaryPath, binarySha256, threads, hashMb, timeoutMs }) {
    this.engine = engine; this.binaryPath = binaryPath; this.expectedHash = String(binarySha256 || '').toLowerCase()
    this.threads = threads; this.hashMb = hashMb; this.timeoutMs = timeoutMs; this.token = randomBytes(24).toString('base64url')
    this.child = null; this.lines = []; this.waiter = null; this.searching = false; this.capabilities = null
  }
  async start() {
    if (this.child) return this.capabilities
    const bytes = await readFile(this.binaryPath)
    const binarySha256 = createHash('sha256').update(bytes).digest('hex')
    if (this.expectedHash && binarySha256 !== this.expectedHash) throw new Error(`${this.engine.id} binary checksum mismatch: ${binarySha256}`)
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    child.once('exit', (code) => this.fail(new Error(`${this.engine.id} exited (${code}).`)))
    child.once('error', (error) => this.fail(error))
    createInterface({ input: child.stdout }).on('line', (line) => this.handle(String(line).trim()))
    child.stderr.on('data', () => undefined)
    this.send('uci')
    const uci = await this.until((line) => line === 'uciok', 20_000)
    const engineVersion = uci.find((line) => line.startsWith('id name '))?.slice(8) ?? this.engine.name
    if (!this.engine.identity.test(engineVersion)) throw new Error(`Expected ${this.engine.name}, received ${engineVersion}.`)
    for (const [name, value] of [['Threads', this.threads], ['Hash', this.hashMb], ['Ponder', 'false'], ['MultiPV', 1]]) this.send(`setoption name ${name} value ${value}`)
    this.send('isready'); await this.until((line) => line === 'readyok', 20_000)
    this.capabilities = { token: this.token, engineId: this.engine.id, engineVersion, commit: this.engine.commit, binarySha256, networkSha256: null, threads: this.threads, hashMb: this.hashMb }
    return this.capabilities
  }
  async analyze({ moves, movetimeMs, maxDepth, clock }, signal) {
    await this.start(); if (this.searching) throw protocolError(409, 'ENGINE_BUSY', '该席位正在搜索。')
    this.searching = true; const stop = () => { try { this.send('stop') } catch { /* already dead */ } }; signal?.addEventListener('abort', stop, { once: true })
    try {
      this.send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`)
      const go = clock
        ? `go wtime ${clock.wtimeMs} btime ${clock.btimeMs} winc ${clock.wincMs} binc ${clock.bincMs}`
        : `go movetime ${movetimeMs}${maxDepth ? ` depth ${maxDepth}` : ''}`
      this.send(go)
      const lines = await this.until((line) => line.startsWith('bestmove '), Math.max(this.timeoutMs, movetimeMs + 10_000))
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      return parseSearch(lines)
    } finally { signal?.removeEventListener('abort', stop); this.searching = false }
  }
  cancel() { if (this.searching) this.send('stop') }
  send(command) { if (!this.child?.stdin.writable) throw new Error(`${this.engine.id} stdin unavailable.`); this.child.stdin.write(`${command}\n`) }
  until(predicate, timeoutMs) { return new Promise((resolve, reject) => { const waiter = { predicate, resolve, reject, lines: [] }; waiter.timer = setTimeout(() => { if (this.waiter === waiter) this.waiter = null; reject(new Error(`${this.engine.id} protocol timeout after ${timeoutMs} ms.`)) }, timeoutMs); waiter.timer.unref?.(); this.waiter = waiter }) }
  handle(line) { const waiter = this.waiter; if (!waiter) return; waiter.lines.push(line); if (waiter.predicate(line)) { clearTimeout(waiter.timer); this.waiter = null; waiter.resolve(waiter.lines) } }
  fail(error) { if (this.waiter) { clearTimeout(this.waiter.timer); this.waiter.reject(error); this.waiter = null }; this.child = null; this.searching = false }
  async close() { if (!this.child) return; try { this.send('quit') } catch { /* best effort */ }; this.child.kill(); this.child = null }
}

export function protocolError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error }
function parseSearch(lines) { const infoLine = [...lines].reverse().find((line) => line.startsWith('info ') && line.includes(' pv ')) ?? ''; const info = parseInfo(infoLine); const bestmove = lines.at(-1)?.split(/\s+/)[1] ?? null; return { bestmove: bestmove === '(none)' ? null : bestmove, info, candidates: [{ ...info, multipv: 1 }] } }
function parseInfo(line) { const t = line.split(/\s+/); const num = (name) => { const i = t.indexOf(name); return i >= 0 ? Number(t[i + 1]) || 0 : 0 }; const scoreAt = t.indexOf('score'), wdlAt = t.indexOf('wdl'), pvAt = t.indexOf('pv'); return { depth: num('depth'), seldepth: num('seldepth'), multipv: 1, nodes: num('nodes'), nps: num('nps'), elapsedMs: num('time'), score: scoreAt >= 0 && ['cp','mate'].includes(t[scoreAt + 1]) ? { kind: t[scoreAt + 1], value: Number(t[scoreAt + 2]) } : null, wdl: wdlAt >= 0 ? { win: Number(t[wdlAt + 1]), draw: Number(t[wdlAt + 2]), loss: Number(t[wdlAt + 3]) } : null, pv: pvAt >= 0 ? t.slice(pvAt + 1) : [] } }
