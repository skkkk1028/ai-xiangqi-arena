import assert from 'node:assert/strict'
import test from 'node:test'
import { createStockfishBridgeServer } from '../src/server.mjs'

test('rejects cross-site browser access to the local engine', async (context) => {
  let started = false
  const engine = { capabilities: {}, async start() { started = true } }
  const server = createStockfishBridgeServer({ engine, threads: 1, hashMb: 64, timeoutMs: 45_000 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chess/stockfish/capabilities`, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  })
  assert.equal(response.status, 403)
  assert.equal(started, false)
})

test('reports verified capabilities and returns an analyzed move', async (context) => {
  let starts = 0
  const engine = {
    capabilities: { engineVersion: 'Stockfish 18', binarySha256: 'abc123' },
    async start() { starts += 1 },
    async analyze(input) { return { bestmove: 'e2e4', info: { depth: 12, nodes: 1000, nps: 10, elapsedMs: 100, score: { kind: 'cp', value: 20 }, wdl: null, pv: ['e2e4'] }, candidates: [], input } },
  }
  const server = createStockfishBridgeServer({ engine, threads: 4, hashMb: 128, timeoutMs: 45_000 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await (await fetch(`${base}/health/live`)).json()).live, true)
  assert.equal(starts, 0)
  const capabilities = await (await fetch(`${base}/api/chess/stockfish/capabilities`)).json()
  assert.equal(capabilities.runtimeBackend, 'native-stockfish-18')
  assert.equal(capabilities.engineVersion, 'Stockfish 18')
  const response = await fetch(`${base}/api/chess/stockfish/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moves: [], movetimeMs: 250, multiPv: 1 }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).bestmove, 'e2e4')
})

test('rejects illegal move histories before they reach the native engine', async (context) => {
  let analyzed = false
  const engine = { capabilities: { engineVersion: 'Stockfish 18', binarySha256: 'abc123' }, async start() {}, async analyze() { analyzed = true } }
  const server = createStockfishBridgeServer({ engine, threads: 1, hashMb: 64, timeoutMs: 45_000 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chess/stockfish/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moves: ['e2e5'], movetimeMs: 250 }) })
  assert.equal(response.status, 400)
  assert.equal(analyzed, false)
})

test('validates custom initial FEN and passes it to the native engine', async (context) => {
  let input
  const engine = { capabilities: { engineVersion: 'Stockfish 18', binarySha256: 'abc123' }, async start() {}, async analyze(value) { input = value; return { bestmove: 'e7e5', info: {}, candidates: [] } } }
  const server = createStockfishBridgeServer({ engine, threads: 1, hashMb: 64, timeoutMs: 45_000 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api/chess/stockfish/analyze`
  const initialFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
  const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initialFen, moves: ['e7e5'], movetimeMs: 250 }) })
  assert.equal(response.status, 200)
  assert.equal(input.initialFen, initialFen)
  const multiline = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initialFen: initialFen.replace(' b ', '\n b '), moves: [], movetimeMs: 250 }) })
  assert.equal(multiline.status, 200)
  assert.equal(input.initialFen, initialFen, 'forward canonical single-line FEN, never raw whitespace to the UCI command stream')
  const bad = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initialFen: 'bad', moves: [], movetimeMs: 250 }) })
  assert.equal(bad.status, 400)
})
