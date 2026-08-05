import { getSimplifiedDrawReason } from '../../game/adjudication'
import { applyMove, createInitialBoard, opposite, positionKey } from '../../game/board'
import { formatMove } from '../../game/notation'
import { getLegalMoves, isInCheck } from '../../game/rules'
import type { BoardState, Color, GameResult, Move } from '../../game/types'
import { moveToUcci } from '../../engine/ucci'
import type { XiangqiRecordEntry } from './game-engine'

/**
 * 迁移前两个 React Hook 共用的规则状态快照。
 *
 * @deprecated 仅作为 GameController 迁移期的行为对照和回滚基准；生产路径不得调用。
 */
export interface LegacyXiangqiTransitionState {
  board: BoardState
  turn: Color
  history: readonly XiangqiRecordEntry[]
  lastMove: Move | null
  checkColor: Color | null
  result: GameResult | null
  noCapturePlies: number
  repetitions: ReadonlyMap<string, number>
}

export function createLegacyXiangqiTransitionState(): LegacyXiangqiTransitionState {
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

function sameMove(left: Move, right: Move): boolean {
  return (
    left.from.row === right.from.row &&
    left.from.col === right.from.col &&
    left.to.row === right.to.row &&
    left.to.col === right.to.col
  )
}

/**
 * 迁移前 Hook 的“校验 → 落子 → 将军/终局 → 重复与无吃子计数 → 棋谱”流程。
 * 保留此副本，直到线上观察期和规则奇偶测试均确认新路径稳定。
 *
 * @deprecated 使用 XiangqiGameEngine.executeAction。
 */
export function executeLegacyXiangqiTransition(
  state: LegacyXiangqiTransitionState,
  requestedMove: Move,
): LegacyXiangqiTransitionState {
  if (state.result) throw new Error('象棋对局已经结束。')
  const move = getLegalMoves(state.board, state.turn).find((candidate) =>
    sameMove(candidate, requestedMove),
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
