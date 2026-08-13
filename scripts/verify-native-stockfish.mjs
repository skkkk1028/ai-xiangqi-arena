const baseUrl = process.env.STOCKFISH_VERIFY_URL ?? 'http://127.0.0.1:8791/api/chess/stockfish'
const liveOnly = process.argv.includes('--live-only')
if (liveOnly) {
  const response = await fetch('http://127.0.0.1:8791/health/live', { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`Stockfish liveness failed: ${response.status}`)
  process.stdout.write('Stockfish bridge is live; engine remains lazily unloaded.\n')
  process.exit(0)
}
const capabilitiesResponse = await fetch(`${baseUrl}/capabilities`, { signal: AbortSignal.timeout(60_000) })
if (!capabilitiesResponse.ok) throw new Error(`Stockfish capabilities failed: ${capabilitiesResponse.status}`)
const capabilities = await capabilitiesResponse.json()
if (!capabilities.ready || capabilities.runtimeBackend !== 'native-stockfish-18' || !/Stockfish 18/i.test(capabilities.engineVersion)) throw new Error('Bridge did not report verified Stockfish 18.')
if (!process.argv.includes('--capabilities-only')) {
  const response = await fetch(`${baseUrl}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `verify-${Date.now()}`, moves: [], movetimeMs: 250, multiPv: 1 }), signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Stockfish analysis failed: ${response.status} ${await response.text()}`)
  const result = await response.json()
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(result.bestmove ?? '')) throw new Error(`Invalid bestmove: ${result.bestmove}`)
  process.stdout.write(`Stockfish 18 verified: ${result.bestmove}, depth ${result.info.depth}, ${result.info.nodes} nodes.\n`)
} else process.stdout.write(`Stockfish 18 ready: ${capabilities.engineVersion} · ${capabilities.threads} threads · ${capabilities.hashMb} MB.\n`)
