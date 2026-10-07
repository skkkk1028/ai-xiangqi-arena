import type { MatchArchiveV1 } from '../core'
import { createChessArchive, restoreChessArchive } from './archive'
import { ChessGameEngine, parseChessUci, actionToUci, isChessMoveAction } from './rules'
import type { ChessGameState } from './types'

export const NOTEBOOK_CATEGORIES = ['未分类', '待理解', '值得重试', '已掌握'] as const
export type NotebookCategory = typeof NOTEBOOK_CATEGORIES[number]
export interface NotebookSource { kind: 'live' | 'guess' | 'review' | 'practice'; label: string }
export interface NotebookReference { guessed?: string; actual?: string; description?: string }
export interface NotebookDraft { archive: MatchArchiveV1<'chess'>; source: NotebookSource; reference?: NotebookReference }
export interface NotebookEntry extends NotebookDraft {
  id: string; createdAt: string; updatedAt: string; title: string; note: string; category: NotebookCategory
}
const game = new ChessGameEngine()
const FORMAT = 'project10-chess-notebook'
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit
function validate(value: unknown): NotebookEntry {
  const e = value as NotebookEntry
  if (!e || !text(e.id, 100) || !e.id || !text(e.title, 120) || !e.title.trim()
    || !text(e.note, 4000) || !NOTEBOOK_CATEGORIES.includes(e.category)
    || !text(e.createdAt, 40) || !Number.isFinite(Date.parse(e.createdAt)) || !text(e.updatedAt, 40) || !Number.isFinite(Date.parse(e.updatedAt))
    || !e.archive || !Array.isArray(e.archive.moves) || e.archive.moves.length > 2000
    || !e.source || !['live', 'guess', 'review', 'practice'].includes(e.source.kind) || !text(e.source.label, 200)) throw new Error('练习本条目格式不正确。')
  const state = restoreChessArchive(e.archive)
  const reference: NotebookReference = {}
  if (e.reference !== undefined) {
    if (!e.reference || typeof e.reference !== 'object' || Array.isArray(e.reference)
      || (e.reference.description !== undefined && !text(e.reference.description, 200))) throw new Error('参考信息格式不正确。')
    for (const key of ['guessed', 'actual'] as const) {
      const action = e.reference[key]
      if (action === undefined) continue
      if (typeof action !== 'string' || !parseChessUci(action)) throw new Error('参考落子格式不正确。')
      const canonical = game.getLegalActions(state).filter(isChessMoveAction).find((move) => actionToUci(move) === action)
      if (!canonical) throw new Error('参考落子与收藏局面不一致。')
      reference[key] = actionToUci(canonical)
    }
    if (e.reference.description) reference.description = e.reference.description
  }
  return { id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt, title: e.title.trim(), note: e.note, category: e.category,
    archive: createChessArchive({state, players: e.archive.players, now: new Date(e.archive.updatedAt), createdAt: e.archive.createdAt}),
    source: { kind: e.source.kind, label: e.source.label }, ...(e.reference ? { reference } : {}) }
}
export function createNotebookEntry(draft: NotebookDraft, title = `第 ${draft.archive.moves.length} 手后的局面`, note = '', category: NotebookCategory = '未分类'): NotebookEntry {
  const now = new Date().toISOString()
  return validate({ ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now, title, note, category })
}
export function notebookKey(e: NotebookDraft): string {
  return JSON.stringify([e.archive.ruleset, e.archive.initialPosition, e.archive.moves, e.archive.status, e.archive.result, e.source.kind, e.reference?.guessed ?? null, e.reference?.actual ?? null, e.reference?.description ?? null])
}
export function exportNotebook(entries: NotebookEntry[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, entries: entries.map(validate) }, null, 2)
}
export function parseNotebook(raw: string): NotebookEntry[] {
  if (raw.length > 10 * 1024 * 1024) throw new Error('导入文件过大，最多支持 10 MB。')
  const data = JSON.parse(raw)
  if (!data || data.format !== FORMAT || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 2000) throw new Error('不支持的练习本文件。')
  return data.entries.map(validate)
}
export function downloadNotebook(entries: NotebookEntry[]) {
  const url = URL.createObjectURL(new Blob([exportNotebook(entries)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = '国际象棋-个人练习本.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open('project10-chess-notebook', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('entries', { keyPath: 'id' })
      store.createIndex('contentKey', 'contentKey', { unique: true })
    }
    request.onerror = () => reject(request.error ?? new Error('练习本无法打开。'))
    request.onblocked = () => { blocked = true; reject(new Error('请关闭其他旧页面后重试。')) }
    request.onsuccess = () => { if (blocked) { request.result.close(); return }; request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, finish: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', mode)
    let result: T
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('练习本操作未完成。')) }
    tx.onerror = () => { /* Abort reports transaction failure, never partial success. */ }
    try { run(tx.objectStore('entries'), (value) => { result = value }) } catch (error) { tx.abort(); reject(error) }
  })
}
export const chessNotebook = {
  list: () => transaction<NotebookEntry[]>('readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done(request.result.map(validate).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }),
  get: (id: string) => transaction<NotebookEntry | undefined>('readonly', (store, done) => {
    const request = store.get(id); request.onsuccess = () => done(request.result ? validate(request.result) : undefined)
  }),
  save: (entry: NotebookEntry) => {
    const valid = validate(entry)
    return transaction<NotebookEntry>('readwrite', (store, done) => {
      const request = store.index('contentKey').get(notebookKey(valid))
      request.onsuccess = () => {
        if (request.result) done(validate(request.result))
        else { store.add({ ...valid, contentKey: notebookKey(valid) }); done(valid) }
      }
    })
  },
  update: (entry: NotebookEntry) => {
    const valid = validate(entry)
    return transaction<void>('readwrite', (store, done) => {
      const request = store.get(valid.id)
      request.onsuccess = () => {
        if (!request.result) { store.transaction.abort(); return }
        store.put({ ...request.result, title: valid.title, note: valid.note, category: valid.category, updatedAt: new Date().toISOString() }); done(undefined)
      }
    })
  },
  remove: (id: string) => transaction<void>('readwrite', (store, done) => { store.delete(id); done(undefined) }),
  import: (raw: string) => {
    const entries = parseNotebook(raw)
    return transaction<{ added: number; skipped: number }>('readwrite', (store, done) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const keys = new Set(request.result.map((e: NotebookEntry) => notebookKey(e)))
        let added = 0
        for (const entry of entries) {
          const key = notebookKey(entry)
          if (keys.has(key)) continue
          store.add({ ...entry, id: crypto.randomUUID(), contentKey: key }); keys.add(key); added++
        }
        done({ added, skipped: entries.length - added })
      }
    })
  },
}

export function chessNotebookDraft(state: ChessGameState, source: NotebookSource, reference?: NotebookReference): NotebookDraft {
  return {archive: createChessArchive({state, players: [{seat: 'w', kind: 'human', name: '白方'}, {seat: 'b', kind: 'human', name: '黑方'}]}), source, reference}
}
