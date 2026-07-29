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
  | 'technical'

export interface GameResult {
  winner: Color | null
  loser: Color | null
  reason: ResultReason
  detail?: string
}

export type EngineScore =
  | { kind: 'cp'; value: number }
  | { kind: 'mate'; value: number }

export interface Wdl {
  win: number
  draw: number
  loss: number
}

export interface SearchInfo {
  depth: number
  seldepth?: number
  nodes: number
  nps: number
  elapsedMs: number
  score: EngineScore | null
  wdl: Wdl | null
  pv: string[]
}

export interface MoveRecord extends Move {
  notation: string
  ucci: string
  ply: number
  score: EngineScore | null
  wdl: Wdl | null
  depth: number
}

export interface EngineProfile {
  name: string
  version: string
  commit: string
  network: string
  networkSha256: string
  threads: number
  hashMb: number
}

export interface SearchResponse {
  bestmove: string | null
  info: SearchInfo
}
