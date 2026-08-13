import type { ChessOpening } from './types'

/** Six-ply, deterministic, legal opening prefixes for spectator games. */
export const CHESS_OPENINGS: readonly ChessOpening[] = Object.freeze([
  { id: 'italian', name: '意大利开局', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'] },
  { id: 'ruy-lopez', name: '西班牙开局', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'] },
  { id: 'scotch', name: '苏格兰开局', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4'] },
  { id: 'sicilian', name: '西西里防御', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4'] },
  { id: 'french', name: '法兰西防御', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6'] },
  { id: 'caro-kann', name: '卡罗康防御', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4'] },
  { id: 'qgd', name: '后翼弃兵拒绝', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'] },
  { id: 'slav', name: '斯拉夫防御', moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6'] },
  { id: 'nimzo-indian', name: '尼姆佐印度防御', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'] },
  { id: 'kings-indian', name: '王印度防御', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7'] },
  { id: 'english', name: '英国式开局', moves: ['c2c4', 'e7e5', 'g1f3', 'b8c6', 'g2g3', 'f8b4'] },
  { id: 'reti', name: '列蒂开局', moves: ['g1f3', 'd7d5', 'c2c4', 'e7e6', 'g2g3', 'g8f6'] },
])

export function selectChessOpening(seed: number): ChessOpening {
  const normalized = Math.abs(Math.trunc(seed))
  return CHESS_OPENINGS[normalized % CHESS_OPENINGS.length]
}

export function createChessSeed(now = Date.now()): number {
  let value = Math.floor(now) >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

/** Preserves seed-based reproducibility while guaranteeing that the white personality flips. */
export function alternateChessSeed(previousSeed: number, candidateSeed: number): number {
  const normalized = candidateSeed >>> 0
  return ((normalized ^ previousSeed) & 1) === 1 ? normalized : (normalized ^ 1) >>> 0
}
