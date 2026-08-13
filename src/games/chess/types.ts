import type { EngineProfile, EngineSearchResponse, SearchInfo } from '../../game/types'

export type ChessColor = 'w' | 'b'
export type ChessPieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type ChessPromotion = Exclude<ChessPieceType, 'p' | 'k'>
export type ChessSquare = `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`

export const CHESS_INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
export const CHESS_RULESET = 'standard-chess-fide-claims-v2'
export const CHESS_LEGACY_RULESET = 'standard-chess-auto-claim-v1'
export const CHESS_MAX_PLIES = 400

export interface ChessMoveAction {
  kind?: 'move'
  from: ChessSquare
  to: ChessSquare
  promotion?: ChessPromotion
}

export type ChessClaimReason = 'threefold-repetition' | 'fifty-move'

export interface ChessDrawClaimAction {
  kind: 'claim-draw'
  reason: ChessClaimReason
  /** FIDE 9.2.1/9.3.1: the move is declared, but not played, when making the claim. */
  intendedMove?: ChessMoveAction
}

export type ChessAction = ChessMoveAction | ChessDrawClaimAction

export type ChessResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move'
  | 'fivefold-repetition'
  | 'seventy-five-move'
  | 'technical-stop'

export type ChessTermination = 'board' | 'claim' | 'automatic' | 'technical'

export interface ChessGameResult {
  winner: ChessColor | null
  loser: ChessColor | null
  reason: ChessResultReason
  termination: ChessTermination
  claimant: ChessColor | null
  intendedMove: string | null
}

export interface ChessMoveRecord extends ChessMoveAction {
  ply: number
  color: ChessColor
  uci: string
  san: string
  fen: string
  captured?: ChessPieceType
  check: boolean
  mate: boolean
}

export type ChessGamePhase = 'ready' | 'playing' | 'paused' | 'finished' | 'technical'

export interface ChessGameState {
  phase: ChessGamePhase
  initialFen: string
  fen: string
  turn: ChessColor
  history: readonly ChessMoveRecord[]
  lastMove: ChessMoveRecord | null
  result: ChessGameResult | null
  seed: number
  openingId: string
  openingName: string
}

export type ChessSearchBudgetId = 'fast' | 'standard' | 'deep' | 'professional' | 'professional-deep'
export type ChessPlayMode = 'personality' | 'professional'

export type ChessArenaEngineId = 'fairy-stockfish-chess' | 'stockfish-18' | 'obsidian-16'
export type ChessArenaBudgetId = 'fast' | 'standard' | 'deep'
export type ChessEngineAvailabilityState = 'available' | 'fallback' | 'local-required' | 'unsupported'

export interface ChessEngineAvailability {
  state: ChessEngineAvailabilityState
  reason: string
}

export interface ChessArenaSeatConfig {
  engineId: ChessArenaEngineId
  runtime: 'browser-worker' | 'browser-wasm' | 'native-bridge'
  fingerprint: string | null
}

export interface ChessArenaConfig {
  white: ChessArenaSeatConfig
  black: ChessArenaSeatConfig
  budget: ChessArenaBudgetId
  seed: number
}

export interface ChessSearchProfile {
  id: ChessSearchBudgetId
  label: string
  movetimeMs: number
  threads: number
  hashMb: number
  multiPv: 1 | 4
  mode: ChessPlayMode
}

export type ChessPersonalityId = 'attack' | 'solid'

export interface ChessPersonality {
  id: ChessPersonalityId
  label: string
  description: string
}

export interface ChessEngineSeat {
  color: ChessColor
  personality: ChessPersonality
  profile: EngineProfile | null
  runtimeError: string | null
  progress?: { phase: string; loaded: number; total: number; message: string }
}

export interface ChessTurnAnalysis {
  rootFen: string
  color: ChessColor
  ply: number
  info: SearchInfo
  uci: string | null
  source: 'opening' | 'engine'
  response?: EngineSearchResponse
  budgetMs?: number
  multiPv?: number
  selectedCandidate?: number
  selectionReason?: string
  claimReason?: ChessClaimReason
}

export interface ChessLiveAnalysis {
  rootFen: string
  color: ChessColor
  ply: number
  info: SearchInfo
}

export interface ChessOpening {
  id: string
  name: string
  moves: readonly string[]
}
