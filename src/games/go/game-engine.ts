import type { GameEngine, GameStatus } from '../core'
import {
  cloneGoBoard,
  createGoBoard,
  goPositionKey,
  oppositeGoPlayer,
  pointsEqual,
} from './board'
import { createGoMoveRecord } from './move-history'
import { CHINESE_GO_RULESET } from './ruleset'
import { getLegalGoMoves, tryPlayGoMove } from './rules'
import { resolveDeadStoneRepresentatives } from './scoring'
import {
  GO_PASS_MOVE,
  isGoPassMove,
  type GoGameState,
  type GoMove,
  type GoMoveRecord,
  type GoPlacementMove,
  type GoPlayer,
  type GoRuleset,
  type GoRulesetInfo,
  type GoScore,
  type GoScoringRequest,
  type GoScoringStrategy,
} from './types'

export interface GoGameEngineOptions {
  /** Defaults to the platform's Chinese ruleset: 19 lines, 7.5 komi and PSK. */
  ruleset?: GoRuleset
  /** Optional scoring implementation for a future ruleset without changing play rules. */
  scoring?: GoScoringStrategy
}

export type GoMoveRejectionReason = 'illegal' | 'ko' | 'repetition'

const EMPTY_SCORING_REQUEST: GoScoringRequest = { deadStoneRepresentatives: [] }

/**
 * Pure Go rules engine. The generic platform sees the scoring phase as
 * finished so it stops requesting turns; Go UI code can inspect `state.phase`
 * and use the explicit scoring APIs below.
 */
export class GoGameEngine implements GameEngine<GoGameState, GoMove, GoPlayer, GoMoveRecord> {
  readonly id = 'go'
  readonly name = '围棋'
  readonly ruleset: GoRuleset
  private readonly scoring: GoScoringStrategy

  constructor(options: GoGameEngineOptions = {}) {
    this.ruleset = options.ruleset ?? CHINESE_GO_RULESET
    this.scoring = options.scoring ?? this.ruleset.scoring
  }

  initializeGame(): GoGameState {
    const board = createGoBoard(this.ruleset.boardSize)
    const key = goPositionKey(board)
    return {
      board,
      turn: 'black',
      phase: 'playing',
      history: [],
      lastMove: null,
      result: null,
      consecutivePasses: 0,
      prisoners: { black: 0, white: 0 },
      positionHistory: [key],
      positionCounts: new Map([[key, 1]]),
    }
  }

  /** Alias for standalone Go consumers. */
  init(): GoGameState {
    return this.initializeGame()
  }

  /** GoGameEngine is pure; this returns the supplied immutable state snapshot. */
  getState(state: GoGameState): GoGameState {
    return state
  }

  getCurrentPlayer(state: GoGameState): GoPlayer {
    return state.turn
  }

  getLegalActions(state: GoGameState): readonly GoMove[] {
    if (state.phase !== 'playing') return []
    return [
      ...getLegalGoMoves(state.board, state.turn).filter((move) => !this.getMoveRejectionReason(state, move)),
      GO_PASS_MOVE,
    ]
  }

  getLegalMoves(state: GoGameState): readonly GoPlacementMove[] {
    if (state.phase !== 'playing') return []
    return getLegalGoMoves(state.board, state.turn).filter(
      (move) => !this.getMoveRejectionReason(state, move),
    )
  }

  actionsEqual(left: GoMove, right: GoMove): boolean {
    if (isGoPassMove(left) || isGoPassMove(right)) {
      return isGoPassMove(left) && isGoPassMove(right)
    }
    return pointsEqual(left, right)
  }

