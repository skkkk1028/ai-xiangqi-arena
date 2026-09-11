import assert from 'node:assert/strict'
import test from 'node:test'
import { createChessArenaServer } from '../src/server.mjs'

test('rejects cross-site browser access to the local engine', async (context) => {
  let created = false
  const server = createChessArenaServer({
    availableEngines: [{ id: 'stockfish-18' }],
    createSession() { created = true; return {} },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chess/arena/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    body: JSON.stringify({ engineId: 'stockfish-18' }),
  })
  assert.equal(response.status, 403)
  assert.equal(created, false)
})

function fakeSession(engine, threads, hashMb) {
  const token = `${engine.id}-${Math.random().toString(36).slice(2)}`
  return { token, closed: false, async start() { return { token, engineId: engine.id, engineVersion: engine.name, commit: engine.commit, binarySha256: 'abc', networkSha256: null, threads, hashMb } }, async analyze(input) { return { bestmove: 'e2e4', info: { depth: 10, nodes: 1000, nps: 10000, elapsedMs: 100, score: { kind: 'cp', value: 20 }, wdl: null, pv: ['e2e4'] }, candidates: [], input } }, cancel() {}, async close() { this.closed = true } }
}

test('creates two isolated allowed sessions and enforces the limit', async (context) => {
  const sessions = []
  const availableEngines = [{ id: 'stockfish-18' }, { id: 'obsidian-16' }]
  const server = createChessArenaServer({ availableEngines, createSession(engine, threads, hash) { const value = fakeSession(engine, threads, hash); sessions.push(value); return value } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const created = []
  for (const engineId of ['stockfish-18', 'obsidian-16']) { const response = await fetch(`${base}/api/chess/arena/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engineId, threads: 2, hashMb: 128 }) }); assert.equal(response.status, 201); created.push(await response.json()) }
  assert.notEqual(created[0].token, created[1].token)
  const limited = await fetch(`${base}/api/chess/arena/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engineId: 'stockfish-18' }) }); assert.equal(limited.status, 429)
  const result = await fetch(`${base}/api/chess/arena/sessions/${created[0].token}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moves: [], movetimeMs: 250 }) }); assert.equal((await result.json()).bestmove, 'e2e4')
  await fetch(`${base}/api/chess/arena/sessions/${created[0].token}`, { method: 'DELETE' }); assert.equal(sessions[0].closed, true)
})

test('rejects arbitrary engines and illegal move histories', async (context) => {
  let searches = 0
  const server = createChessArenaServer({ availableEngines: [{ id: 'stockfish-18' }], createSession(engine, threads, hash) { const session = fakeSession(engine, threads, hash); session.analyze = async () => { searches += 1 }; return session } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const denied = await fetch(`${base}/api/chess/arena/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engineId: '../../evil.exe' }) }); assert.equal(denied.status, 400)
  const created = await (await fetch(`${base}/api/chess/arena/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engineId: 'stockfish-18' }) })).json()
  const invalid = await fetch(`${base}/api/chess/arena/sessions/${created.token}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moves: ['e2e5'], movetimeMs: 250 }) }); assert.equal(invalid.status, 400); assert.equal(searches, 0)
})
