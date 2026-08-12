import { GoGameEngine } from './game-engine'
import { GO_PASS_MOVE, type GoGameState, type GoMove } from './types'
import type { MatchArchiveV1 } from '../core'
import { parseMatchArchive } from '../core'
import { gtpToGoMove } from './ai/coordinates'

const SGF_COLUMNS = 'abcdefghijklmnopqrs'

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
  if (!/^\s*\(.*\)\s*$/s.test(source)) throw new Error('SGF 必须包含一个完整棋谱树。')
  if (!/GM\[1\]/i.test(source) || !/SZ\[19\]/i.test(source)) {
    throw new Error('当前只支持十九路围棋 SGF。')
  }
  if (/[;)]\s*\(/.test(source.replace(/^\s*\(/, ''))) {
    throw new Error('当前只支持不含分支的 SGF 主线。')
  }
  const engine = new GoGameEngine()
  let state = engine.init()
  const pattern = /;\s*([BW])\[([^\]]*)\]/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const expected = match[1].toUpperCase() === 'B' ? 'black' : 'white'
    if (state.turn !== expected) throw new Error(`SGF 第 ${state.history.length + 1} 手执子顺序无效。`)
    state = engine.applyMove(state, sgfPoint(match[2]))
  }
  return state
}

export function createGoArchive(state: GoGameState, now = new Date()): MatchArchiveV1<'go'> {
  const timestamp = now.toISOString()
  return {
    version: 1,
    game: 'go',
    ruleset: 'chinese-area-19-psk-komi-7.5',
    createdAt: timestamp,
    updatedAt: timestamp,
    status: state.phase === 'scoring' ? 'review' : state.phase,
    players: [
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
    } : null,
    metadata: { komi: 7.5, boardSize: 19, repetition: 'positional-superko' },
  }
}

export function restoreGoArchive(value: string | unknown): GoGameState {
  const archive = parseMatchArchive(value)
  if (archive.game !== 'go') throw new Error('该档案不是围棋棋局。')
  const engine = new GoGameEngine()
  let state = engine.init()
  for (const [index, encoded] of archive.moves.entries()) {
    const match = /^([BW]):(.+)$/.exec(encoded)
    if (!match) throw new Error(`围棋档案第 ${index + 1} 手格式无效。`)
    const expected = match[1] === 'B' ? 'black' : 'white'
    if (state.turn !== expected) throw new Error(`围棋档案第 ${index + 1} 手执子顺序无效。`)
    state = engine.applyMove(state, gtpToGoMove(match[2]))
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
