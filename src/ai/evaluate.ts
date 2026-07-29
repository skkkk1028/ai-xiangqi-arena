import { isInCheck, getPseudoMovesForPiece } from '../game/rules'
import type { BoardState, Color, PieceType } from '../game/types'

export const PIECE_VALUES: Record<PieceType, number> = {
  general: 20_000,
  chariot: 900,
  cannon: 450,
  horse: 420,
  elephant: 210,
  advisor: 210,
  soldier: 100,
}

function positionalValue(type: PieceType, color: Color, row: number, col: number): number {
  const advance = color === 'red' ? 9 - row : row
  const center = 4 - Math.abs(4 - col)

  if (type === 'soldier') {
    const crossed = color === 'red' ? row <= 4 : row >= 5
    return advance * 9 + (crossed ? 55 + center * 8 : 0)
  }
  if (type === 'horse') return center * 8 + (row > 1 && row < 8 ? 10 : 0)
  if (type === 'cannon') return center * 5
  if (type === 'chariot') return center * 2
  if (type === 'general') return -advance * 2
  return 0
}

export function evaluateBoard(board: BoardState): number {
  let score = 0
  let redMobility = 0
  let blackMobility = 0

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (!piece) continue
      const value = PIECE_VALUES[piece.type] + positionalValue(piece.type, piece.color, row, col)
      const mobility = getPseudoMovesForPiece(board, row, col).length
      if (piece.color === 'red') {
        score += value
        redMobility += mobility
      } else {
        score -= value
        blackMobility += mobility
      }
    }
  }

  score += (redMobility - blackMobility) * 2
  if (isInCheck(board, 'red')) score -= 75
  if (isInCheck(board, 'black')) score += 75
  return score
}

export function evaluateFor(board: BoardState, color: Color): number {
  const redScore = evaluateBoard(board)
  return color === 'red' ? redScore : -redScore
}
