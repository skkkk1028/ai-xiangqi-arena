#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Chess } from 'chess.js'

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const bookPath = resolve(root, args.book)
const openings = args.smoke ? smokeOpenings() : await loadOfficialBook(bookPath)
const enginePath = resolve(root, 'node_modules', 'stockfish', 'bin', 'stockfish-18-single.js')
const candidate = await createEngine(enginePath, 'candidate', false)
const referenceLimited = args.reference === 'uci-elo-2500'
const reference = await createEngine(enginePath, referenceLimited ? 'reference-uci-elo-2500' : 'reference-full-stockfish-18', referenceLimited)
const games = []
const pairs = []
const startedAt = new Date().toISOString()

try {
  for (let pairIndex = 0; pairIndex < args.pairs; pairIndex += 1) {
    const fen = openings[seededIndex(args.seed, pairIndex, openings.length)]
    const first = await playGame({ fen, pairIndex, candidateWhite: true })
    const second = await playGame({ fen, pairIndex, candidateWhite: false })
    games.push(first, second)
    pairs.push(first.candidateScore + second.candidateScore)
    process.stdout.write(`pair ${pairIndex + 1}/${args.pairs}: ${first.result}, ${second.result}; candidate ${pairs.at(-1)}/2\n`)
  }
} finally {
  candidate.close()
  reference.close()
}

const report = buildReport()
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputDir = resolve(root, 'reports', 'chess-strength', stamp)
await mkdir(outputDir, { recursive: true })
await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(resolve(outputDir, 'games.csv'), toCsv(games))
await writeFile(resolve(outputDir, 'games.pgn'), games.map((game) => game.pgn).join('\n\n'))
await writeFile(resolve(outputDir, 'REPORT.md'), markdown(report))
process.stdout.write(`${JSON.stringify({ outputDir, summary: report.summary, qualification: report.qualification }, null, 2)}\n`)

async function createEngine(scriptPath, name, limited) {
  const engine = spawn(process.execPath, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const listeners = new Set()
  createInterface({ input: engine.stdout }).on('line', (raw) => { const line = String(raw).trim(); for (const listener of listeners) listener(line) })
  engine.stderr.on('data', () => undefined)
  const waitFor = (predicate, timeoutMs = 60_000) => new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`${name} protocol timeout.`)) }, timeoutMs)
    const listener = (line) => { if (!predicate(line)) return; clearTimeout(timer); listeners.delete(listener); resolvePromise(line) }
    listeners.add(listener)
  })
  const sendCommand = (command) => engine.stdin.write(`${command}\n`)
  sendCommand('uci')
  await waitFor((line) => line === 'uciok')
  for (const command of [
    'setoption name Threads value 1',
    'setoption name Hash value 64',
    'setoption name Ponder value false',
    'setoption name MultiPV value 1',
    'setoption name UCI_ShowWDL value true',
    `setoption name UCI_LimitStrength value ${limited}`,
    ...(limited ? ['setoption name UCI_Elo value 2500'] : []),
  ]) sendCommand(command)
  sendCommand('isready')
  await waitFor((line) => line === 'readyok')
  return {
    name,
    async move(fen) {
      const lines = []
      const done = waitFor((line) => { lines.push(line); return line.startsWith('bestmove ') }, 120_000)
      const capture = (line) => lines.push(line)
      listeners.add(capture)
      sendCommand(`position fen ${fen}`)
      sendCommand(`go nodes ${args.nodes}`)
      const best = await done
      listeners.delete(capture)
      const info = [...lines].reverse().find((line) => line.startsWith('info ') && line.includes(' pv ')) ?? ''
      return { uci: best.split(/\s+/)[1], info: parseInfo(info) }
    },
    close() { try { sendCommand('quit') } catch { /* process already closed */ } },
  }
}

