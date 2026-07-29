export type Color = 'red' | 'black'

export type PieceType =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier'

export interface Piece {
  id: string
  color: Color
  type: PieceType
}

export interface Position {
  row: number
  col: number
}

export interface Move {
  from: Position
  to: Position
  piece: Piece
  captured?: Piece
}

export type BoardState = Array<Array<Piece | null>>

export interface ClockState {
  red: number
  black: number
  turn: number
}

export type GamePhase = 'ready' | 'running' | 'paused' | 'finished'

export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'timeout'
  | 'resignation'
  | 'repetition'
  | 'no-capture'

export interface GameResult {
  winner: Color | null
  loser: Color | null
  reason: ResultReason
}

export interface MoveRecord extends Move {
  notation: string
  ply: number
  evaluation: number
  depth: number
}

export interface SearchRequest {
  type: 'search'
  requestId: number
  board: BoardState
  color: Color
  timeBudgetMs: number
  seed: number
  maxDepth?: number
}

export interface SearchResponse {
  type: 'result'
  requestId: number
  move: Move | null
  score: number
  depth: number
  nodes: number
  elapsedMs: number
}
