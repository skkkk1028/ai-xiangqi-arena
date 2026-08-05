import { applyMove, createInitialBoard, opposite, positionKey } from '../../game/board'
import { getSimplifiedDrawReason } from '../../game/adjudication'
import { formatMove } from '../../game/notation'
import { getLegalMoves, isInCheck } from '../../game/rules'
import type { BoardState, Color, GameResult, Move } from '../../game/types'
import { matchUcciMove, moveToUcci } from '../../engine/ucci'
import type { GameEngine, GameStatus } from '../core'

export interface XiangqiRecordEntry extends Move {
  notation: string
  ucci: string
  ply: number
}

export interface XiangqiGameState {
  board: BoardState
  turn: Color
  history: readonly XiangqiRecordEntry[]
  lastMove: Move | null
  checkColor: Color | null
  result: GameResult | null
  noCapturePlies: number
  repetitions: ReadonlyMap<string, number>
}

function movesEqual(left: Move, right: Move): boolean {
  return (
    left.from.row === right.from.row &&
    left.from.col === right.from.col &&
    left.to.row === right.to.row &&
    left.to.col === right.to.col
  )
}

/**
 * Platform adapter for the existing Xiangqi rules.
 *
 * It deliberately reuses src/game instead of moving those stable files in one
 * large refactor. Production React flows reach those functions only through
 * this adapter and GameController.
 */
export class XiangqiGameEngine
  implements GameEngine<XiangqiGameState, Move, Color, XiangqiRecordEntry>
{
  readonly id = 'xiangqi'
  readonly name = '中国象棋'

  initializeGame(): XiangqiGameState {
    const board = createInitialBoard()
    return {
      board,
      turn: 'red',
      history: [],
      lastMove: null,
      checkColor: null,
      result: null,
      noCapturePlies: 0,
      repetitions: new Map([[positionKey(board, 'red'), 1]]),
    }
  }

  getCurrentPlayer(state: XiangqiGameState): Color {
    return state.turn
  }

  getLegalActions(state: XiangqiGameState): readonly Move[] {
    return state.result ? [] : getLegalMoves(state.board, state.turn)
  }

  actionsEqual(left: Move, right: Move): boolean {
    return movesEqual(left, right)
  }

  findLegalActionByUcci(state: XiangqiGameState, text: string): Move | null {
    const legalActions = this.getLegalActions(state)
    return matchUcciMove(state.board, [...legalActions], text)
  }

  executeAction(state: XiangqiGameState, requestedMove: Move): XiangqiGameState {
    if (state.result) throw new Error('象棋对局已经结束。')
    const move = getLegalMoves(state.board, state.turn).find((candidate) =>
      movesEqual(candidate, requestedMove),
    )
    if (!move) throw new Error('象棋着法不合法。')

    const nextBoard = applyMove(state.board, move)
    const nextTurn = opposite(state.turn)
    const checked = isInCheck(nextBoard, nextTurn)
    const legalReplies = getLegalMoves(nextBoard, nextTurn)
    const noCapturePlies = move.captured ? 0 : state.noCapturePlies + 1
    const repetitions = new Map(state.repetitions)
    const key = positionKey(nextBoard, nextTurn)
    const repetitionCount = (repetitions.get(key) ?? 0) + 1
    repetitions.set(key, repetitionCount)

    let result: GameResult | null = null
    if (legalReplies.length === 0) {
      result = {
        winner: state.turn,
        loser: nextTurn,
        reason: checked ? 'checkmate' : 'stalemate',
      }
    }
    const drawReason = getSimplifiedDrawReason(repetitionCount, noCapturePlies)
    if (!result && drawReason) result = { winner: null, loser: null, reason: drawReason }

    const record: XiangqiRecordEntry = {
      ...move,
      notation: formatMove(move),
      ucci: moveToUcci(move),
      ply: state.history.length + 1,
    }
    return {
      board: nextBoard,
      turn: nextTurn,
      history: [...state.history, record],
      lastMove: move,
      checkColor: checked ? nextTurn : null,
      result,
      noCapturePlies,
      repetitions,
    }
  }

  isFinished(state: XiangqiGameState): boolean {
    return state.result !== null
  }

  getStatus(state: XiangqiGameState): GameStatus<Color> {
    if (!state.result) return { phase: 'playing', currentPlayer: state.turn }
    return {
      phase: 'finished',
      winner: state.result.winner,
      reason: state.result.reason,
    }
  }

  getRecord(state: XiangqiGameState): readonly XiangqiRecordEntry[] {
    return state.history
  }
}
