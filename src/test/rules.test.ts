import { describe, expect, it } from 'vitest'
import { applyMove, createEmptyBoard, createInitialBoard, positionKey } from '../game/board'
import {
  getSimplifiedDrawReason,
  isClockExpired,
  updateResignationStreak,
} from '../game/adjudication'
import {
  findGeneral,
  getLegalCaptures,
  getLegalMoves,
  getPseudoMovesForPiece,
  hasLegalMoves,
  isInCheck,
} from '../game/rules'
import type { BoardState, Color, Piece, PieceType } from '../game/types'

let id = 0
const piece = (color: Color, type: PieceType): Piece => ({
  id: `test-${id++}`,
  color,
  type,
})

function placeGenerals(board: BoardState) {
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
}

describe('中国象棋规则引擎', () => {
  it('初始局面为红方生成合法着法且不允许直接吃将', () => {
    const board = createInitialBoard()
    const moves = getLegalMoves(board, 'red')
    expect(moves.length).toBeGreaterThan(20)
    expect(moves.every((move) => move.captured?.type !== 'general')).toBe(true)
  })

  it('马腿被堵时排除对应的两条着法', () => {
    const board = createEmptyBoard()
    placeGenerals(board)
    board[5][4] = piece('red', 'horse')
    board[4][4] = piece('red', 'soldier')
    board[5][3] = piece('red', 'soldier')

    const moves = getPseudoMovesForPiece(board, 5, 4)
    expect(moves.some((move) => move.to.row === 3 && move.to.col === 3)).toBe(false)
    expect(moves.some((move) => move.to.row === 3 && move.to.col === 5)).toBe(false)
    expect(moves.some((move) => move.to.row === 4 && move.to.col === 2)).toBe(false)
    expect(moves.some((move) => move.to.row === 6 && move.to.col === 6)).toBe(true)
  })

  it('象不能过河且象眼受阻时不能走', () => {
    const board = createEmptyBoard()
    placeGenerals(board)
    board[5][2] = piece('red', 'elephant')
    board[6][3] = piece('red', 'soldier')

    const moves = getPseudoMovesForPiece(board, 5, 2)
    expect(moves.every((move) => move.to.row >= 5)).toBe(true)
    expect(moves.some((move) => move.to.row === 7 && move.to.col === 4)).toBe(false)
  })

  it('炮必须隔一个炮架才能吃子', () => {
    const board = createEmptyBoard()
    placeGenerals(board)
    board[7][1] = piece('red', 'cannon')
    board[5][1] = piece('red', 'soldier')
    board[2][1] = piece('black', 'horse')
    board[1][1] = piece('black', 'chariot')

    const moves = getPseudoMovesForPiece(board, 7, 1)
    expect(moves.some((move) => move.to.row === 2 && move.to.col === 1 && move.captured)).toBe(true)
    expect(moves.some((move) => move.to.row === 1 && move.to.col === 1)).toBe(false)
  })

  it('将帅照面时双方均处于被将军状态', () => {
    const board = createEmptyBoard()
    placeGenerals(board)
    expect(isInCheck(board, 'red')).toBe(true)
    expect(isInCheck(board, 'black')).toBe(true)
  })

  it('禁止移动唯一遮挡子从而形成将帅照面', () => {
    const board = createEmptyBoard()
    placeGenerals(board)
    board[5][4] = piece('red', 'chariot')
    const moves = getLegalMoves(board, 'red').filter((move) => move.piece.type === 'chariot')
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((move) => move.to.col === 4)).toBe(true)
  })

  it('正确区分将死与困毙', () => {
    const checkmate = createEmptyBoard()
    placeGenerals(checkmate)
    checkmate[1][3] = piece('red', 'chariot')
    checkmate[1][4] = piece('red', 'chariot')
    checkmate[1][5] = piece('red', 'chariot')
    expect(isInCheck(checkmate, 'black')).toBe(true)
    expect(getLegalMoves(checkmate, 'black')).toHaveLength(0)

    const stalemate = createEmptyBoard()
    placeGenerals(stalemate)
    stalemate[1][3] = piece('red', 'chariot')
    stalemate[1][5] = piece('red', 'chariot')
    stalemate[5][4] = piece('red', 'soldier')
    expect(isInCheck(stalemate, 'black')).toBe(false)
    expect(getLegalMoves(stalemate, 'black')).toHaveLength(0)
  })

  it('应用着法时返回新棋盘而不修改原局面', () => {
    const board = createInitialBoard()
    const move = getLegalMoves(board, 'red')[0]
    const next = applyMove(board, move)
    expect(board[move.from.row][move.from.col]).toEqual(move.piece)
    expect(next[move.from.row][move.from.col]).toBeNull()
    expect(next[move.to.row][move.to.col]).toEqual(move.piece)
  })

  it('按总时钟和单步时钟分别判定超时', () => {
    expect(isClockExpired({ red: 0, black: 600_000, turn: 2_000 }, 'red')).toBe(true)
    expect(isClockExpired({ red: 500_000, black: 600_000, turn: 60_000 }, 'red')).toBe(true)
    expect(isClockExpired({ red: 500_000, black: 600_000, turn: 59_999 }, 'red')).toBe(false)
  })

  it('连续三次严重劣势后自动认输且和棋规则有固定优先级', () => {
    let streak = 0
    streak = updateResignationStreak(streak, 40, -1800)
    streak = updateResignationStreak(streak, 42, -1900)
    streak = updateResignationStreak(streak, 44, -2200)
    expect(streak).toBe(3)
    expect(updateResignationStreak(streak, 46, -500)).toBe(0)
    expect(getSimplifiedDrawReason(3, 120)).toBe('repetition')
    expect(getSimplifiedDrawReason(2, 120)).toBe('no-capture')
    expect(getSimplifiedDrawReason(2, 119)).toBeNull()
  })
})

