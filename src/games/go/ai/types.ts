import type { GoMove, GoPlayer } from '../types'

export type KataGoSearchProfile = 'fast' | 'strong'

export interface KataGoCapabilities {
  ready: boolean
  engineVersion: string
  modelName: string
  profiles: Readonly<Record<KataGoSearchProfile, { maxVisits: number; timeoutMs: number }>>
}

export interface KataGoRules {
  ko: 'POSITIONAL'
  scoring: 'AREA'
  tax: 'NONE'
  suicide: false
  hasButton: false
  whiteHandicapBonus: '0'
  friendlyPassOk: true
}

export const KATAGO_CHINESE_PSK_RULES: KataGoRules = {
  ko: 'POSITIONAL',
  scoring: 'AREA',
  tax: 'NONE',
  suicide: false,
  hasButton: false,
  whiteHandicapBonus: '0',
  friendlyPassOk: true,
}

export type KataGoMoveTuple = readonly ['B' | 'W', string]

export interface KataGoAnalyzeRequest {
  requestId: string
  gameId: string
  player: GoPlayer
  profile: KataGoSearchProfile
  boardSize: 19
  komi: 7.5
  rules: KataGoRules
  moves: readonly KataGoMoveTuple[]
}

export interface KataGoWireCandidate {
  move: string
  order: number
  visits: number
  prior: number | null
  winrate: number
  scoreLead: number | null
  pv: readonly string[]
}

export interface KataGoWireAnalysisEvent {
  type: 'analysis'
  stage: 'partial' | 'final'
  requestId: string
  engineVersion: string
  modelName: string
  profile: KataGoSearchProfile
  elapsedMs: number
  truncated: boolean
  root: {
    winrate: number
    scoreLead: number | null
    visits: number
  }
  candidates: readonly KataGoWireCandidate[]
}

export interface KataGoWireErrorEvent {
  type: 'error'
  requestId?: string
  code: string
  message: string
}

export type KataGoWireEvent = KataGoWireAnalysisEvent | KataGoWireErrorEvent

export interface KataGoCandidateAnalysis {
  action: GoMove
  notation: string
  order: number
  visits: number
  prior: number | null
  blackWinRate: number
  scoreLeadBlack: number | null
  pv: readonly GoMove[]
  pvNotation: readonly string[]
}

export interface KataGoAnalysis {
  requestId: string
  player: GoPlayer
  stage: 'partial' | 'final'
  action: GoMove
  blackWinRate: number
  whiteWinRate: number
  currentPlayerWinRate: number
  /** Percentage-point delta from the previous completed position, from this player's perspective. */
  winRateChange: number | null
  scoreLeadBlack: number | null
  visits: number
  elapsedMs: number
  truncated: boolean
  pv: readonly GoMove[]
  pvNotation: readonly string[]
  candidates: readonly KataGoCandidateAnalysis[]
  engineVersion: string
  modelName: string
  profile: KataGoSearchProfile
}

export type KataGoAnalysisListener = (analysis: KataGoAnalysis) => void

export class KataGoMatchAnalysisStore {
  private previousBlackWinRate: number | null = null

  getPreviousBlackWinRate(): number | null {
    return this.previousBlackWinRate
  }

  commit(blackWinRate: number): void {
    this.previousBlackWinRate = blackWinRate
  }

  reset(): void {
    this.previousBlackWinRate = null
  }
}
