import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const capabilitiesOnly = process.argv.includes('--capabilities-only')
const strong = process.argv.includes('--strong')
const envPath = resolve(process.cwd(), 'services/katago-bridge/.env')
const env = parseEnv(await readFile(envPath, 'utf8'))
const port = Number(env.PORT ?? 8788)
const base = `http://127.0.0.1:${port}`
const proxyHeaders = { 'x-katago-proxy-secret': env.KATAGO_PROXY_SECRET ?? '' }

const ready = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(5_000) })
if (!ready.ok || !(await ready.json()).ready) throw new Error('Native KataGo readiness check failed.')

const session = await fetch(`${base}/api/go/katago/session`, {
  method: 'POST',
  headers: proxyHeaders,
  signal: AbortSignal.timeout(5_000),
})
if (!session.ok) throw new Error(`Native KataGo session failed (${session.status}).`)
const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
if (!cookie) throw new Error('Native KataGo session cookie is missing.')

const headers = { ...proxyHeaders, Cookie: cookie }
const capabilitiesResponse = await fetch(`${base}/api/go/katago/capabilities`, {
  headers,
  signal: AbortSignal.timeout(5_000),
})
if (!capabilitiesResponse.ok) throw new Error(`Native KataGo capabilities failed (${capabilitiesResponse.status}).`)
const capabilities = await capabilitiesResponse.json()
if (capabilities.runtimeBackend !== 'native-katago') throw new Error('Unexpected KataGo runtime backend.')
if (!String(capabilities.engineVersion).includes('1.17.1')) throw new Error(`Unexpected KataGo version: ${capabilities.engineVersion}`)
const expectedModel = basename(env.KATAGO_MODEL_PATH ?? '').replace(/\.bin\.gz$/i, '')
if (!expectedModel || !String(capabilities.modelName).includes(expectedModel)) {
  throw new Error(`Unexpected KataGo model: ${capabilities.modelName}`)
}

if (capabilitiesOnly) {
  process.stdout.write(`Native KataGo ready: ${capabilities.engineVersion} / ${capabilities.modelName}\n`)
} else {
  const requestId = `verify-${Date.now()}`
  const profile = strong ? 'strong' : 'fast'
  const requestedVisits = strong ? 20_000 : 2_000
  const analysisTimeoutMs = strong ? 190_000 : 40_000
  const analysisResponse = await fetch(`${base}/api/go/katago/analyze`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      requestId,
      gameId: 'go',
      player: 'black',
      profile,
      boardSize: 19,
      komi: 7.5,
      rules: {
        ko: 'POSITIONAL', scoring: 'AREA', tax: 'NONE', suicide: false,
        hasButton: false, whiteHandicapBonus: '0', friendlyPassOk: true,
      },
      moves: [],
    }),
    signal: AbortSignal.timeout(analysisTimeoutMs),
  })
  if (!analysisResponse.ok) throw new Error(`Native KataGo analysis failed (${analysisResponse.status}).`)
  const events = (await analysisResponse.text()).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
  const final = events.findLast((event) => event.type === 'analysis' && event.stage === 'final')
  if (!final) throw new Error('Native KataGo did not return a final analysis event.')
  if (!Array.isArray(final.candidates) || final.candidates.length === 0) throw new Error('Native KataGo returned no candidates.')
  if (!(final.root?.visits > 0) || final.requestedVisits !== requestedVisits) throw new Error('Native KataGo visits metadata is invalid.')
  process.stdout.write(JSON.stringify({
    profile,
    engineVersion: capabilities.engineVersion,
    modelName: capabilities.modelName,
    runtimeBackend: final.runtimeBackend,
    move: final.candidates[0].move,
    visits: final.root.visits,
    requestedVisits: final.requestedVisits,
    elapsedMs: final.elapsedMs,
    timedOut: final.timedOut,
    truncated: final.truncated,
  }) + '\n')
}

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    const separator = trimmed.indexOf('=')
    if (separator < 1) return []
    return [[trimmed.slice(0, separator), trimmed.slice(separator + 1)]]
  }))
}
