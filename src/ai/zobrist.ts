import type { BoardState, Color, Move, Piece, PieceType } from '../game/types'

const mask = (1n << 64n) - 1n
// SplitMix64: fixed seed makes benchmarks reproducible; every key uses all 64 bits.
let seed = 0x7f4a7c1594d049bbn
function random64(): bigint {
  seed = (seed + 0x9e3779b97f4a7c15n) & mask
  let value = seed
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask
  return (value ^ (value >> 31n)) & mask
}
const indices: Record<PieceType, number> = { general: 0, advisor: 1, elephant: 2, horse: 3, chariot: 4, cannon: 5, soldier: 6 }
const keys = Array.from({ length: 14 * 90 }, random64)
const sideKey = random64()
function pieceKey(piece: Piece, row: number, col: number): bigint {
  return keys[(indices[piece.type] + (piece.color === 'black' ? 7 : 0)) * 90 + row * 9 + col]
}
export function hashPosition(board: BoardState, side: Color): bigint {
  let hash = side === 'black' ? sideKey : 0n
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const piece = board[row][col]
    if (piece) hash ^= pieceKey(piece, row, col)
  }
  return hash
}
export function hashAfterMove(hash: bigint, move: Move, captured: Piece | null): bigint {
  return hash ^ pieceKey(move.piece, move.from.row, move.from.col)
    ^ pieceKey(move.piece, move.to.row, move.to.col) ^ sideKey
    ^ (captured ? pieceKey(captured, move.to.row, move.to.col) : 0n)
}
