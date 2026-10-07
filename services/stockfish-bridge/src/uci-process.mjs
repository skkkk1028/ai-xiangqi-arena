import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

export class StockfishProcess {
  constructor({ binaryPath, binarySha256, threads = 4, hashMb = 128, timeoutMs = 45_000 }) {
    if (!binaryPath) throw new Error('STOCKFISH_BIN_PATH is required.')
    this.binaryPath = binaryPath
    this.expectedHash = String(binarySha256 || '').toLowerCase()
    this.threads = threads
    this.hashMb = hashMb
    this.timeoutMs = timeoutMs
    this.process = null
    this.waiters = []
    this.searching = false
    this.capabilities = null
  }

  async start() {
    if (this.process) return
    const bytes = await readFile(this.binaryPath)
    const binarySha256 = createHash('sha256').update(bytes).digest('hex')
    if (this.expectedHash && binarySha256 !== this.expectedHash) throw new Error(`Stockfish binary checksum mismatch: ${binarySha256}`)
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.process = child
    child.once('exit', (code) => this.failAll(new Error(`Stockfish exited (${code}).`)))
    child.once('error', (error) => this.failAll(error))
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line.trim()))
    child.stderr.on('data', () => undefined)
    this.send('uci')
    const lines = await this.collectUntil((line) => line === 'uciok', 20_000)
    const name = lines.find((line) => line.startsWith('id name '))?.slice(8) ?? 'Stockfish 18'
    if (!/Stockfish 18/i.test(name)) throw new Error(`Expected Stockfish 18, received ${name}.`)
    for (const [option, value] of [['Threads', this.threads], ['Hash', this.hashMb], ['Ponder', 'false'], ['MultiPV', 1], ['UCI_ShowWDL', 'true']]) {
      this.send(`setoption name ${option} value ${value}`)
    }
    this.send('isready')
    await this.collectUntil((line) => line === 'readyok', 20_000)
    this.capabilities = { engineVersion: name, binarySha256 }
  }

  async analyze({ moves, initialFen, movetimeMs, multiPv = 1, maxDepth }, signal) {
    await this.start()
    if (this.searching) throw new Error('Stockfish is busy.')
    this.searching = true
    const abort = () => this.send('stop')
    signal?.addEventListener('abort', abort, { once: true })
    try {
      this.send(`setoption name MultiPV value ${multiPv}`)
      this.send(`position ${initialFen ? `fen ${initialFen}` : 'startpos'}${moves.length ? ` moves ${moves.join(' ')}` : ''}`)
      const started = Date.now()
      this.send(`go movetime ${movetimeMs}${maxDepth ? ` depth ${maxDepth}` : ''}`)
      const lines = await this.collectUntil((line) => line.startsWith('bestmove '), Math.max(this.timeoutMs, movetimeMs + 10_000))
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      return parseSearch(lines, Date.now() - started)
    } finally {
      signal?.removeEventListener('abort', abort)
      this.searching = false
    }
  }

  send(command) {
    if (!this.process?.stdin.writable) throw new Error('Stockfish stdin is unavailable.')
    this.process.stdin.write(`${command}\n`)
  }

  collectUntil(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, lines: [], resolve, reject }
      this.waiters.push(waiter)
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter)
        reject(new Error(`Stockfish protocol timeout after ${timeoutMs} ms.`))
      }, timeoutMs)
      waiter.timer.unref?.()
    })
  }

  handleLine(line) {
    for (const waiter of [...this.waiters]) {
      waiter.lines.push(line)
      if (waiter.predicate(line)) {
        clearTimeout(waiter.timer)
        this.waiters = this.waiters.filter((entry) => entry !== waiter)
        waiter.resolve(waiter.lines)
      }
    }
  }

  failAll(error) {
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error) }
    this.waiters = []
    this.process = null
    this.searching = false
  }

  async close() {
    if (!this.process) return
    try { this.send('quit') } catch { /* best effort */ }
    this.process.kill()
    this.process = null
  }
}

function parseSearch(lines, elapsedMs) {
  const candidates = new Map()
  for (const line of lines) {
    if (!line.startsWith('info ') || !line.includes(' pv ')) continue
    const info = parseInfo(line)
    if (info.pv.length) candidates.set(info.multipv, info)
  }
  const bestmove = lines.at(-1)?.split(/\s+/)[1] ?? null
  const sorted = [...candidates.values()].sort((a, b) => a.multipv - b.multipv)
  const principal = sorted.find((candidate) => candidate.multipv === 1) ?? emptyInfo(elapsedMs)
  return { bestmove: bestmove === '(none)' ? null : bestmove, info: principal, candidates: sorted }
}

function parseInfo(line) {
  const tokens = line.split(/\s+/)
  const number = (name, fallback = 0) => { const index = tokens.indexOf(name); return index >= 0 ? Number(tokens[index + 1]) || fallback : fallback }
  const scoreIndex = tokens.indexOf('score')
  const score = scoreIndex >= 0 && (tokens[scoreIndex + 1] === 'cp' || tokens[scoreIndex + 1] === 'mate')
    ? { kind: tokens[scoreIndex + 1], value: Number(tokens[scoreIndex + 2]) }
    : null
  const wdlIndex = tokens.indexOf('wdl')
  const pvIndex = tokens.indexOf('pv')
  return {
    depth: number('depth'), seldepth: number('seldepth'), multipv: number('multipv', 1), nodes: number('nodes'), nps: number('nps'), elapsedMs: number('time'), score,
    wdl: wdlIndex >= 0 ? { win: Number(tokens[wdlIndex + 1]), draw: Number(tokens[wdlIndex + 2]), loss: Number(tokens[wdlIndex + 3]) } : null,
    pv: pvIndex >= 0 ? tokens.slice(pvIndex + 1) : [],
  }
}

function emptyInfo(elapsedMs) { return { depth: 0, nodes: 0, nps: 0, elapsedMs, score: null, wdl: null, pv: [] } }
