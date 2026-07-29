import { describe, expect, it } from 'vitest'
import { applyMove, createEmptyBoard, createInitialBoard } from '../game/board'
import { getLegalMoves, isInCheck } from '../game/rules'
import type { Color, Piece, PieceType } from '../game/types'
import { searchBestMove } from '../ai/search'

let id = 0
const piece = (color: Color, type: PieceType): Piece => ({
  id: `ai-test-${id++}`,
  color,
  type,
})

describe('浏览器 AI', () => {
  it('固定种子在固定深度返回可复现的合法着法', () => {
    const board = createInitialBoard()
    const first = searchBestMove(board, 'red', 5_000, 20260729, 1)
    const second = searchBestMove(board, 'red', 5_000, 20260729, 1)
    const legal = getLegalMoves(board, 'red')

    expect(first.move).not.toBeNull()
    expect(second.move).toEqual(first.move)
    expect(legal).toContainEqual(first.move)
    expect(first.depth).toBe(1)
  })

  it('能找到预设局面中的一步将死', () => {
    const board = createEmptyBoard()
    board[0][4] = piece('black', 'general')
    board[9][4] = piece('red', 'general')
    board[1][3] = piece('red', 'chariot')
    board[1][5] = piece('red', 'chariot')
    board[2][4] = piece('red', 'soldier')

    const result = searchBestMove(board, 'red', 5_000, 7, 2)
    expect(result.move).not.toBeNull()
    const matedBoard = applyMove(board, result.move!)
    expect(isInCheck(matedBoard, 'black')).toBe(true)
    expect(getLegalMoves(matedBoard, 'black')).toHaveLength(0)
    expect(result.score).toBeGreaterThan(90_000)
  })
})
