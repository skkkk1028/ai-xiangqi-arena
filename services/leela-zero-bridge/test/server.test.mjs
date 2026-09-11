import assert from 'node:assert/strict'
import test from 'node:test'
import { createLeelaZeroBridgeServer } from '../src/server.mjs'

test('rejects cross-site browser access to the local engine', async (context) => {
  let started = false
  const engine = { ready: false, capabilities: {}, async start() { started = true } }
  const server = createLeelaZeroBridgeServer({ engine })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/go/leela-zero/capabilities`, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  })
  assert.equal(response.status, 403)
  assert.equal(started, false)
})

test('reports capabilities and returns a generated move', async (context) => {
  const engine = {
    ready: true,
    capabilities: { engineVersion: 'Leela Zero 0.17', modelName: '0e9ea880.gz' },
    async start() {},
    async analyze() { return { move: 'D16', elapsedMs: 42 } },
  }
  const server = createLeelaZeroBridgeServer({ engine, playouts: 3200, timeoutMs: 180000 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const capabilities = await (await fetch(`${base}/api/go/leela-zero/capabilities`)).json()
  assert.equal(capabilities.playouts, 3200)
  const response = await fetch(`${base}/api/go/leela-zero/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'lz-1', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5, moves: [] }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).move, 'D16')
})
