const baseUrl = process.env.LEELA_ZERO_VERIFY_URL ?? 'http://127.0.0.1:8789/api/go/leela-zero'
const capabilitiesOnly = process.argv.includes('--capabilities-only')

const capabilitiesResponse = await fetch(`${baseUrl}/capabilities`, { signal: AbortSignal.timeout(15_000) })
if (!capabilitiesResponse.ok) throw new Error(`Leela Zero capabilities failed: ${capabilitiesResponse.status}`)
const capabilities = await capabilitiesResponse.json()
if (!capabilities.ready || capabilities.runtimeBackend !== 'native-leela-zero') {
  throw new Error('Leela Zero bridge did not report a ready native engine.')
}
process.stdout.write(`Leela Zero ready: ${capabilities.engineVersion} · ${capabilities.modelName} · ${capabilities.playouts} playouts\n`)

if (!capabilitiesOnly) {
  const requestId = `verify-leela-zero-${Date.now()}`
  const response = await fetch(`${baseUrl}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, gameId: 'go', player: 'black', boardSize: 19, komi: 7.5, moves: [] }),
    signal: AbortSignal.timeout(capabilities.timeoutMs + 15_000),
  })
  if (!response.ok) throw new Error(`Leela Zero analysis failed: ${response.status} ${await response.text()}`)
  const result = await response.json()
  if (!/^(?:pass|[A-HJ-T](?:[1-9]|1[0-9]))$/i.test(result.move)) throw new Error(`Invalid Leela Zero move: ${result.move}`)
  process.stdout.write(`Leela Zero verified move: ${result.move} in ${result.elapsedMs}ms\n`)
}
