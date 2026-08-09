const baseUrl = process.env.SAYURI_VERIFY_URL ?? 'http://127.0.0.1:8790/api/go/sayuri'
const capabilitiesOnly = process.argv.includes('--capabilities-only')
const liveOnly = process.argv.includes('--live-only')

if (liveOnly) {
  const response = await fetch('http://127.0.0.1:8790/health/live', { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`Sayuri liveness failed: ${response.status}`)
  process.stdout.write('Sayuri bridge is live; model remains lazily unloaded.\n')
  process.exit(0)
}

const capabilitiesResponse = await fetch(`${baseUrl}/capabilities`, { signal: AbortSignal.timeout(600_000) })
if (!capabilitiesResponse.ok) throw new Error(`Sayuri capabilities failed: ${capabilitiesResponse.status}`)
const capabilities = await capabilitiesResponse.json()
if (!capabilities.ready || capabilities.runtimeBackend !== 'native-sayuri') {
  throw new Error('Sayuri bridge did not report a ready native engine.')
}
process.stdout.write(`Sayuri ready: ${capabilities.engineVersion} · ${capabilities.modelName} · ${capabilities.playouts} playouts · ${capabilities.threads} threads · batch ${capabilities.batchSize}\n`)

if (!capabilitiesOnly) {
  const requestId = `verify-sayuri-${Date.now()}`
  const response = await fetch(`${baseUrl}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, gameId: 'go', player: 'black', boardSize: 19, komi: 7.5, moves: [] }),
    signal: AbortSignal.timeout(capabilities.timeoutMs + 15_000),
  })
  if (!response.ok) throw new Error(`Sayuri analysis failed: ${response.status} ${await response.text()}`)
  const result = await response.json()
  if (!/^(?:pass|[A-HJ-T](?:[1-9]|1[0-9]))$/i.test(result.move)) throw new Error(`Invalid Sayuri move: ${result.move}`)
  process.stdout.write(`Sayuri verified move: ${result.move} in ${result.elapsedMs}ms\n`)
}
