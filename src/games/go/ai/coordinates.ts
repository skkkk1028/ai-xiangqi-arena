import { GO_PASS_MOVE, isGoPassMove, type GoMove, type GoMoveRecord, type GoPoint } from '../types'
import type { KataGoMoveTuple } from './types'

const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRST'

export function goPointToGtp(point: GoPoint, boardSize = 19): string {
  assertBoardSize(boardSize)
  const column = GTP_COLUMNS[point.col]
  if (!column || !Number.isInteger(point.row) || point.row < 0 || point.row >= boardSize) {
    throw new Error('围棋坐标超出棋盘范围。')
  }
  return `${column}${boardSize - point.row}`
}

export function goMoveToGtp(move: GoMove, boardSize = 19): string {
  return isGoPassMove(move) ? 'pass' : goPointToGtp(move, boardSize)
}

export function gtpToGoMove(value: string, boardSize = 19): GoMove {
  assertBoardSize(boardSize)
  const normalized = value.trim().toUpperCase()
  if (normalized === 'PASS') return GO_PASS_MOVE

  const match = /^([A-HJ-T])(\d{1,2})$/.exec(normalized)
  if (!match) throw new Error(`KataGo 返回了无效坐标：${value}`)
  const col = GTP_COLUMNS.indexOf(match[1])
  const number = Number(match[2])
  const row = boardSize - number
  if (col < 0 || col >= boardSize || row < 0 || row >= boardSize) {
    throw new Error(`KataGo 返回了越界坐标：${value}`)
  }
  return { row, col }
}

export function goRecordToKataGoTuple(record: GoMoveRecord, boardSize = 19): KataGoMoveTuple {
  const color = record.color === 'black' ? 'B' : 'W'
  if (record.kind === 'pass') return [color, 'pass']
  if (!record.point) throw new Error(`第 ${record.moveNumber} 手棋谱缺少落点。`)
  return [color, goPointToGtp(record.point, boardSize)]
}

function assertBoardSize(boardSize: number): void {
  if (boardSize !== 19) throw new Error('KataGo 首版仅支持十九路棋盘。')
}
