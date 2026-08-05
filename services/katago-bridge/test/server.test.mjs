import assert from 'node:assert/strict'
import test from 'node:test'
import { createKataGoBridgeServer } from '../src/server.mjs'
import { KATAGO_RULES } from '../src/protocol.mjs'

const PROXY_SECRET = 'proxy-secret-that-is-long-enough-for-test'
const SESSION_SECRET = 'session-secret-that-is-long-enough-for-test'

test('issues an HttpOnly session and streams partial plus final analysis', async (context) => {
  const engine = new FakeEngine()
  const server = createKataGoBridgeServer({
    engine,
    proxySecret: PROXY_SECRET,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`
  const headers = { 'x-katago-proxy-secret': PROXY_SECRET }

  const sessionResponse = await fetch(`${base}/api/go/katago/session`, { method: 'POST', headers })
  assert.equal(sessionResponse.status, 201)
  const cookie = sessionResponse.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/)

  const capabilities = await fetch(`${base}/api/go/katago/capabilities`, {
    headers: { ...headers, Cookie: cookie },
  })
  assert.equal(capabilities.status, 200)
  assert.equal((await capabilities.json()).engineVersion, '1.16-test')

  const analysis = await fetch(`${base}/api/go/katago/analyze`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'request-1',
      gameId: 'go',
      player: 'black',
      profile: 'fast',
      boardSize: 19,
      komi: 7.5,
      rules: KATAGO_RULES,
      moves: [],
    }),
  })
  assert.equal(analysis.status, 200)
  const events = (await analysis.text()).trim().split('\n').map(JSON.parse)
  assert.deepEqual(events.map((event) => event.stage), ['partial', 'final'])
  assert.equal(events[1].candidates[0].move, 'D16')
  assert.equal(engine.queries[0].maxVisits, 200)
})

test('rejects direct requests, expired sessions and mismatched rules', async (context) => {
  const engine = new FakeEngine()
  const server = createKataGoBridgeServer({
    engine,
    proxySecret: PROXY_SECRET,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  assert.equal((await fetch(`${base}/api/go/katago/session`, { method: 'POST' })).status, 403)
  const noSession = await fetch(`${base}/api/go/katago/capabilities`, {
    headers: { 'x-katago-proxy-secret': PROXY_SECRET },
  })
  assert.equal(noSession.status, 401)

  const sessionResponse = await fetch(`${base}/api/go/katago/session`, {
    method: 'POST',
    headers: { 'x-katago-proxy-secret': PROXY_SECRET },
  })
  const cookie = sessionResponse.headers.get('set-cookie')
  const mismatched = await fetch(`${base}/api/go/katago/analyze`, {
    method: 'POST',
    headers: {
      'x-katago-proxy-secret': PROXY_SECRET,
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestId: 'bad-rules', gameId: 'go', player: 'black', profile: 'fast',
      boardSize: 19, komi: 7.5, moves: [], rules: { ...KATAGO_RULES, ko: 'SIMPLE' },
    }),
  })
  assert.equal(mismatched.status, 400)
  assert.equal((await mismatched.json()).code, 'INVALID_RULES')
})

class FakeEngine {
  ready = true
  capabilities = { engineVersion: '1.16-test', modelName: 'fake-model.bin.gz' }
  queries = []
  terminate() {}

  async analyze(query, options) {
    this.queries.push(query)
    const partial = result(query.id, true)
    options.onUpdate(partial)
    return result(query.id, false)
  }
}

function result(id, isDuringSearch) {
  return {
    id,
    isDuringSearch,
    rootInfo: { winrate: 0.52, scoreLead: 1.5, visits: isDuringSearch ? 20 : 200 },
    moveInfos: [{ move: 'D16', order: 0, visits: 200, prior: 0.2, winrate: 0.52, scoreLead: 1.5, pv: ['D16'] }],
  }
}
