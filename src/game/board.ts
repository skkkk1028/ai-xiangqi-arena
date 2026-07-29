import type { BoardState, Color, Move, Piece, PieceType } from './types'

const makePiece = (color: Color, type: PieceType, index: number): Piece => ({
  id: `${color}-${type}-${index}`,
  color,
  type,
})

const homeRow: PieceType[] = [
  'chariot',
  'horse',
  'elephant',
  'advisor',
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
]

export function createEmptyBoard(): BoardState {
  return Array.from({ length: 10 }, () => Array<Piece | null>(9).fill(null))
}

export function createInitialBoard(): BoardState {
  const board = createEmptyBoard()

  homeRow.forEach((type, col) => {
    board[0][col] = makePiece('black', type, col)
    board[9][col] = makePiece('red', type, col)
  })

  board[2][1] = makePiece('black', 'cannon', 0)
  board[2][7] = makePiece('black', 'cannon', 1)
  board[7][1] = makePiece('red', 'cannon', 0)
  board[7][7] = makePiece('red', 'cannon', 1)

  ;[0, 2, 4, 6, 8].forEach((col, index) => {
    board[3][col] = makePiece('black', 'soldier', index)
    board[6][col] = makePiece('red', 'soldier', index)
  })

  return board
}

export function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => row.slice())
}

export function applyMove(board: BoardState, move: Move): BoardState {
  const next = cloneBoard(board)
  next[move.from.row][move.from.col] = null
  next[move.to.row][move.to.col] = move.piece
  return next
}

export function opposite(color: Color): Color {
  return color === 'red' ? 'black' : 'red'
}

const pieceCodes: Record<PieceType, string> = {
  general: 'g',
  advisor: 'a',
  elephant: 'e',
  horse: 'h',
  chariot: 'r',
  cannon: 'c',
  soldier: 's',
}

export function positionKey(board: BoardState, turn: Color): string {
  const cells = board
    .flat()
    .map((piece) => (piece ? `${piece.color[0]}${pieceCodes[piece.type]}` : '..'))
    .join('')
  return `${cells}:${turn}`
}

export function isInside(row: number, col: number): boolean {
  return row >= 0 && row < 10 && col >= 0 && col < 9
}
