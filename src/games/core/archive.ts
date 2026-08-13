import type { EngineRuntimeSnapshot } from './engine-runtime'

export interface MatchArchivePlayer {
  seat: string
  kind: 'human' | 'ai'
  name: string
  engine?: EngineRuntimeSnapshot
}

export interface MatchArchiveV1<TGame extends 'xiangqi' | 'go' | 'chess' = 'xiangqi' | 'go' | 'chess'> {
  version: 1
  game: TGame
  ruleset: string
  createdAt: string
  updatedAt: string
  status: 'playing' | 'review' | 'finished'
  players: readonly MatchArchivePlayer[]
  moves: readonly string[]
  result: Record<string, unknown> | null
  initialPosition?: string
  metadata?: Record<string, string | number | boolean | null>
}

export function parseMatchArchive(value: string | unknown): MatchArchiveV1 {
  const input: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!input || typeof input !== 'object') throw new Error('棋局档案必须是 JSON 对象。')
  const archive = input as Partial<MatchArchiveV1>
  if (archive.version !== 1) throw new Error('不支持的棋局档案版本。')
  if (archive.game !== 'xiangqi' && archive.game !== 'go' && archive.game !== 'chess') throw new Error('棋局档案包含未知棋类。')
  if (typeof archive.ruleset !== 'string' || archive.ruleset.trim().length === 0) {
    throw new Error('棋局档案缺少规则集。')
  }
  if (!Array.isArray(archive.moves) || archive.moves.some((move) => typeof move !== 'string')) {
    throw new Error('棋局档案 moves 必须是字符串数组。')
  }
  if (!['playing', 'review', 'finished'].includes(String(archive.status))) {
    throw new Error('棋局档案状态无效。')
  }
  if (!Array.isArray(archive.players) || archive.players.length !== 2) {
    throw new Error('棋局档案必须包含双方玩家信息。')
  }
  for (const player of archive.players) {
    if (!player || typeof player !== 'object') throw new Error('棋局档案玩家信息无效。')
    const candidate = player as Partial<MatchArchivePlayer>
    if (
      typeof candidate.seat !== 'string'
      || typeof candidate.name !== 'string'
      || (candidate.kind !== 'human' && candidate.kind !== 'ai')
    ) {
      throw new Error('棋局档案玩家字段无效。')
    }
  }
  if (!validDate(archive.createdAt) || !validDate(archive.updatedAt)) {
    throw new Error('棋局档案时间无效。')
  }
  return archive as MatchArchiveV1
}

export function serializeMatchArchive(archive: MatchArchiveV1): string {
  return JSON.stringify(parseMatchArchive(archive), null, 2)
}

export function saveLatestArchive(archive: MatchArchiveV1, storage: Storage = localStorage): void {
  storage.setItem(storageKey(archive.game), serializeMatchArchive(archive))
}

export function loadLatestArchive(game: MatchArchiveV1['game'], storage: Storage = localStorage): MatchArchiveV1 | null {
  const value = storage.getItem(storageKey(game))
  return value ? parseMatchArchive(value) : null
}

export function clearLatestArchive(game: MatchArchiveV1['game'], storage: Storage = localStorage): void {
  storage.removeItem(storageKey(game))
}

function storageKey(game: MatchArchiveV1['game']): string {
  return `ai-board-games:latest:${game}:v1`
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
