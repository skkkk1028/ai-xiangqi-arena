import { describe, expect, it } from 'vitest'
import { applyMove, createEmptyBoard, createInitialBoard, positionKey } from '../game/board'
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

describe('stronger search regressions', () => {
  it('always takes a free chariot instead of randomizing into an inferior move', () => {
    const board = createEmptyBoard()
    board[0][4] = piece('black', 'general')
    board[9][4] = piece('red', 'general')
    board[4][4] = piece('red', 'soldier')
    board[5][0] = piece('red', 'chariot')
    board[5][8] = piece('black', 'chariot')

    for (const seed of [1, 2, 3, 7, 99]) {
      const result = searchBestMove(board, 'red', 5_000, seed, 1)
      expect(result.move?.from).toEqual({ row: 5, col: 0 })
      expect(result.move?.to).toEqual({ row: 5, col: 8 })
    }
  })

  it('honors a short search deadline and still returns a legal move', () => {
    const board = createInitialBoard()
    const before = positionKey(board, 'red')
    const result = searchBestMove(board, 'red', 30, 1234, 12)
    expect(result.move).not.toBeNull()
    expect(getLegalMoves(board, 'red')).toContainEqual(result.move)
    expect(result.elapsedMs).toBeLessThan(1_000)
    expect(positionKey(board, 'red')).toBe(before)
  })

  it('returns null when the side to move has no legal response', () => {
    const board = createEmptyBoard()
    board[0][4] = piece('black', 'general')
    board[9][4] = piece('red', 'general')
    board[1][3] = piece('red', 'chariot')
    board[1][4] = piece('red', 'chariot')
    board[1][5] = piece('red', 'chariot')

    const result = searchBestMove(board, 'black', 1_000, 11, 4)
    expect(result.move).toBeNull()
  })
})
