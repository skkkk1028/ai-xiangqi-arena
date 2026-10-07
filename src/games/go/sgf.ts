import { GoGameEngine } from './game-engine'
import { GO_PASS_MOVE, type GoGameState, type GoMove, type GoPoint } from './types'
import type { MatchArchivePlayer, MatchArchiveV1 } from '../core'
import { parseMatchArchive } from '../core'
import { gtpToGoMove } from './ai/coordinates'

const SGF_COLUMNS = 'abcdefghijklmnopqrs'
const ARCHIVE_RULESET = 'chinese-area-19-psk-komi-7.5'

// A recorded move after two passes proves that play was resumed. Preserve
// the original passes and positional-superko history when replaying it.
export function applyGoReplayMove(engine: GoGameEngine, state: GoGameState, move: GoMove): GoGameState {
  return engine.applyMove(state.phase === 'scoring' ? engine.resumePlay(state) : state, move)
}

export function exportGoSgf(state: GoGameState, app = 'AI Board Games'): string {
  const result = state.result
    ? state.result.winner
      ? `${state.result.winner === 'black' ? 'B' : 'W'}+${state.result.score.margin}`
      : '0'
    : ''
  const moves = state.history.map((record) => {
    const color = record.color === 'black' ? 'B' : 'W'
    const point = record.kind === 'pass' || !record.point
      ? ''
      : `${SGF_COLUMNS[record.point.col]}${SGF_COLUMNS[record.point.row]}`
    return `;${color}[${point}]`
  }).join('')
  return `(;GM[1]FF[4]CA[UTF-8]AP[${escapeSgf(app)}]SZ[19]RU[Chinese]KM[7.5]${result ? `RE[${result}]` : ''}${moves})`
}

/** Imports a single main line and validates every move with the production rules engine. */
export function importGoSgf(source: string): GoGameState {
  const nodes = parseSgfMainline(source)
  const root = nodes[0]
  if (root.GM?.[0] !== '1' || root.SZ?.[0] !== '19') throw new Error('当前只支持十九路围棋 SGF。')
  if (root.KM?.[0] !== '7.5' || !/^(Chinese|中国规则)$/i.test(root.RU?.[0] ?? '')) throw new Error('SGF 必须明确使用中国规则和 7.5 贴目。')
  const allowed = new Set(['GM', 'FF', 'CA', 'AP', 'SZ', 'RU', 'KM', 'RE', 'PB', 'PW', 'BR', 'WR', 'DT', 'GN', 'EV', 'RO', 'PC', 'SO', 'US', 'C', 'N', 'B', 'W'])
  for (const [index, node] of nodes.entries()) {
    for (const key of Object.keys(node)) {
      if (!allowed.has(key)) throw new Error(`SGF 暂不支持属性 ${key}（不支持让子、布局或分支）。`)
      if (node[key].length !== 1) throw new Error(`SGF 属性 ${key} 不支持多个值。`)
      if (index > 0 && ['GM', 'SZ', 'RU', 'KM'].includes(key)) throw new Error('SGF 中途不能改变规则。')
    }
  }
  const engine = new GoGameEngine()
  let state = engine.init()
  for (const node of nodes) {
    if (node.B && node.W) throw new Error('SGF 节点不能同时包含黑白落子。')
    if (!node.B && !node.W) continue
    const expected = node.B ? 'black' : 'white'
    if (state.turn !== expected) throw new Error(`SGF 第 ${state.history.length + 1} 手执子顺序无效。`)
    state = applyGoReplayMove(engine, state, sgfPoint((node.B ?? node.W)[0]))
  }
  return state
}

export function createGoArchive(state: GoGameState, now = new Date(), options: { players?: readonly MatchArchivePlayer[]; createdAt?: string } = {}): MatchArchiveV1<'go'> {
  const timestamp = now.toISOString()
  return {
    version: 1,
    game: 'go',
    ruleset: ARCHIVE_RULESET,
    createdAt: options.createdAt ?? timestamp,
    updatedAt: timestamp,
    status: state.phase === 'scoring' ? 'review' : state.phase,
    players: options.players ?? [
      { seat: 'black', kind: 'human', name: '黑方' },
      { seat: 'white', kind: 'human', name: '白方' },
    ],
    moves: state.history.map((move) => `${move.color === 'black' ? 'B' : 'W'}:${move.notation}`),
    result: state.result ? {
      winner: state.result.winner,
      reason: state.result.reason,
      black: state.result.score.black.total,
      white: state.result.score.white.total,
      margin: state.result.score.margin,
      confirmedDeadStones: state.result.score.confirmedDeadStones,
    } : null,
    metadata: { komi: 7.5, boardSize: 19, repetition: 'positional-superko' },
  }
}