async function playGame({ fen, pairIndex, candidateWhite }) {
  const chess = new Chess(fen)
  chess.header('Event', 'Project10 Stockfish 18 qualification', 'Round', `${pairIndex + 1}.${candidateWhite ? 1 : 2}`, 'White', candidateWhite ? candidate.name : reference.name, 'Black', candidateWhite ? reference.name : candidate.name, 'FEN', fen, 'SetUp', '1')
  let illegalMove = null
  let lastInfo = null
  while (!chess.isGameOver() && chess.history().length < args.maxPlies) {
    const sideIsCandidate = (chess.turn() === 'w') === candidateWhite
    const decision = await (sideIsCandidate ? candidate : reference).move(chess.fen())
    lastInfo = decision.info
    const move = chess.move({ from: decision.uci.slice(0, 2), to: decision.uci.slice(2, 4), ...(decision.uci[4] ? { promotion: decision.uci[4] } : {}) })
    if (!move) { illegalMove = decision.uci; break }
  }
  const result = illegalMove ? (chess.turn() === 'w' ? '0-1' : '1-0') : chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2'
  chess.header('Result', result, 'Termination', illegalMove ? `illegal move ${illegalMove}` : chess.isCheckmate() ? 'checkmate' : chess.isGameOver() ? 'rules' : `technical draw at ${args.maxPlies} plies`)
  const whiteScore = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5
  return { pair: pairIndex + 1, candidateColor: candidateWhite ? 'white' : 'black', result, candidateScore: candidateWhite ? whiteScore : 1 - whiteScore, plies: chess.history().length, illegalMove, lastDepth: lastInfo.depth, lastNodes: lastInfo.nodes, pgn: chess.pgn({ maxWidth: 100, newline: '\n' }) }
}

function buildReport() {
  const wins = games.filter((game) => game.candidateScore === 1).length
  const draws = games.filter((game) => game.candidateScore === 0.5).length
  const losses = games.length - wins - draws
  const score = (wins + draws / 2) / games.length
  const interval = wilson(score, games.length)
  const elo = scoreToElo(score)
  const eloInterval = [scoreToElo(interval[0]), scoreToElo(interval[1])]
  const penta = [0, 0, 0, 0, 0]
  for (const points of pairs) penta[Math.round(points * 2)] += 1
  const standardError = Math.sqrt(Math.max(1e-12, score * (1 - score) / games.length))
  const los = normalCdf((score - 0.5) / standardError)
  const enoughGames = games.length >= 2000
  const passed = enoughGames && eloInterval[0] > 0 && games.every((game) => !game.illegalMove)
  return {
    schema: 'project10-chess-strength-v1',
    startedAt,
    finishedAt: new Date().toISOString(),
    conditions: { candidate: 'stockfish.js@18.0.8 full single-thread, UCI_LimitStrength=false', reference: referenceLimited ? 'same Stockfish 18, UCI_LimitStrength=true, UCI_Elo=2500' : 'same Stockfish 18, full strength', nodesPerMove: args.nodes, threads: 1, hashMb: 64, ponder: false, multiPv: 1, openingBook: args.smoke ? 'embedded smoke positions (not qualification)' : args.book, openingBookSha256: args.smoke ? null : createHash('sha256').update(openings.join('\n')).digest('hex'), seed: args.seed, pairedColorReversal: true, maxPlies: args.maxPlies },
    summary: { pairs: pairs.length, games: games.length, wins, draws, losses, score, relativeElo: finite(elo), relativeElo95: eloInterval.map(finite), los, pentanomial: penta, illegalMoves: games.filter((game) => game.illegalMove).length },
    qualification: referenceLimited
      ? { status: passed ? 'passed' : enoughGames ? 'failed' : 'insufficient-sample', rule: 'At least 2000 games and lower 95% relative-Elo bound > 0, with zero illegal moves.', note: 'UCI_Elo 2500 is an engine anchor and is not a human FIDE rating.' }
      : { status: 'comparison-only', rule: 'Full-strength comparison reports the relative gap; it is not the UCI_Elo 2500 qualification gate.', note: 'A same-version fixed-node comparison is expected to be statistically indistinguishable from zero.' },
    games: games.map(({ pgn, ...game }) => game),
  }
}

