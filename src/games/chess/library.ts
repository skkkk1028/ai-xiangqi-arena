import { Chess } from 'chess.js'
import type { EngineSearchResponse, SearchInfo } from '../../game/types'
import { parseMatchArchive, type MatchArchivePlayer, type MatchArchiveV1 } from '../core'
import { createChessArchive, restoreChessArchive } from './archive'
import { parseChessUci, replayChessState } from './rules'
import { CHESS_INITIAL_FEN, CHESS_RULESET, type ChessColor } from './types'

export type ChessLibraryMode = 'theatre' | 'arena' | 'human' | 'local' | 'practice' | 'import'
export interface ChessLibraryGameV1 {
  id: string
  title: string
  favorite: boolean
  mode: ChessLibraryMode
  archive: MatchArchiveV1<'chess'>
  configuration: Record<string, string>
  source?: { gameId: string; ply: number }
  clock?: {
    controlId: 'rapid' | 'standard' | 'deep'
    totals: Record<ChessColor, number>
    moveRemainingMs: number
    runState: 'ready' | 'running' | 'paused' | 'finished'
    result: { reason: 'total-timeout' | 'move-timeout'; winner: ChessColor; loser: ChessColor } | null
  }
  declaredResult?: { token: string; termination: string }
}
export interface ChessSavedAnalysis {
  key: string
  gameId: string
  prefix: string[]
  initialFen: string
  ruleset: string
  tier: 'quick' | 'deep'
  engine: { name: string; version: string; backend: string; threads: number; hashMb: number; network?: string; fallback?: boolean }
  elapsedMs: number
  timedOut: boolean
  response: EngineSearchResponse
  createdAt: string
}
export interface ChessLibraryExportV1 {
  format: 'project10-chess-library'
  version: 1
  game: ChessLibraryGameV1
  analyses: ChessSavedAnalysis[]
}

export const newChessId = () => crypto.randomUUID()
const legacyKeys: readonly [ChessLibraryMode, string][] = [
  ['theatre', 'ai-board-games:latest:chess:v1'],
  ['arena', 'ai-board-games:latest:chess-arena:v1'],
  ['human', 'ai-board-games:latest:chess-human:v1'],
]
let database: Promise<IDBDatabase> | null = null
let writes: Promise<unknown> = Promise.resolve()

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('project10-chess-library', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('games', { keyPath: 'id' })
      request.result.createObjectStore('analyses', { keyPath: 'key' }).createIndex('gameId', 'gameId')
      request.result.createObjectStore('metadata')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = null }
      resolve(db)
    }
    request.onerror = () => { database = null; reject(request.error) }
    request.onblocked = () => { database = null; reject(new Error('棋谱库升级被其他窗口阻塞。')) }
  })
  return database
}

function queued<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => undefined).then(operation)
  writes = next
  return next
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let value: T
    tx.oncomplete = () => resolve(value)
    tx.onabort = () => reject(tx.error ?? new Error('棋谱库写入已中止。'))
    tx.onerror = () => reject(tx.error ?? new Error('棋谱库访问失败。'))
    try { run(tx, (result) => { value = result }) } catch (error) { tx.abort(); reject(error) }
  })
}

export function validateChessLibraryGame(value: unknown): ChessLibraryGameV1 {
  if (!value || typeof value !== 'object') throw new Error('棋谱记录无效。')
  const game = value as ChessLibraryGameV1
  if (typeof game.id !== 'string' || !game.id || typeof game.title !== 'string' || !game.title.trim() || typeof game.favorite !== 'boolean') throw new Error('棋谱记录身份或名称无效。')
  if (!['theatre', 'arena', 'human', 'local', 'practice', 'import'].includes(game.mode)) throw new Error('棋谱模式无效。')
  if (!game.configuration || typeof game.configuration !== 'object' || Array.isArray(game.configuration) || Object.values(game.configuration).some((v) => typeof v !== 'string')) throw new Error('棋谱配置无效。')
  restoreChessArchive(game.archive)
  if (game.source && (typeof game.source.gameId !== 'string' || !Number.isInteger(game.source.ply) || game.source.ply < 0 || game.source.ply > game.archive.moves.length)) throw new Error('练习来源无效。')
  if (game.clock) {
    const clock = game.clock
    if (!['rapid', 'standard', 'deep'].includes(clock.controlId) || !['ready', 'running', 'paused', 'finished'].includes(clock.runState)
      || !Number.isFinite(clock.totals?.w) || !Number.isFinite(clock.totals?.b) || !Number.isFinite(clock.moveRemainingMs)
      || clock.totals.w < 0 || clock.totals.b < 0 || clock.moveRemainingMs < 0) throw new Error('时钟记录无效。')
    if (clock.result && (!['total-timeout', 'move-timeout'].includes(clock.result.reason) || clock.result.winner === clock.result.loser || !['w', 'b'].includes(clock.result.winner) || !['w', 'b'].includes(clock.result.loser))) throw new Error('超时结果无效。')
  }
  if (game.declaredResult && (!['1-0', '0-1', '1/2-1/2', '*'].includes(game.declaredResult.token) || typeof game.declaredResult.termination !== 'string')) throw new Error('PGN 声明结果无效。')
  return game
}

