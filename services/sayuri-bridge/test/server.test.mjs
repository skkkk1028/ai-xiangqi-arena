import assert from 'node:assert/strict'
import test from 'node:test'
import { createSayuriBridgeServer } from '../src/server.mjs'

test('starts lazily, reports actual configuration, and returns a move', async (context) => {
  let starts = 0
  const engine = {
    ready: false,
    capabilities: { engineVersion: 'Sayuri 0.10.0', modelName: 'test.bin.txt' },
    async start() { starts += 1; this.ready = true },
    async analyze() { return { move: 'D16', elapsedMs: 42 } },
  }
  const server = createSayuriBridgeServer({ engine, playouts: 20_000, timeoutMs: 180_000, threads: 16, batchSize: 8 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await (await fetch(`${base}/health/live`)).json()).live, true)
  assert.equal(starts, 0)
  const capabilities = await (await fetch(`${base}/api/go/sayuri/capabilities`)).json()
  assert.equal(starts, 1)
  assert.equal(capabilities.playouts, 20_000)
  assert.equal(capabilities.threads, 16)
  assert.equal(capabilities.batchSize, 8)
  const response = await fetch(`${base}/api/go/sayuri/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'sy-1', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5, moves: [] }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).move, 'D16')
})

test('aborts a stuck engine at the configured per-move timeout', async (context) => {
  const engine = {
    ready: true,
    capabilities: { engineVersion: 'Sayuri 0.10.0', modelName: 'test.bin.txt' },
    async start() {},
    async analyze(_input, signal) {
      return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    },
  }
  const server = createSayuriBridgeServer({ engine, timeoutMs: 20 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/api/go/sayuri/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'timeout', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5, moves: [] }),
  })
  assert.equal(response.status, 503)
  assert.match((await response.json()).message, /Sayuri 服务不可用/)
})
