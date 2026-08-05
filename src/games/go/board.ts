import { GO_BOARD_SIZE, type GoBoard, type GoPlayer, type GoPoint } from './types'

export function createGoBoard(size = GO_BOARD_SIZE): GoBoard {
  if (!Number.isInteger(size) || size < 2) throw new Error('围棋棋盘尺寸必须是不小于 2 的整数。')
  return Array.from({ length: size }, () => Array<GoPlayer | null>(size).fill(null))
}

export function cloneGoBoard(board: GoBoard): GoBoard {
  return board.map((row) => [...row])
}

export function getBoardSize(board: GoBoard): number {
  return board.length
}

export function isOnGoBoard(board: GoBoard, point: GoPoint): boolean {
  const size = getBoardSize(board)
  return (
    Number.isInteger(point.row) &&
    Number.isInteger(point.col) &&
    point.row >= 0 &&
    point.row < size &&
    point.col >= 0 &&
    point.col < size
  )
}

export function getGoNeighbors(board: GoBoard, point: GoPoint): GoPoint[] {
  const candidates: GoPoint[] = [
    { row: point.row - 1, col: point.col },
    { row: point.row + 1, col: point.col },
    { row: point.row, col: point.col - 1 },
    { row: point.row, col: point.col + 1 },
  ]
  return candidates.filter((candidate) => isOnGoBoard(board, candidate))
}

export function oppositeGoPlayer(player: GoPlayer): GoPlayer {
  return player === 'black' ? 'white' : 'black'
}

export function pointsEqual(left: GoPoint, right: GoPoint): boolean {
  return left.row === right.row && left.col === right.col
}

export function pointKey(point: GoPoint): string {
  return `${point.row}:${point.col}`
}

/** Positional key used by the default positional-superko rule. */
export function goPositionKey(board: GoBoard): string {
  return board
    .map((row) => row.map((stone) => (stone === 'black' ? 'b' : stone === 'white' ? 'w' : '.')).join(''))
    .join('/')
}
