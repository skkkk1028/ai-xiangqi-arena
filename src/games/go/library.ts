import type { MatchArchiveV1 } from '../core'
import { parseMatchArchive } from '../core'
import { createGoArchive, importGoSgf, restoreGoArchive } from './sgf'
import type { KataGoWireAnalysisEvent } from './ai/types'

export interface GoLibraryGame {
  id: string
  title: string
  favorite: boolean
  archive: MatchArchiveV1<'go'>
  mode: string
  configuration: Record<string, string>
  source?: { gameId: string; moveNumber: number }
}
export interface GoSavedAnalysis {
  key: string
  gameId: string
  prefix: readonly string[]
  ruleset: string
  profile: 'winrate' | 'fast'
  createdAt: string
  event: KataGoWireAnalysisEvent
}
export interface GoLibraryExport {
  format: 'project10-go-library'
  version: 1
  game: GoLibraryGame
  analyses: GoSavedAnalysis[]
}

export const newGoId = () => crypto.randomUUID()
let database: Promise<IDBDatabase> | null = null
let writes: Promise<unknown> = Promise.resolve()
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('project10-go-library', 1)
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
    request.onblocked = () => { database = null; reject(new Error('棋谱库升级被其他窗口阻塞，请关闭旧页面重试。')) }
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
    try { run(tx, (next) => { value = next }) } catch (error) { tx.abort(); reject(error) }
  })
}

export const goLibrary = {
  async list(): Promise<GoLibraryGame[]> {
    await writes.catch(() => undefined)
    return transaction(['games'], 'readonly', (tx, result) => {
      tx.objectStore('games').getAll().onsuccess = (event) => result((event.target as IDBRequest<GoLibraryGame[]>).result.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.archive.updatedAt.localeCompare(a.archive.updatedAt)))
    })
  },
  save(game: GoLibraryGame): Promise<void> {
    const snapshot = structuredClone(game)
    return queued(() => transaction(['games'], 'readwrite', (tx) => {
      const store = tx.objectStore('games')
      const request = store.get(snapshot.id)
      request.onsuccess = () => {
        const old = request.result as GoLibraryGame | undefined
        store.put(old ? { ...snapshot, title: old.title, favorite: old.favorite, archive: { ...snapshot.archive, createdAt: old.archive.createdAt } } : snapshot)
      }
    }))
  },
  update(id: string, changes: Pick<GoLibraryGame, 'title' | 'favorite'>): Promise<void> {
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
  async analyses(id: string): Promise<GoSavedAnalysis[]> {
    await writes.catch(() => undefined)
    return transaction(['analyses'], 'readonly', (tx, result) => {
      const request = tx.objectStore('analyses').index('gameId').getAll(id)
      request.onsuccess = () => result(request.result)
    })
  },
  saveAnalysis(analysis: GoSavedAnalysis): Promise<void> {
    const snapshot = structuredClone(analysis)
    return queued(() => transaction(['analyses'], 'readwrite', (tx) => { tx.objectStore('analyses').put(snapshot) }))
  },
  import(bundle: GoLibraryExport): Promise<void> {
    // Validate the entire bundle before beginning the atomic write.
    const checked = parseGoLibraryFile(JSON.stringify(bundle), false)
    return queued(() => transaction(['games', 'analyses'], 'readwrite', (tx) => {
      tx.objectStore('games').put(checked.game)
      for (const analysis of checked.analyses) tx.objectStore('analyses').put(analysis)
    }))
  },
  migrateLatest(): Promise<void> {
    return queued(async () => {
      const migrated = await transaction<boolean>(['metadata'], 'readonly', (tx, result) => {
        const request = tx.objectStore('metadata').get('legacy-latest-imported')
        request.onsuccess = () => result(request.result === true)
      })
      if (migrated) return
      const raw = localStorage.getItem('ai-board-games:latest:go:v1')
      const bundle = raw ? parseGoLibraryFile(raw) : null
      await transaction(['games', 'metadata'], 'readwrite', (tx) => {
        if (bundle) tx.objectStore('games').put({ ...bundle.game, title: '旧版最近一局' })
        tx.objectStore('metadata').put(true, 'legacy-latest-imported')
      })
    })
  },
}