function validateAnalysis(value: unknown, game: ChessLibraryGameV1): ChessSavedAnalysis {
  if (!value || typeof value !== 'object') throw new Error('分析记录无效。')
  const analysis = value as ChessSavedAnalysis
  if (typeof analysis.key !== 'string' || analysis.gameId !== game.id || analysis.ruleset !== CHESS_RULESET
    || analysis.initialFen !== game.archive.initialPosition || !['quick', 'deep'].includes(analysis.tier)
    || !Array.isArray(analysis.prefix) || analysis.prefix.some((move, i) => move !== game.archive.moves[i])
    || analysis.prefix.length > game.archive.moves.length || !analysis.engine || typeof analysis.engine.name !== 'string'
    || typeof analysis.engine.version !== 'string' || typeof analysis.engine.backend !== 'string'
    || !Number.isInteger(analysis.engine.threads) || !Number.isInteger(analysis.engine.hashMb)
    || !Number.isFinite(analysis.elapsedMs) || analysis.elapsedMs < 0 || typeof analysis.timedOut !== 'boolean'
    || !Number.isFinite(Date.parse(analysis.createdAt)) || !analysis.response || !Array.isArray(analysis.response.candidates)) throw new Error('分析记录与棋局不匹配。')
  if (analysis.key !== JSON.stringify([analysis.gameId, analysis.ruleset, analysis.initialFen, analysis.prefix, analysis.tier, analysis.engine])) throw new Error('分析缓存身份无效。')
  const root = replayChessState(analysis.prefix, { initialFen: analysis.initialFen, seed: Number(game.archive.metadata?.seed), openingId: String(game.archive.metadata?.openingId), openingName: String(game.archive.metadata?.openingName) })
  if (analysis.response.bestmove !== null && (typeof analysis.response.bestmove !== 'string' || !legalPv(root.fen, [analysis.response.bestmove]))) throw new Error('分析推荐着无效。')
  validateSearchInfo(analysis.response.info, root.fen)
  for (const candidate of analysis.response.candidates) {
    validateSearchInfo(candidate, root.fen)
    if (!Number.isInteger(candidate.multipv) || candidate.multipv < 1 || candidate.multipv > 4) throw new Error('分析候选序号无效。')
  }
  return analysis
}

function normalizeArchive(archive: MatchArchiveV1<'chess'>): MatchArchiveV1<'chess'> {
  const state = restoreChessArchive(archive)
  return archive.ruleset === CHESS_RULESET ? archive : createChessArchive({
    state, players: archive.players, createdAt: archive.createdAt, now: new Date(archive.updatedAt),
  })
}

function legalPv(fen: string, pv: readonly string[]): boolean {
  const board = new Chess(fen)
  try {
    for (const uci of pv) {
      const move = parseChessUci(uci)
      if (!move) return false
      board.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) })
    }
    return true
  } catch { return false }
}

function validateSearchInfo(info: SearchInfo, fen: string): void {
  if (!info || !Number.isFinite(info.depth) || info.depth < 0 || !Number.isFinite(info.nodes) || info.nodes < 0
    || !Number.isFinite(info.nps) || info.nps < 0 || !Number.isFinite(info.elapsedMs) || info.elapsedMs < 0
    || !Array.isArray(info.pv) || info.pv.some((item) => typeof item !== 'string') || !legalPv(fen, info.pv)
    || info.score && (!['cp', 'mate'].includes(info.score.kind) || !Number.isFinite(info.score.value))
    || info.wdl && Object.values(info.wdl).some((value) => !Number.isFinite(value) || value < 0)) throw new Error('分析评价或变化无效。')
}

