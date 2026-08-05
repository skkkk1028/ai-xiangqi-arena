import { describe, expect, it } from 'vitest'
import { selectSearchMultiPv } from '../engine/search-policy'
import { createEmptyBoard, createInitialBoard } from '../game/board'
import type { BoardState, Color, Piece, PieceType } from '../game/types'

describe('动态 MultiPV 策略', () => {
  it('桌面资源下按开局4、中局3、残局2切换', () => {
    const board = createInitialBoard()
    expect(decide(board, 'red', 4).multiPv).toBe(4)
    expect(decide(board, 'red', 20).multiPv).toBe(3)
    expect(decide(endgamePosition(), 'red', 40)).toEqual({ multiPv: 2, reason: 'endgame' })
  })

  it('资源受限、低时间和战术重负局面优先使用2主变', () => {
    const board = createInitialBoard()
    expect(decide(board, 'red', 4, { threads: 1 }).reason).toBe('resource-constrained')
    expect(decide(board, 'red', 4, { hashMb: 64 }).reason).toBe('resource-constrained')
    expect(decide(board, 'red', 4, { remainingTimeMs: 30_000 }).reason).toBe('low-time')
    expect(decide(board, 'red', 4, { turnBudgetMs: 4_000 }).reason).toBe('performance-constrained')
    expect(decide(tacticalPosition(), 'red', 4).reason).toBe('tactical-complexity')
  })

  it('开局、低时间与搜索预算边界无歧义', () => {
    const board = createInitialBoard()
    expect(decide(board, 'red', 15).multiPv).toBe(4)
    expect(decide(board, 'red', 16).multiPv).toBe(3)
    expect(decide(board, 'red', 4, { remainingTimeMs: 44_999 }).multiPv).toBe(2)
    expect(decide(board, 'red', 4, { remainingTimeMs: 45_000 }).multiPv).toBe(4)
    expect(decide(board, 'red', 4, { turnBudgetMs: 4_999 }).multiPv).toBe(2)
    expect(decide(board, 'red', 4, { turnBudgetMs: 5_000 }).multiPv).toBe(4)
  })

  it('相同输入始终得到相同主变数量，且只返回2/3/4', () => {
    const first = decide(createInitialBoard(), 'red', 8)
    const second = decide(createInitialBoard(), 'red', 8)
    expect(first).toEqual(second)
    expect([2, 3, 4]).toContain(first.multiPv)
  })
})

function decide(
  board: BoardState,
  color: Color,
  historyLength: number,
  overrides: Partial<Parameters<typeof selectSearchMultiPv>[0]> = {},
) {
  return selectSearchMultiPv({
    board,
    color,
    historyLength,
    threads: 2,
    hashMb: 128,
    remainingTimeMs: 600_000,
    turnBudgetMs: 15_000,
    ...overrides,
  })
}

let id = 0
function piece(color: Color, type: PieceType): Piece {
  return { id: `search-policy-${id++}`, color, type }
}

function endgamePosition(): BoardState {
  const board = createEmptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[7][0] = piece('red', 'chariot')
  board[2][8] = piece('black', 'chariot')
  return board
}

function tacticalPosition(): BoardState {
  const board = createInitialBoard()
  for (const col of [0, 2, 4, 6, 8]) board[5][col] = piece('black', 'soldier')
  return board
}
