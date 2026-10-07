import type { Move } from '../../game/types'
import type { XiangqiGameState, XiangqiRecordEntry } from './game-engine'

export interface GuessStats { answered: number; hits: number; streak: number; longest: number }
export interface GuessRound {
  before: XiangqiGameState
  prefix: string
  selected: Move | null
  submitted: boolean
  actual?: XiangqiRecordEntry
  source?: 'opening' | 'engine'
}
export interface GuessState {
  phase: 'off' | 'armed' | 'choosing' | 'searching' | 'revealed' | 'void'
  round: GuessRound | null
  stats: GuessStats
}
export const emptyGuessStats = (): GuessStats => ({ answered: 0, hits: 0, streak: 0, longest: 0 })
export const guessPrefix = (state: XiangqiGameState) => JSON.stringify(state.history.map((move) => move.ucci))
export function nextGuessStats(stats: GuessStats, guess: string | null, actual: string): GuessStats {
  if (!guess) return { ...stats, streak: 0 }
  const hit = guess === actual
  const streak = hit ? stats.streak + 1 : 0
  return { answered: stats.answered + 1, hits: stats.hits + Number(hit), streak, longest: Math.max(stats.longest, streak) }
}
