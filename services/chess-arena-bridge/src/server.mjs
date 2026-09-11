import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'
import { UciSession, protocolError } from './uci-session.mjs'

export const ENGINE_DEFINITIONS = Object.freeze({
  'stockfish-18': { id: 'stockfish-18', name: 'Stockfish 18', commit: 'cb3d4ee', identity: /Stockfish 18/i, pathEnv: 'STOCKFISH_BIN_PATH', hashEnv: 'STOCKFISH_BIN_SHA256' },
  'obsidian-16': { id: 'obsidian-16', name: 'Obsidian 16.0', commit: '2838ce5', identity: /Obsidian\s*16/i, pathEnv: 'OBSIDIAN_BIN_PATH', hashEnv: 'OBSIDIAN_BIN_SHA256' },
})

export function createChessArenaServer({ createSession, availableEngines, maxSessions = 2 }) {
  const sessions = new Map()
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://arena.local')
      if (request.method === 'GET' && url.pathname === '/health/live') return json(response, 200, { live: true })
      if (url.pathname.startsWith('/api/')) assertLocalRequest(request)
      if (request.method === 'GET' && url.pathname === '/api/chess/arena/capabilities') return json(response, 200, { ready: true, runtimeBackend: 'native-chess-arena', maxSessions, engines: availableEngines })
      if (request.method === 'POST' && url.pathname === '/api/chess/arena/sessions') {
        if (sessions.size >= maxSessions) throw protocolError(429, 'SESSION_LIMIT', '本局已经建立两个引擎席位。')
        const input = await readJson(request); const definition = ENGINE_DEFINITIONS[input.engineId]
        if (!definition || !availableEngines.some((engine) => engine.id === input.engineId)) throw protocolError(400, 'ENGINE_UNAVAILABLE', '请求的引擎未安装或不受支持。')
        const session = createSession(definition, boundedInt(input.threads, 1, 4, 1), boundedInt(input.hashMb, 16, 256, 64))
        const capabilities = await session.start(); sessions.set(session.token, session); return json(response, 201, capabilities)
      }
      const match = /^\/api\/chess\/arena\/sessions\/([A-Za-z0-9_-]+)(?:\/(analyze|cancel))?$/.exec(url.pathname)
      if (match) {
        const session = sessions.get(match[1]); if (!session) throw protocolError(404, 'SESSION_NOT_FOUND', '引擎席位不存在或已经释放。')
        if (request.method === 'DELETE' && !match[2]) { sessions.delete(match[1]); await session.close(); return json(response, 200, { released: true }) }
        if (request.method === 'POST' && match[2] === 'cancel') { session.cancel(); return json(response, 200, { cancelled: true }) }
        if (request.method === 'POST' && match[2] === 'analyze') {
          const input = validateSearch(await readJson(request)); const abort = new AbortController(); const cancel = () => abort.abort(new Error('Client disconnected.'))
          request.once('aborted', cancel); response.once('close', cancel)
          try { return json(response, 200, await session.analyze(input, abort.signal)) } finally { request.off('aborted', cancel); response.off('close', cancel) }
        }
      }
      return json(response, 404, { code: 'NOT_FOUND', message: '接口不存在。' })
    } catch (error) { if (!response.writableEnded && !response.destroyed) json(response, error.status ?? 503, { code: error.code ?? 'ARENA_UNAVAILABLE', message: error.message }) }
  }).on('close', () => { for (const session of sessions.values()) void session.close(); sessions.clear() })
}

function validateSearch(value) { if (!value || typeof value !== 'object') throw protocolError(400, 'INVALID_BODY', '请求体无效。'); const moves = Array.isArray(value.moves) ? value.moves : []; if (moves.length > 400 || moves.some((move) => !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) throw protocolError(400, 'INVALID_MOVES', 'UCI 着法列表无效。'); const chess = new Chess(); for (const uci of moves) { let move = null; try { move = chess.move({ from: uci.slice(0,2), to: uci.slice(2,4), ...(uci[4] ? { promotion: uci[4] } : {}) }) } catch { move = null }; if (!move) throw protocolError(400, 'ILLEGAL_MOVE', `非法历史着法：${uci}`) }; const clock = value.clock && typeof value.clock === 'object' ? { wtimeMs: boundedInt(value.clock.wtimeMs, 0, 86400000, 0), btimeMs: boundedInt(value.clock.btimeMs, 0, 86400000, 0), wincMs: boundedInt(value.clock.wincMs, 0, 600000, 0), bincMs: boundedInt(value.clock.bincMs, 0, 600000, 0) } : undefined; return { moves, movetimeMs: clock ? Math.max(clock.wtimeMs, clock.btimeMs, 50) : boundedInt(value.movetimeMs, 50, 120000, 10000), ...(clock ? { clock } : {}), ...(value.maxDepth ? { maxDepth: boundedInt(value.maxDepth, 1, 128, 128) } : {}) } }
function boundedInt(value, min, max, fallback) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback }
function assertLocalRequest(request) { const host = String(request.headers.host ?? '').split(':')[0].toLowerCase(); if ((host !== '127.0.0.1' && host !== 'localhost') || request.headers['sec-fetch-site'] === 'cross-site') throw protocolError(403, 'LOCAL_REQUEST_REQUIRED', '本机引擎只接受本地站点请求。') }
function readJson(request) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; request.on('data', (chunk) => { size += chunk.length; if (size > 262144) reject(protocolError(413, 'BODY_TOO_LARGE', '请求体过大。')); else chunks.push(chunk) }); request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(protocolError(400, 'INVALID_JSON', '请求体不是有效 JSON。')) } }); request.on('error', reject) }) }
function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)) }

async function main() { const timeoutMs = boundedInt(process.env.ARENA_TIMEOUT_MS, 1000, 180000, 45000); const availableEngines = Object.values(ENGINE_DEFINITIONS).filter((engine) => process.env[engine.pathEnv]).map((engine) => ({ id: engine.id, name: engine.name, commit: engine.commit })); const createSession = (engine, threads, hashMb) => new UciSession({ engine, binaryPath: process.env[engine.pathEnv], binarySha256: process.env[engine.hashEnv], threads, hashMb, timeoutMs }); const server = createChessArenaServer({ createSession, availableEngines }); const port = boundedInt(process.env.PORT, 1, 65535, 8792); server.listen(port, '127.0.0.1', () => process.stdout.write(`[chess-arena] listening on ${port}; engines start lazily\n`)); const shutdown = () => server.close(); process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown) }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