  executeAction(state: GoGameState, action: GoMove): GoGameState {
    this.assertPlaying(state)
    if (isGoPassMove(action)) return this.executePass(state)

    const rejection = this.getMoveRejectionReason(state, action)
    if (rejection === 'ko') throw new Error('围棋劫规则禁手。')
    if (rejection === 'repetition') throw new Error('围棋局面重复禁手。')
    if (rejection) throw new Error('围棋着法不合法。')
    const outcome = tryPlayGoMove(state.board, action, state.turn)
    if (!outcome) throw new Error('围棋着法不合法。')

    const record = createGoMoveRecord(
      state.history.length + 1,
      state.turn,
      action,
      outcome.captures,
      state.board.length,
    )
    const key = goPositionKey(outcome.board)
    const positionCounts = new Map(state.positionCounts)
    positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1)
    return {
      board: outcome.board,
      turn: oppositeGoPlayer(state.turn),
      phase: 'playing',
      history: [...state.history, record],
      lastMove: record,
      result: null,
      consecutivePasses: 0,
      prisoners: {
        ...state.prisoners,
        [state.turn]: state.prisoners[state.turn] + outcome.captures.length,
      },
      positionHistory: [...state.positionHistory, key],
      positionCounts,
    }
  }

  applyMove(state: GoGameState, action: GoMove): GoGameState {
    return this.executeAction(state, action)
  }

  /**
   * The generic GameController has no scoring status. Treat scoring as
   * terminal there so no further turns are requested; callers that understand
   * Go can distinguish it through `state.phase`.
   */
  isFinished(state: GoGameState): boolean {
    return state.phase !== 'playing'
  }

  isGameOver(state: GoGameState): boolean {
    return this.isFinished(state)
  }

  getStatus(state: GoGameState): GameStatus<GoPlayer> {
    if (state.phase === 'playing') return { phase: 'playing', currentPlayer: state.turn }
    if (state.phase === 'scoring') return { phase: 'finished', winner: null, reason: 'scoring' }
    return {
      phase: 'finished',
      winner: state.result?.winner ?? null,
      reason: state.result?.reason ?? 'scored',
    }
  }

  getRecord(state: GoGameState): readonly GoMoveRecord[] {
    return state.history
  }

  getHistory(state: GoGameState): readonly GoMoveRecord[] {
    return this.getRecord(state)
  }

  getMoveRejectionReason(
    state: GoGameState,
    action: GoPlacementMove,
  ): GoMoveRejectionReason | null {
    if (state.phase !== 'playing') return 'illegal'
    const outcome = tryPlayGoMove(state.board, action, state.turn)
    if (!outcome) return 'illegal'
    const candidateKey = goPositionKey(outcome.board)
    if (this.isImmediateKo(state, candidateKey)) return 'ko'
    if (state.positionCounts.has(candidateKey)) return 'repetition'
    return null
  }

  /** Returns a score preview without changing the Go state or its history. */
  previewScore(
    state: GoGameState,
    request: GoScoringRequest = EMPTY_SCORING_REQUEST,
  ): GoScore {
    this.assertScoring(state)
    const resolution = resolveDeadStoneRepresentatives(
      state.board,
      request.deadStoneRepresentatives,
    )
    return this.scoring.score({
      ruleset: this.getRulesetInfo(),
      board: resolution.board,
      prisoners: { ...state.prisoners },
      history: cloneHistory(state.history),
      komi: this.ruleset.komi,
      confirmedDeadStones: resolution.confirmedDeadStones,
    })
  }

  /** Finalizes a scoring-phase position without changing the played board. */
  finalizeScoring(
    state: GoGameState,
    request: GoScoringRequest = EMPTY_SCORING_REQUEST,
  ): GoGameState {
    this.assertScoring(state)
    const score = this.previewScore(state, request)
    return {
      ...state,
      board: cloneGoBoard(state.board),
      phase: 'finished',
      history: cloneHistory(state.history),
      lastMove: cloneMoveRecord(state.lastMove),
      result: { winner: score.winner, reason: 'scored', score },
      prisoners: { ...state.prisoners },
      positionHistory: [...state.positionHistory],
      positionCounts: new Map(state.positionCounts),
    }
  }

  /**
   * Lets players resolve a scoring disagreement on the board. All actual move
   * and position history is retained so positional superko remains valid.
   */
  resumePlay(state: GoGameState): GoGameState {
    this.assertScoring(state)
    return {
      ...state,
      board: cloneGoBoard(state.board),
      phase: 'playing',
      history: cloneHistory(state.history),
      lastMove: cloneMoveRecord(state.lastMove),
      result: null,
      consecutivePasses: 0,
      prisoners: { ...state.prisoners },
      positionHistory: [...state.positionHistory],
      positionCounts: new Map(state.positionCounts),
    }
  }

  private getRulesetInfo(): GoRulesetInfo {
    return {
      id: this.ruleset.id,
      name: this.ruleset.name,
      boardSize: this.ruleset.boardSize,
      komi: this.ruleset.komi,
      suicideForbidden: this.ruleset.suicideForbidden,
      repetition: this.ruleset.repetition,
    }
  }

  private assertPlaying(state: GoGameState): void {
    if (state.phase === 'scoring') {
      throw new Error('围棋正在计分，请先完成结算或恢复落子。')
    }
    if (state.phase === 'finished') {
      throw new Error('围棋对局已经结束。')
    }
  }

  private assertScoring(state: GoGameState): void {
    if (state.phase !== 'scoring') {
      throw new Error('围棋当前不在计分阶段。')
    }
  }

  private isImmediateKo(state: GoGameState, candidateKey: string): boolean {
    return (
      state.lastMove?.kind === 'play' &&
      state.positionHistory.length >= 2 &&
      state.positionHistory[state.positionHistory.length - 2] === candidateKey
    )
  }

  private executePass(state: GoGameState): GoGameState {
    const record = createGoMoveRecord(
      state.history.length + 1,
      state.turn,
      GO_PASS_MOVE,
      [],
      state.board.length,
    )
    const consecutivePasses = state.consecutivePasses + 1
    return {
      board: cloneGoBoard(state.board),
      turn: oppositeGoPlayer(state.turn),
      phase: consecutivePasses >= 2 ? 'scoring' : 'playing',
      history: [...state.history, record],
      lastMove: record,
      result: null,
      consecutivePasses,
      prisoners: { ...state.prisoners },
      // Passes do not create a new positional-superko board entry.
      positionHistory: [...state.positionHistory],
      positionCounts: new Map(state.positionCounts),
    }
  }
}

function cloneHistory(history: readonly GoMoveRecord[]): GoMoveRecord[] {
  return history.map((record) => ({
    ...record,
    point: record.point ? { ...record.point } : null,
    captures: record.captures.map((point) => ({ ...point })),
  }))
}

function cloneMoveRecord(record: GoMoveRecord | null): GoMoveRecord | null {
  if (!record) return null
  return {
    ...record,
    point: record.point ? { ...record.point } : null,
    captures: record.captures.map((point) => ({ ...point })),
  }
}
