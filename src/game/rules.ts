import { isInside } from './board'
import type { BoardState, Color, Move, Piece, Position } from './types'

function inPalace(color: Color, row: number, col: number): boolean {
  if (col < 3 || col > 5) return false
  return color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2
}

function pushIfAvailable(
  board: BoardState,
  moves: Move[],
  from: Position,
  to: Position,
  piece: Piece,
): boolean {
  if (!isInside(to.row, to.col)) return false
  const target = board[to.row][to.col]
  if (!target) {
    moves.push({ from, to, piece })
    return true
  }
  if (target.color !== piece.color) {
    moves.push({ from, to, piece, captured: target })
  }
  return false
}

export function getPseudoMovesForPiece(
  board: BoardState,
  row: number,
  col: number,
): Move[] {
  const piece = board[row]?.[col]
  if (!piece) return []

  const from = { row, col }
  const moves: Move[] = []

  if (piece.type === 'general') {
    const steps = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]
    for (const [dr, dc] of steps) {
      const to = { row: row + dr, col: col + dc }
      if (inPalace(piece.color, to.row, to.col)) {
        pushIfAvailable(board, moves, from, to, piece)
      }
    }

    const direction = piece.color === 'red' ? -1 : 1
    for (let targetRow = row + direction; isInside(targetRow, col); targetRow += direction) {
      const target = board[targetRow][col]
      if (!target) continue
      if (target.color !== piece.color && target.type === 'general') {
        moves.push({ from, to: { row: targetRow, col }, piece, captured: target })
      }
      break
    }
  }

  if (piece.type === 'advisor') {
    for (const [dr, dc] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const to = { row: row + dr, col: col + dc }
      if (inPalace(piece.color, to.row, to.col)) {
        pushIfAvailable(board, moves, from, to, piece)
      }
    }
  }

  if (piece.type === 'elephant') {
    for (const [dr, dc] of [
      [-2, -2],
      [-2, 2],
      [2, -2],
      [2, 2],
    ]) {
      const to = { row: row + dr, col: col + dc }
      if (!isInside(to.row, to.col)) continue
      const staysHome = piece.color === 'red' ? to.row >= 5 : to.row <= 4
      if (!staysHome || board[row + dr / 2][col + dc / 2]) continue
      pushIfAvailable(board, moves, from, to, piece)
    }
  }

  if (piece.type === 'horse') {
    const horseSteps = [
      { dr: -2, dc: -1, lr: -1, lc: 0 },
      { dr: -2, dc: 1, lr: -1, lc: 0 },
      { dr: 2, dc: -1, lr: 1, lc: 0 },
      { dr: 2, dc: 1, lr: 1, lc: 0 },
      { dr: -1, dc: -2, lr: 0, lc: -1 },
      { dr: 1, dc: -2, lr: 0, lc: -1 },
      { dr: -1, dc: 2, lr: 0, lc: 1 },
      { dr: 1, dc: 2, lr: 0, lc: 1 },
    ]
    for (const step of horseSteps) {
      if (board[row + step.lr]?.[col + step.lc]) continue
      pushIfAvailable(
        board,
        moves,
        from,
        { row: row + step.dr, col: col + step.dc },
        piece,
      )
    }
  }

  if (piece.type === 'chariot' || piece.type === 'cannon') {
    const directions = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]
    for (const [dr, dc] of directions) {
      let screened = false
      for (
        let targetRow = row + dr, targetCol = col + dc;
        isInside(targetRow, targetCol);
        targetRow += dr, targetCol += dc
      ) {
        const target = board[targetRow][targetCol]
        if (piece.type === 'chariot') {
          if (!pushIfAvailable(board, moves, from, { row: targetRow, col: targetCol }, piece)) {
            break
          }
          continue
        }

        if (!screened) {
          if (!target) {
            moves.push({ from, to: { row: targetRow, col: targetCol }, piece })
          } else {
            screened = true
          }
        } else if (target) {
          if (target.color !== piece.color) {
            moves.push({
              from,
              to: { row: targetRow, col: targetCol },
              piece,
              captured: target,
            })
          }
          break
        }
      }
    }
  }

  if (piece.type === 'soldier') {
    const forward = piece.color === 'red' ? -1 : 1
    pushIfAvailable(board, moves, from, { row: row + forward, col }, piece)
    const crossedRiver = piece.color === 'red' ? row <= 4 : row >= 5
    if (crossedRiver) {
      pushIfAvailable(board, moves, from, { row, col: col - 1 }, piece)
      pushIfAvailable(board, moves, from, { row, col: col + 1 }, piece)
    }
  }

  return moves
}

