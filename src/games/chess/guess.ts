import { Chess } from 'chess.js'
import { actionToUci } from './rules'
import type { ChessGameState, ChessMoveAction, ChessMoveRecord, ChessTurnAnalysis } from './types'

export interface ChessGuessStats { answered: number; hits: number; streak: number; longest: number }
export interface ChessGuessRound {
  id: number
  generation: number
  before: ChessGameState
  prefix: string
  selected: ChessMoveAction | null
  skipped: boolean
  actual?: ChessMoveRecord
  analysis?: ChessTurnAnalysis
}
export interface ChessGuessState {
  phase: 'off' | 'armed' | 'choosing' | 'searching' | 'revealed' | 'void'
  round: ChessGuessRound | null
  stats: ChessGuessStats
  reason?: string
}
export const emptyChessGuessStats = (): ChessGuessStats => ({ answered: 0, hits: 0, streak: 0, longest: 0 })
export const chessGuessPrefix = (state: ChessGameState) => JSON.stringify([state.initialFen, state.history.map((move) => move.uci), state.fen])
export function chessGuessSan(state: ChessGameState, move: ChessMoveAction): string {
  return new Chess(state.fen).move(move).san
}
export function nextChessGuessStats(stats: ChessGuessStats, selected: ChessMoveAction | null, actual: ChessMoveRecord): ChessGuessStats {
  if (!selected) return { ...stats, streak: 0 }
  const hit = actionToUci(selected) === actual.uci
  const streak = hit ? stats.streak + 1 : 0
  return { answered: stats.answered + 1, hits: stats.hits + Number(hit), streak, longest: Math.max(stats.longest, streak) }
}

// Only keep the current theatre's scores while its page is unmounted for study.
// Nothing is written to the archive or browser storage; reloading clears scores.
let studyReturn: { id: string; stats: ChessGuessStats } | null = null
export function keepChessGuessForStudy(id: string, stats: ChessGuessStats) { studyReturn = { id, stats } }
export function chessGuessFromStudy(id: string): ChessGuessStats | undefined { return studyReturn?.id === id ? studyReturn.stats : undefined }