function referenceIsInCheck(board: BoardState, color: Color): boolean {
  const general = findGeneral(board, color)
  if (!general) return true
  const enemy = color === 'red' ? 'black' : 'red'
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (board[row][col]?.color !== enemy) continue
      if (
        getPseudoMovesForPiece(board, row, col).some(
          (move) => move.to.row === general.row && move.to.col === general.col,
        )
      ) {
        return true
      }
    }
  }
  return false
}

describe('optimized attack and move generation regressions', () => {
  it('matches the reference attack detector across a deterministic legal playout', () => {
    let board = createInitialBoard()
    let side: Color = 'red'

    for (let ply = 0; ply < 36; ply += 1) {
      expect(isInCheck(board, 'red')).toBe(referenceIsInCheck(board, 'red'))
      expect(isInCheck(board, 'black')).toBe(referenceIsInCheck(board, 'black'))
      const moves = getLegalMoves(board, side)
      expect(moves.length).toBeGreaterThan(0)
      board = applyMove(board, moves[(ply * 17 + 5) % moves.length])
      side = side === 'red' ? 'black' : 'red'
    }
  })

  it('handles cannon screens, horse legs and crossed-river soldier attacks', () => {
    const cannon = createEmptyBoard()
    cannon[0][3] = piece('black', 'general')
    cannon[9][4] = piece('red', 'general')
    cannon[5][4] = piece('black', 'cannon')
    cannon[7][4] = piece('red', 'soldier')
    expect(isInCheck(cannon, 'red')).toBe(true)
    cannon[6][4] = piece('red', 'advisor')
    expect(isInCheck(cannon, 'red')).toBe(false)

    const horse = createEmptyBoard()
    horse[0][3] = piece('black', 'general')
    horse[9][4] = piece('red', 'general')
    horse[7][3] = piece('black', 'horse')
    expect(isInCheck(horse, 'red')).toBe(true)
    horse[8][3] = piece('red', 'advisor')
    expect(isInCheck(horse, 'red')).toBe(false)

    const soldier = createEmptyBoard()
    soldier[0][3] = piece('black', 'general')
    soldier[9][4] = piece('red', 'general')
    soldier[9][3] = piece('black', 'soldier')
    expect(isInCheck(soldier, 'red')).toBe(true)
  })

  it('does not mutate the board while generating legal moves', () => {
    const board = createInitialBoard()
    const before = positionKey(board, 'red')
    isInCheck(board, 'red')
    getLegalMoves(board, 'red')
    getLegalCaptures(board, 'red')
    hasLegalMoves(board, 'red')
    expect(positionKey(board, 'red')).toBe(before)
  })
})
