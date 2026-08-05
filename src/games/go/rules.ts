import {
  cloneGoBoard,
  getGoNeighbors,
  isOnGoBoard,
  oppositeGoPlayer,
  pointKey,
} from './board'
import type { GoBoard, GoGroup, GoMoveOutcome, GoPlacementMove, GoPlayer, GoPoint } from './types'

export function getGoGroup(board: GoBoard, start: GoPoint): GoGroup | null {
  if (!isOnGoBoard(board, start)) return null
  const color = board[start.row][start.col]
  if (!color) return null

  const visited = new Set<string>()
  const liberties = new Map<string, GoPoint>()
  const stones: GoPoint[] = []
  const pending: GoPoint[] = [start]

  while (pending.length > 0) {
    const point = pending.pop()!
    const key = pointKey(point)
    if (visited.has(key)) continue
    visited.add(key)
    stones.push(point)

    for (const neighbor of getGoNeighbors(board, point)) {
      const stone = board[neighbor.row][neighbor.col]
      if (stone === null) {
        liberties.set(pointKey(neighbor), neighbor)
      } else if (stone === color && !visited.has(pointKey(neighbor))) {
        pending.push(neighbor)
      }
    }
  }

  return { color, stones, liberties: [...liberties.values()] }
}

export function countLiberties(board: GoBoard, point: GoPoint): number {
  return getGoGroup(board, point)?.liberties.length ?? 0
}

/**
 * Returns a new board after a legal placement. Null represents an occupied,
 * off-board or suicide move. Ko and historical-position checks belong to
 * GoGameEngine because they require game history in addition to the board.
 */
export function tryPlayGoMove(
  board: GoBoard,
  move: GoPlacementMove,
  player: GoPlayer,
): GoMoveOutcome | null {
  if (!isOnGoBoard(board, move) || board[move.row][move.col] !== null) return null

  const nextBoard = cloneGoBoard(board)
  nextBoard[move.row][move.col] = player
  const captured: GoPoint[] = []
  const inspectedGroups = new Set<string>()

  for (const neighbor of getGoNeighbors(nextBoard, move)) {
    if (nextBoard[neighbor.row][neighbor.col] !== oppositeGoPlayer(player)) continue
    const group = getGoGroup(nextBoard, neighbor)
    if (!group || group.liberties.length > 0) continue
    const groupKey = pointKey(group.stones[0])
    if (inspectedGroups.has(groupKey)) continue
    inspectedGroups.add(groupKey)
    for (const stone of group.stones) {
      nextBoard[stone.row][stone.col] = null
      captured.push(stone)
    }
  }

  if (countLiberties(nextBoard, move) === 0) return null
  return { board: nextBoard, captures: captured }
}

export function isLegalGoMove(board: GoBoard, move: GoPlacementMove, player: GoPlayer): boolean {
  return tryPlayGoMove(board, move, player) !== null
}

export function getLegalGoMoves(board: GoBoard, player: GoPlayer): GoPlacementMove[] {
  const legalMoves: GoPlacementMove[] = []
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      const move = { row, col }
      if (isLegalGoMove(board, move, player)) legalMoves.push(move)
    }
  }
  return legalMoves
}