export function parseChessLibraryJson(text: string): ChessLibraryExportV1 {
  const parsed: unknown = JSON.parse(text)
  if (parsed && typeof parsed === 'object' && (parsed as { format?: string }).format === 'project10-chess-library') {
    const bundle = parsed as ChessLibraryExportV1
    if (bundle.version !== 1 || !Array.isArray(bundle.analyses)) throw new Error('棋谱包版本或分析列表无效。')
    const game = validateChessLibraryGame(bundle.game)
    game.archive = normalizeArchive(game.archive)
    return { ...bundle, game, analyses: bundle.analyses.map((entry) => validateAnalysis(entry, game)) }
  }
  const archive = parseMatchArchive(parsed) as MatchArchiveV1<'chess'>
  const normalized = normalizeArchive(archive)
  const game: ChessLibraryGameV1 = { id: newChessId(), title: `导入棋局 ${new Date().toLocaleString()}`, favorite: false, mode: 'import', configuration: {}, archive: normalized }
  return { format: 'project10-chess-library', version: 1, game, analyses: [] }
}

export function importChessPgn(text: string): ChessLibraryGameV1 {
  if (containsPgnVariation(text)) throw new Error('PGN 含分支变化，首版只接受单条主线。')
  const headerResult = /^\s*\[Result\s+"([^"]+)"\s*\]/m.exec(text)?.[1]
  const eventCount = [...text.matchAll(/^\s*\[Event\s+/gm)].length
  if (eventCount > 1) throw new Error('请每次导入一局 PGN。')
  const chess = new Chess()
  try { chess.loadPgn(text, { strict: true }) } catch { throw new Error('PGN 语法或着法无效。') }
  const headers = chess.getHeaders()
  if (headers.Variant && !/^(standard|chess)$/i.test(headers.Variant)) throw new Error('只支持标准国际象棋。')
  if (headers.SetUp && headers.SetUp !== '1') throw new Error('PGN SetUp 无效。')
  if (headers.SetUp === '1' && !headers.FEN) throw new Error('PGN 缺少初始 FEN。')
  if (headers.FEN && headers.SetUp !== '1') throw new Error('PGN 自定义 FEN 必须声明 SetUp 1。')
  const initialFen = headers.FEN ?? CHESS_INITIAL_FEN
  try { new Chess(initialFen) } catch { throw new Error('PGN 初始 FEN 无效。') }
  const moves = chess.history({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`)
  const state = replayChessState(moves, { initialFen })
  const players: MatchArchivePlayer[] = [
    { seat: 'w', kind: 'human', name: headers.White || 'PGN 白方' },
    { seat: 'b', kind: 'human', name: headers.Black || 'PGN 黑方' },
  ]
  const token = headers.Result ?? '*'
  if (headerResult && headerResult !== token) throw new Error('PGN 标头与主线结果不一致。')
  if (!['1-0', '0-1', '1/2-1/2', '*'].includes(token)) throw new Error('PGN 结果无效。')
  return {
    id: newChessId(), title: headers.Event || `导入棋局 ${new Date().toLocaleString()}`, favorite: false, mode: 'import',
    configuration: {}, archive: createChessArchive({ state, players }),
    ...(token !== '*' ? { declaredResult: { token, termination: headers.Termination ?? 'PGN 声明，未由棋盘验证' } } : {}),
  }
}

function containsPgnVariation(text: string): boolean {
  let curly = false
  let tag = false
  let lineComment = false
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\n') { lineComment = false; continue }
    if (lineComment) continue
    if (curly) { if (char === '}') curly = false; continue }
    if (tag) {
      if (char === '"' && text[i - 1] !== '\\') quoted = !quoted
      if (char === ']' && !quoted) tag = false
      continue
    }
    if (char === '{') { curly = true; continue }
    if (char === ';') { lineComment = true; continue }
    if (char === '[') { tag = true; continue }
    if (char === '(' || char === ')') return true
  }
  return false
}

export const chessLibrary = {
  async list(): Promise<ChessLibraryGameV1[]> {
    await writes.catch(() => undefined)
    return transaction(['games'], 'readonly', (tx, result) => {
      const request = tx.objectStore('games').getAll()
      request.onsuccess = () => result((request.result as ChessLibraryGameV1[]).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.archive.updatedAt.localeCompare(a.archive.updatedAt)))
    })
  },
  async get(id: string): Promise<ChessLibraryGameV1 | undefined> {
    await writes.catch(() => undefined)
    return transaction(['games'], 'readonly', (tx, result) => {
      const request = tx.objectStore('games').get(id)
      request.onsuccess = () => result(request.result as ChessLibraryGameV1 | undefined)
    })
  },
  save(game: ChessLibraryGameV1): Promise<void> {
    const snapshot = structuredClone(validateChessLibraryGame(game))
    return queued(() => transaction(['games'], 'readwrite', (tx) => {
      const store = tx.objectStore('games')
      const request = store.get(snapshot.id)
      request.onsuccess = () => {
        const old = request.result as ChessLibraryGameV1 | undefined
        store.put(old ? { ...snapshot, title: old.title, favorite: old.favorite, archive: { ...snapshot.archive, createdAt: old.archive.createdAt } } : snapshot)
      }
    }))
  },
  update(id: string, changes: Partial<Pick<ChessLibraryGameV1, 'title' | 'favorite'>>): Promise<void> {
    return queued(() => transaction(['games'], 'readwrite', (tx) => {
      const store = tx.objectStore('games')
      const request = store.get(id)
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, ...changes }) }
    }))
  },
  remove(id: string): Promise<void> {
    return queued(() => transaction(['games', 'analyses'], 'readwrite', (tx) => {
      tx.objectStore('games').delete(id)
      const request = tx.objectStore('analyses').index('gameId').openCursor(IDBKeyRange.only(id))
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue() } }
    }))
  },
  async analyses(id: string): Promise<ChessSavedAnalysis[]> {
    await writes.catch(() => undefined)
    return transaction(['analyses'], 'readonly', (tx, result) => {
      const request = tx.objectStore('analyses').index('gameId').getAll(id)
      request.onsuccess = () => result(request.result as ChessSavedAnalysis[])
    })
  },
  saveAnalysis(analysis: ChessSavedAnalysis): Promise<void> {
    const snapshot = structuredClone(analysis)
    return queued(() => transaction(['analyses'], 'readwrite', (tx) => { tx.objectStore('analyses').put(snapshot) }))
  },
  import(bundle: ChessLibraryExportV1): Promise<void> {
    const checked = parseChessLibraryJson(JSON.stringify(bundle))
    const newId = newChessId()
    const game = { ...checked.game, id: newId }
    const analyses = checked.analyses.map((entry) => ({ ...entry, gameId: newId, key: JSON.stringify([newId, entry.ruleset, entry.initialFen, entry.prefix, entry.tier, entry.engine]) }))
    return queued(() => transaction(['games', 'analyses'], 'readwrite', (tx) => {
      tx.objectStore('games').put(game)
      analyses.forEach((analysis) => tx.objectStore('analyses').put(analysis))
    }))
  },
  migrateLatest(): Promise<void> {
    const legacy = legacyKeys.map(([mode, key]) => {
      try { return [mode, localStorage.getItem(key)] as const }
      catch { return [mode, null] as const }
    })
    return queued(async () => {
      const done = await transaction<boolean>(['metadata'], 'readonly', (tx, result) => {
        const request = tx.objectStore('metadata').get('legacy-latest-imported')
        request.onsuccess = () => result(request.result === true)
      })
      if (done) return
      const games: ChessLibraryGameV1[] = []
      const signatures = new Set<string>()
      for (const [mode, raw] of legacy) {
        if (!raw) continue
        try {
          const archive = parseMatchArchive(raw) as MatchArchiveV1<'chess'>
          const normalized = normalizeArchive(archive)
          const signature = JSON.stringify([archive.initialPosition, archive.moves, archive.players])
          if (signatures.has(signature)) continue
          signatures.add(signature)
          games.push({ id: newChessId(), title: `${mode} · 旧版最近一局`, favorite: false, mode, configuration: {}, archive: normalized })
        } catch { /* Leave damaged legacy data untouched. */ }
      }
      await transaction(['games', 'metadata'], 'readwrite', (tx) => {
        games.forEach((game) => tx.objectStore('games').put(game))
        tx.objectStore('metadata').put(true, 'legacy-latest-imported')
      })
    })
  },
}