function parseSgfMainline(source: string): Record<string, string[]>[] {
  let offset = 0
  const whitespace = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset += 1 }
  const requireChar = (char: string) => { whitespace(); if (source[offset++] !== char) throw new Error('SGF 格式无效或含分支，仅支持单一完整主线。') }
  requireChar('(')
  const nodes: Record<string, string[]>[] = []
  whitespace()
  while (source[offset] === ';') {
    offset += 1
    const node: Record<string, string[]> = {}
    whitespace()
    while (/[A-Z]/.test(source[offset] ?? '') && offset < source.length) {
      let key = ''
      while (/[A-Z]/.test(source[offset] ?? '') && offset < source.length) key += source[offset++]
      if (node[key]) throw new Error(`SGF 属性重复：${key}`)
      const values: string[] = []
      whitespace()
      while (source[offset] === '[') {
        offset += 1
        let value = ''
        while (offset < source.length && source[offset] !== ']') {
          if (source[offset] === '\\') {
            offset += 1
            if (offset >= source.length) throw new Error('SGF 转义不完整。')
            if (source[offset] === '\r' || source[offset] === '\n') { if (source[offset++] === '\r' && source[offset] === '\n') offset += 1; continue }
          }
          value += source[offset++]
        }
        if (source[offset++] !== ']') throw new Error('SGF 属性未闭合。')
        values.push(value)
        whitespace()
      }
      if (!values.length) throw new Error('SGF 属性缺少值。')
      node[key] = values
    }
    nodes.push(node)
  }
  requireChar(')')
  whitespace()
  if (offset !== source.length || !nodes.length) throw new Error('SGF 必须为单一完整棋谱。')
  return nodes
}

export function restoreGoArchive(value: string | unknown): GoGameState {
  const archive = parseMatchArchive(value)
  if (archive.game !== 'go') throw new Error('该档案不是围棋棋局。')
  if (archive.ruleset !== ARCHIVE_RULESET) throw new Error('不支持该围棋档案的规则集。')
  const engine = new GoGameEngine()
  let state = engine.init()
  for (const [index, encoded] of archive.moves.entries()) {
    const match = /^([BW]):(.+)$/.exec(encoded)
    if (!match) throw new Error(`围棋档案第 ${index + 1} 手格式无效。`)
    const expected = match[1] === 'B' ? 'black' : 'white'
    if (state.turn !== expected) throw new Error(`围棋档案第 ${index + 1} 手执子顺序无效。`)
    state = applyGoReplayMove(engine, state, gtpToGoMove(match[2]))
  }
  if (archive.status === 'finished') {
    if (state.phase !== 'scoring' || !archive.result) throw new Error('围棋终局档案缺少计分局面或结果。')
    const points = archive.result.confirmedDeadStones ?? []
    if (!Array.isArray(points) || points.some((point: unknown) => {
      if (!point || typeof point !== 'object') return true
      const { row, col } = point as GoPoint
      return !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= 19 || col < 0 || col >= 19
    })) throw new Error('围棋档案死子坐标无效。')
    state = engine.finalizeScoring(state, { deadStoneRepresentatives: points })
    const result = state.result!
    const expected = { winner: result.winner, reason: result.reason, black: result.score.black.total, white: result.score.white.total, margin: result.score.margin }
    if (Object.entries(expected).some(([key, value]) => archive.result![key] !== value)) {
      throw new Error('围棋结算与重算结果不一致；旧档案可能缺少死子信息，请重新导出。')
    }
  } else {
    if (archive.result !== null) throw new Error('未结束的围棋档案不能包含终局结果。')
    if (archive.status === 'review' && state.phase !== 'scoring') throw new Error('围棋档案计分状态与棋谱不一致。')
    // Also covers a save immediately after Resume, before the next move.
    if (archive.status === 'playing' && state.phase === 'scoring') state = engine.resumePlay(state)
  }
  return state
}

function sgfPoint(value: string): GoMove {
  if (!value) return GO_PASS_MOVE
  if (!/^[a-s]{2}$/i.test(value)) throw new Error(`SGF 包含无效落点：${value}`)
  return { col: SGF_COLUMNS.indexOf(value[0].toLowerCase()), row: SGF_COLUMNS.indexOf(value[1].toLowerCase()) }
}

function escapeSgf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}
