import type { GoAIAnalysis } from './ai'
import { GoGameEngine } from './game-engine'
import type { GoGameState, GoMove, GoMoveRecord } from './types'

export interface GoGuessStats { answered: number; hits: number; streak: number; longest: number }
export interface GoGuessRound {
  id: number
  generation: number
  before: GoGameState
  prefix: string
  selected: GoMove | null
  skipped: boolean
  actual?: GoMoveRecord
  analysis?: GoAIAnalysis
}
export interface GoGuessState {
  phase: 'off' | 'armed' | 'choosing' | 'searching' | 'revealed' | 'void'
  round: GoGuessRound | null
  stats: GoGuessStats
}
export const emptyGoGuessStats = (): GoGuessStats => ({ answered: 0, hits: 0, streak: 0, longest: 0 })
export const goGuessPrefix = (state: GoGameState) => JSON.stringify(state.history.map((move) => [move.color, move.kind, move.point]))
const engine = new GoGameEngine()
export function goGuessHit(selected: GoMove, actual: GoMoveRecord): boolean {
  return engine.actionsEqual(selected, actual.kind === 'pass' ? { kind: 'pass' } : actual.point!)
}
export function nextGoGuessStats(stats: GoGuessStats, selected: GoMove | null, actual: GoMoveRecord): GoGuessStats {
  if (!selected) return { ...stats, streak: 0 }
  const hit = goGuessHit(selected, actual)
  const streak = hit ? stats.streak + 1 : 0
  return { answered: stats.answered + 1, hits: stats.hits + Number(hit), streak, longest: Math.max(stats.longest, streak) }
}
