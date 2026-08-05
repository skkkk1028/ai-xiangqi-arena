import { getLegalCaptures, getLegalMoves, isInCheck } from '../game/rules'
import type { BoardState, Color } from '../game/types'
import { classifyPersonalityPhase } from './personality'

export type MultiPvCount = 2 | 3 | 4
export type MultiPvReason =
  | 'resource-constrained'
  | 'low-time'
  | 'performance-constrained'
  | 'tactical-complexity'
  | 'endgame'
  | 'opening'
  | 'middlegame'

export interface SearchMultiPvInput {
  board: BoardState
  color: Color
  historyLength: number
  threads: number
  hashMb: number
  remainingTimeMs: number
  turnBudgetMs: number
}

export interface SearchMultiPvDecision {
  multiPv: MultiPvCount
  reason: MultiPvReason
}

const OPENING_PLIES = 16
const LOW_TIME_MS = 45_000

export function selectSearchMultiPv(input: SearchMultiPvInput): SearchMultiPvDecision {
  if (input.threads <= 1 || input.hashMb <= 64) {
    return { multiPv: 2, reason: 'resource-constrained' }
  }
  if (input.remainingTimeMs < LOW_TIME_MS) return { multiPv: 2, reason: 'low-time' }
  if (input.turnBudgetMs < 5_000) {
    return { multiPv: 2, reason: 'performance-constrained' }
  }

  const phase = classifyPersonalityPhase(input.board, input.color)
  if (phase === 'endgame') return { multiPv: 2, reason: 'endgame' }

  const legalMoves = getLegalMoves(input.board, input.color)
  const captures = getLegalCaptures(input.board, input.color)
  if (isInCheck(input.board, input.color) || legalMoves.length >= 45 || captures.length >= 5) {
    return { multiPv: 2, reason: 'tactical-complexity' }
  }

  if (input.historyLength < OPENING_PLIES) return { multiPv: 4, reason: 'opening' }
  return { multiPv: 3, reason: 'middlegame' }
}

export const SEARCH_MULTI_PV_POLICY = {
  openingPlies: OPENING_PLIES,
  lowTimeMs: LOW_TIME_MS,
  allowed: [2, 3, 4] as const,
} as const
