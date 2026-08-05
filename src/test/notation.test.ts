import { describe, expect, it } from 'vitest'
import { createInitialBoard } from '../game/board'
import { formatMove } from '../game/notation'
import { getLegalMoves } from '../game/rules'
import type { Color } from '../game/types'

function legalMove(
  color: Color,
  from: readonly [row: number, col: number],
  to: readonly [row: number, col: number],
) {
  const board = createInitialBoard()
  const move = getLegalMoves(board, color).find(
    (candidate) =>
      candidate.from.row === from[0] &&
      candidate.from.col === from[1] &&
      candidate.to.row === to[0] &&
      candidate.to.col === to[1],
  )
  if (!move) throw new Error(`测试着法不存在：${color} ${from.join(',')} -> ${to.join(',')}`)
  return move
}

describe('中文棋谱纵线方向', () => {
  it('红方从棋盘右向左按一至九编号', () => {
    expect(formatMove(legalMove('red', [9, 7], [7, 6]))).toBe('马二进三')
    expect(formatMove(legalMove('red', [9, 0], [8, 0]))).toBe('车九进一')
  })

  it('黑方从棋盘左向右按一至九编号，与红方对称', () => {
    expect(formatMove(legalMove('black', [0, 1], [2, 2]))).toBe('马二进三')
    expect(formatMove(legalMove('black', [0, 8], [1, 8]))).toBe('车九进一')
  })
})