async function loadOfficialBook(path) {
  let text
  try { text = await readFile(path, 'utf8') } catch { throw new Error(`Official UHO book not found at ${path}. Run npm run setup:chess-benchmark first.`) }
  const fens = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/).slice(0, 4).join(' ')).filter((fen) => { try { new Chess(fen); return true } catch { return false } })
  if (fens.length < 1000) throw new Error(`UHO book contains too few valid FENs: ${fens.length}`)
  return fens
}

function smokeOpenings() { return ['rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -', 'rnbqkbnr/pp2pppp/2pp4/8/8/2PP4/PP2PPPP/RNBQKBNR w KQkq -'] }
function seededIndex(seed, index, length) { let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0; value ^= value >>> 16; value = Math.imul(value, 0x7feb352d) >>> 0; value ^= value >>> 15; return value % length }
function scoreToElo(score) { if (score <= 0) return -Infinity; if (score >= 1) return Infinity; return -400 * Math.log10(1 / score - 1) }
function wilson(p, n) { const z = 1.959963984540054; const denominator = 1 + z * z / n; const center = (p + z * z / (2 * n)) / denominator; const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator; return [Math.max(0, center - radius), Math.min(1, center + radius)] }
function normalCdf(x) { const sign = x < 0 ? -1 : 1; const a = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * a); const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); return (1 + erf) / 2 }
function finite(value) { return Number.isFinite(value) ? value : value < 0 ? '-Infinity' : 'Infinity' }
function parseInfo(line) { const tokens = line.split(/\s+/); const read = (name) => { const i = tokens.indexOf(name); return i >= 0 ? Number(tokens[i + 1]) || 0 : 0 }; return { depth: read('depth'), nodes: read('nodes') } }
function toCsv(rows) { const fields = ['pair', 'candidateColor', 'result', 'candidateScore', 'plies', 'illegalMove', 'lastDepth', 'lastNodes']; return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => JSON.stringify(row[field] ?? '')).join(',')).join('\n')}\n` }
function markdown(report) { const s = report.summary; return `# Project10 国际象棋棋力实测\n\n- 状态：**${report.qualification.status}**\n- 样本：${s.pairs} 对 / ${s.games} 盘\n- 候选方胜和负：${s.wins}/${s.draws}/${s.losses}\n- 得分率：${(s.score * 100).toFixed(2)}%\n- 相对 Elo：${fmt(s.relativeElo)}，95% 区间 [${fmt(s.relativeElo95[0])}, ${fmt(s.relativeElo95[1])}]\n- LOS：${(s.los * 100).toFixed(2)}%\n- Pentanomial：${s.pentanomial.join(' / ')}\n- 非法着法：${s.illegalMoves}\n\n${report.qualification.note}\n\n本报告只描述固定测试条件下的引擎相对强度，不换算成人类 FIDE 等级。\n` }
function fmt(value) { return typeof value === 'number' ? value.toFixed(2) : value }
function parseArgs(argv) { const value = { pairs: 1000, nodes: 100000, seed: 20260813, maxPlies: 400, smoke: false, reference: 'uci-elo-2500', book: 'benchmark-assets/chess/UHO_Lichess_4852_v1.epd' }; for (let i = 0; i < argv.length; i += 1) { if (argv[i] === '--pairs') value.pairs = Number(argv[++i]); else if (argv[i] === '--nodes') value.nodes = Number(argv[++i]); else if (argv[i] === '--seed') value.seed = Number(argv[++i]); else if (argv[i] === '--max-plies') value.maxPlies = Number(argv[++i]); else if (argv[i] === '--book') value.book = argv[++i]; else if (argv[i] === '--reference') value.reference = argv[++i]; else if (argv[i] === '--smoke') value.smoke = true } for (const key of ['pairs', 'nodes', 'seed', 'maxPlies']) if (!Number.isInteger(value[key]) || value[key] <= 0) throw new Error(`Invalid --${key}: ${value[key]}`); if (!['uci-elo-2500', 'full'].includes(value.reference)) throw new Error(`Invalid --reference: ${value.reference}`); return value }
