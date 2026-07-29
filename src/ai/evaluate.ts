import { isInside } from '../game/board'
import { isInCheck } from '../game/rules'
import type { BoardState, Color, PieceType } from '../game/types'

export const PIECE_VALUES: Record<PieceType, number> = {
  general: 20_000,
  chariot: 1_000,
  cannon: 500,
  horse: 460,
  elephant: 220,
  advisor: 220,
  soldier: 110,
}

function advanceOf(color: Color, row: number): number {
  return color === 'red' ? 9 - row : row
}

function positionalValue(type: PieceType, color: Color, row: number, col: number): number {
  const advance = advanceOf(color, row)
  const center = 4 - Math.abs(4 - col)

  if (type === 'soldier') {
    const crossed = color === 'red' ? row <= 4 : row >= 5
    return advance * 10 + (crossed ? 70 + center * 11 : 0)
  }

  if (type === 'horse') {
    const edgePenalty = col === 0 || col === 8 ? 28 : 0
    const undeveloped = color === 'red' ? row === 9 : row === 0
    return center * 13 + (row > 1 && row < 8 ? 18 : 0) - edgePenalty - (undeveloped ? 18 : 0)
  }

  if (type === 'cannon') {
    const undeveloped = color === 'red' ? row === 7 : row === 2
    return center * 7 - (undeveloped ? 8 : 0)
  }

  if (type === 'chariot') {
    const trappedAtCorner = (color === 'red' ? row === 9 : row === 0) && (col === 0 || col === 8)
    return center * 3 - (trappedAtCorner ? 20 : 0)
  }

  if (type === 'general') {
    const homeDistance = color === 'red' ? 9 - row : row
    return -(homeDistance * 16 + Math.abs(4 - col) * 9)
  }

  return center * 2
}

function lineMobility(board: BoardState, row: number, col: number, cannon: boolean): number {
  let mobility = 0
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    let screened = false
    for (
      let targetRow = row + dr, targetCol = col + dc;
      isInside(targetRow, targetCol);
      targetRow += dr, targetCol += dc
    ) {
      const target = board[targetRow][targetCol]
      if (!cannon) {
        mobility += 1
        if (target) break
      } else if (!screened) {
        if (target) screened = true
        else mobility += 1
      } else if (target) {
        mobility += 1
        break
      }
    }
  }
  return mobility
}

function horseMobility(board: BoardState, row: number, col: number): number {
  let mobility = 0
  const steps = [
    { dr: -2, dc: -1, lr: -1, lc: 0 },
    { dr: -2, dc: 1, lr: -1, lc: 0 },
    { dr: 2, dc: -1, lr: 1, lc: 0 },
    { dr: 2, dc: 1, lr: 1, lc: 0 },
    { dr: -1, dc: -2, lr: 0, lc: -1 },
    { dr: 1, dc: -2, lr: 0, lc: -1 },
    { dr: -1, dc: 2, lr: 0, lc: 1 },
    { dr: 1, dc: 2, lr: 0, lc: 1 },
  ]
  for (const step of steps) {
    if (
      isInside(row + step.dr, col + step.dc) &&
      !board[row + step.lr]?.[col + step.lc]
    ) {
      mobility += 1
    }
  }
  return mobility
}

function kingShelter(
  color: Color,
  advisors: number,
  elephants: number,
  general: { row: number; col: number } | null,
): number {
  if (!general) return -20_000
  const homeRow = color === 'red' ? 9 : 0
  const backRankSafety = Math.abs(general.row - homeRow) * 24
  const centerSafety = Math.abs(general.col - 4) * 10
  return advisors * 34 + elephants * 24 - backRankSafety - centerSafety
}

export function evaluateBoard(board: BoardState): number {
  let score = 0
  const advisors: Record<Color, number> = { red: 0, black: 0 }
  const elephants: Record<Color, number> = { red: 0, black: 0 }
  const generals: Record<Color, { row: number; col: number } | null> = {
    red: null,
    black: null,
  }

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (!piece) continue

      let value = PIECE_VALUES[piece.type] + positionalValue(piece.type, piece.color, row, col)
      if (piece.type === 'chariot') value += lineMobility(board, row, col, false) * 4
      if (piece.type === 'cannon') value += lineMobility(board, row, col, true) * 3
      if (piece.type === 'horse') value += horseMobility(board, row, col) * 6

      if (piece.type === 'soldier') {
        const left = board[row][col - 1]
        const right = board[row][col + 1]
        if (left?.color === piece.color && left.type === 'soldier') value += 12
        if (right?.color === piece.color && right.type === 'soldier') value += 12
      }

      if (piece.type === 'advisor') advisors[piece.color] += 1
      if (piece.type === 'elephant') elephants[piece.color] += 1
      if (piece.type === 'general') generals[piece.color] = { row, col }

      score += piece.color === 'red' ? value : -value
    }
  }

  score += kingShelter('red', advisors.red, elephants.red, generals.red)
  score -= kingShelter('black', advisors.black, elephants.black, generals.black)
  if (isInCheck(board, 'red')) score -= 120
  if (isInCheck(board, 'black')) score += 120
  return score
}

export function evaluateFor(board: BoardState, color: Color): number {
  const redScore = evaluateBoard(board)
  return (color === 'red' ? redScore : -redScore) + 10
}
