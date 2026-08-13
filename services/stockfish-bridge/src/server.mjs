import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'
import { StockfishProcess } from './uci-process.mjs'

export function createStockfishBridgeServer({ engine, threads, hashMb, timeoutMs }) {
  let busy = false
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://bridge.local')
      if (url.pathname === '/health/live') return json(response, 200, { live: true })
      if (request.method === 'GET' && url.pathname === '/api/chess/stockfish/capabilities') {
        await engine.start()
        return json(response, 200, { ready: true, ...engine.capabilities, runtimeBackend: 'native-stockfish-18', threads, hashMb, timeoutMs })
      }
      if (request.method === 'POST' && url.pathname === '/api/chess/stockfish/analyze') {
        if (busy) return json(response, 429, { code: 'ENGINE_BUSY', message: 'Stockfish 18 正在处理上一手。' })
        const input = validateInput(await readJsonBody(request, 256 * 1024))
        const abort = new AbortController()
        const cancel = () => abort.abort(new Error('Client disconnected.'))
        request.once('aborted', cancel)
        response.once('close', cancel)
        busy = true
        try { return json(response, 200, await engine.analyze(input, abort.signal)) }
        finally { busy = false; request.off('aborted', cancel); response.off('close', cancel) }
      }
      return json(response, 404, { code: 'NOT_FOUND', message: '接口不存在。' })
    } catch (error) {
      if (!response.writableEnded && !response.destroyed) json(response, error.status ?? 503, { code: error.code ?? 'STOCKFISH_UNAVAILABLE', message: error.message })
    }
  })
}

function validateInput(value) {
  if (!value || typeof value !== 'object') throw protocolError('INVALID_BODY', '请求体无效。')
  const moves = Array.isArray(value.moves) ? value.moves : []
  if (moves.length > 400 || moves.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) throw protocolError('INVALID_MOVES', 'UCI 着法列表无效。')
  const chess = new Chess()
  for (const uci of moves) {
    let move = null
    try { move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) }) }
    catch { move = null }
    if (!move) throw protocolError('ILLEGAL_MOVE', `非法历史着法：${uci}`)
  }
  const movetimeMs = boundedInt(value.movetimeMs, 50, 120_000, 10_000)
  return { moves, movetimeMs, multiPv: boundedInt(value.multiPv, 1, 4, 1), ...(value.maxDepth ? { maxDepth: boundedInt(value.maxDepth, 1, 128, 128) } : {}) }
}

function boundedInt(value, min, max, fallback) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback }
function protocolError(code, message) { const error = new Error(message); error.code = code; error.status = 400; return error }
function readJsonBody(request, maxBytes) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; request.on('data', (chunk) => { size += chunk.length; if (size > maxBytes) reject(protocolError('BODY_TOO_LARGE', '请求体过大。')); else chunks.push(chunk) }); request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(protocolError('INVALID_JSON', '请求体不是有效 JSON。')) } }); request.on('error', reject) }) }
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)) }

async function startMain() {
  const threads = boundedInt(process.env.STOCKFISH_THREADS, 1, 32, 4)
  const hashMb = boundedInt(process.env.STOCKFISH_HASH_MB, 16, 2048, 128)
  const timeoutMs = boundedInt(process.env.STOCKFISH_TIMEOUT_MS, 1_000, 180_000, 45_000)
  const engine = new StockfishProcess({ binaryPath: process.env.STOCKFISH_BIN_PATH, binarySha256: process.env.STOCKFISH_BIN_SHA256, threads, hashMb, timeoutMs })
  const server = createStockfishBridgeServer({ engine, threads, hashMb, timeoutMs })
  const port = boundedInt(process.env.PORT, 1, 65535, 8791)
  server.listen(port, '127.0.0.1', () => process.stdout.write(`[stockfish-bridge] listening on ${port}; engine starts lazily\n`))
  const shutdown = async () => { server.close(); await engine.close() }
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startMain()
