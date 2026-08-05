import {
  GO_BOARD_SIZE,
  isGoPassMove,
  type GoMove,
  type GoMoveRecord,
  type GoPlayer,
  type GoPoint,
} from './types'

const GO_COLUMNS = 'ABCDEFGHJKLMNOPQRST'

export function formatGoPoint(point: GoPoint, size = GO_BOARD_SIZE): string {
  const column = GO_COLUMNS[point.col]
  if (!column || point.row < 0 || point.row >= size) throw new Error('围棋坐标超出棋盘范围。')
  return `${column}${size - point.row}`
}

export function createGoMoveRecord(
  moveNumber: number,
  color: GoPlayer,
  move: GoMove,
  captures: readonly GoPoint[],
  boardSize = GO_BOARD_SIZE,
): GoMoveRecord {
  if (isGoPassMove(move)) {
    return {
      moveNumber,
      color,
      kind: 'pass',
      point: null,
      notation: 'pass',
      captures: [],
    }
  }
  return {
    moveNumber,
    color,
    kind: 'play',
    point: { row: move.row, col: move.col },
    notation: formatGoPoint(move, boardSize),
    captures: captures.map((point) => ({ ...point })),
  }
}