export function analysisIdentity(event: KataGoWireAnalysisEvent): string {
  return JSON.stringify([event.engineVersion, event.modelName, event.runtimeBackend, event.profile, event.requestedVisits, event.modelFallback, event.backendFallback])
}
export function analysisKey(gameId: string, ruleset: string, prefix: readonly string[], event: KataGoWireAnalysisEvent): string {
  return JSON.stringify([gameId, ruleset, prefix, analysisIdentity(event)])
}
export function validateGoAnalysis(event: KataGoWireAnalysisEvent): void {
  const probability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1
  const nonnegative = (value: number) => Number.isFinite(value) && value >= 0
  if (!event || event.type !== 'analysis' || event.stage !== 'final' || !['winrate', 'fast'].includes(event.profile)
    || typeof event.engineVersion !== 'string' || typeof event.modelName !== 'string'
    || !['native-katago', 'browser-webgpu', 'browser-wasm', 'browser-cpu'].includes(event.runtimeBackend)
    || !event.root || !probability(event.root.winrate) || !nonnegative(event.root.visits)
    || !(event.root.scoreLead === null || Number.isFinite(event.root.scoreLead))
    || !nonnegative(event.requestedVisits) || !nonnegative(event.elapsedMs)
    || typeof event.timedOut !== 'boolean' || typeof event.truncated !== 'boolean'
    || !Array.isArray(event.candidates) || event.candidates.some((candidate) =>
      !candidate || typeof candidate.move !== 'string' || !nonnegative(candidate.order) || !nonnegative(candidate.visits)
      || !probability(candidate.winrate) || !(candidate.scoreLead === null || Number.isFinite(candidate.scoreLead))
      || !Array.isArray(candidate.pv) || candidate.pv.some((move: unknown) => typeof move !== 'string'))) throw new Error('围棋分析记录无效。')
}

export function parseGoLibraryFile(source: string, freshId = true): GoLibraryExport {
  if (source.trimStart().startsWith('(')) {
    return wrapArchive(createGoArchive(importGoSgf(source)))
  }
  const input = JSON.parse(source)
  if (input?.format !== 'project10-go-library') {
    const archive = parseMatchArchive(input)
    restoreGoArchive(archive)
    return wrapArchive(archive as MatchArchiveV1<'go'>)
  }
  if (input.version !== 1 || !input.game || !Array.isArray(input.analyses)) throw new Error('不支持的围棋棋谱库文件。')
  const game = input.game as GoLibraryGame
  restoreGoArchive(game.archive)
  if (typeof game.id !== 'string' || typeof game.title !== 'string' || typeof game.favorite !== 'boolean' || typeof game.mode !== 'string'
    || !game.configuration || typeof game.configuration !== 'object' || Object.values(game.configuration).some((value) => typeof value !== 'string')
    || (game.source && (typeof game.source.gameId !== 'string' || !Number.isInteger(game.source.moveNumber) || game.source.moveNumber < 0 || game.source.moveNumber > game.archive.moves.length))) throw new Error('棋谱库字段无效。')
  const id = freshId ? newGoId() : game.id
  const analyses = (input.analyses as GoSavedAnalysis[]).map((analysis) => {
    if (!analysis || analysis.gameId !== game.id || analysis.ruleset !== game.archive.ruleset || !Array.isArray(analysis.prefix)
      || analysis.prefix.some((move, index) => move !== game.archive.moves[index]) || !Number.isFinite(Date.parse(analysis.createdAt))) throw new Error('分析记录与棋谱不一致。')
    validateGoAnalysis(analysis.event)
    if (analysis.profile !== analysis.event.profile) throw new Error('分析档位不一致。')
    return { ...analysis, gameId: id, key: analysisKey(id, game.archive.ruleset, analysis.prefix, analysis.event) }
  })
  return { format: 'project10-go-library', version: 1, game: { ...game, id }, analyses }
}
function wrapArchive(archive: MatchArchiveV1<'go'>): GoLibraryExport {
  return { format: 'project10-go-library', version: 1, game: { id: newGoId(), title: `围棋 ${new Date(archive.createdAt).toLocaleString()}`, favorite: false, archive, mode: '导入棋谱', configuration: {} }, analyses: [] }
}
export function downloadGoFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