export function findGeneral(board: BoardState, color: Color): Position | null {
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (piece?.color === color && piece.type === 'general') return { row, col }
    }
  }
  return null
}

export function isInCheck(board: BoardState, color: Color): boolean {
  const general = findGeneral(board, color)
  if (!general) return true
  const enemy: Color = color === 'red' ? 'black' : 'red'

  // Rook, cannon and general attacks can be resolved by four rays from the king.
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    let blockers = 0
    let distance = 0
    for (
      let row = general.row + dr, col = general.col + dc;
      isInside(row, col);
      row += dr, col += dc
    ) {
      distance += 1
      const attacker = board[row][col]
      if (!attacker) continue
      if (blockers === 0) {
        if (attacker.color === enemy && attacker.type === 'chariot') return true
        if (
          attacker.color === enemy &&
          attacker.type === 'general' &&
          (distance === 1 || dc === 0)
        ) {
          return true
        }
        blockers = 1
      } else {
        if (attacker.color === enemy && attacker.type === 'cannon') return true
        break
      }
    }
  }

  const horseSteps = [
    { dr: -2, dc: -1, lr: -1, lc: 0 },
    { dr: -2, dc: 1, lr: -1, lc: 0 },
    { dr: 2, dc: -1, lr: 1, lc: 0 },
    { dr: 2, dc: 1, lr: 1, lc: 0 },
    { dr: -1, dc: -2, lr: 0, lc: -1 },
    { dr: 1, dc: -2, lr: 0, lc: -1 },
    { dr: -1, dc: 2, lr: 0, lc: 1 },
    { dr: 1, dc: 2, lr: 0, lc: 1 },
  ]
  for (const step of horseSteps) {
    const horseRow = general.row - step.dr
    const horseCol = general.col - step.dc
    const horse = board[horseRow]?.[horseCol]
    if (
      horse?.color === enemy &&
      horse.type === 'horse' &&
      !board[horseRow + step.lr]?.[horseCol + step.lc]
    ) {
      return true
    }
  }

  const enemyForward = enemy === 'red' ? -1 : 1
  const forwardSoldier = board[general.row - enemyForward]?.[general.col]
  if (forwardSoldier?.color === enemy && forwardSoldier.type === 'soldier') return true

  for (const soldierCol of [general.col - 1, general.col + 1]) {
    const soldier = board[general.row]?.[soldierCol]
    const crossedRiver =
      soldier?.color === 'red' ? general.row <= 4 : soldier?.color === 'black' && general.row >= 5
    if (soldier?.color === enemy && soldier.type === 'soldier' && crossedRiver) return true
  }

  return false
}

function leavesGeneralSafe(board: BoardState, color: Color, move: Move): boolean {
  const captured = board[move.to.row][move.to.col]
  board[move.from.row][move.from.col] = null
  board[move.to.row][move.to.col] = move.piece
  try {
    return !isInCheck(board, color)
  } finally {
    board[move.from.row][move.from.col] = move.piece
    board[move.to.row][move.to.col] = captured
  }
}

export function getLegalMoves(board: BoardState, color: Color): Move[] {
  const legal: Move[] = []
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (piece?.color !== color) continue
      for (const move of getPseudoMovesForPiece(board, row, col)) {
        if (move.captured?.type === 'general') continue
        if (leavesGeneralSafe(board, color, move)) legal.push(move)
      }
    }
  }
  return legal
}

export function getLegalCaptures(board: BoardState, color: Color): Move[] {
  const captures: Move[] = []
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (piece?.color !== color) continue
      for (const move of getPseudoMovesForPiece(board, row, col)) {
        if (!move.captured || move.captured.type === 'general') continue
        if (leavesGeneralSafe(board, color, move)) captures.push(move)
      }
    }
  }
  return captures
}

export function hasLegalMoves(board: BoardState, color: Color): boolean {
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (piece?.color !== color) continue
      for (const move of getPseudoMovesForPiece(board, row, col)) {
        if (move.captured?.type === 'general') continue
        if (leavesGeneralSafe(board, color, move)) return true
      }
    }
  }
  return false
}
