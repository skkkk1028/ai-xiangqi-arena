export const GO_BOARD_SIZE = 19

export type GoPlayer = 'black' | 'white'
export type GoStone = GoPlayer | null
export type GoBoard = GoStone[][]
export type GoGamePhase = 'playing' | 'scoring' | 'finished'
export type GoRepetitionRule = 'positional-superko'

export interface GoPoint {
  row: number
  col: number
}

/** `kind` is optional to preserve the original `{ row, col }` placement API. */
export interface GoPlacementMove extends GoPoint {
  kind?: 'play'
}

export interface GoPassMove {
  kind: 'pass'
}

export type GoMove = GoPlacementMove | GoPassMove

export const GO_PASS_MOVE: GoPassMove = { kind: 'pass' }

export function isGoPassMove(move: GoMove): move is GoPassMove {
  return move.kind === 'pass'
}

export interface GoMoveRecord {
  moveNumber: number
  color: GoPlayer
  kind: 'play' | 'pass'
  point: GoPoint | null
  notation: string
  captures: readonly GoPoint[]
}

/** Immutable rule metadata that is safe to include in score results. */
export interface GoRulesetInfo {
  readonly id: string
  readonly name: string
  readonly boardSize: number
  readonly komi: number
  readonly suicideForbidden: true
  readonly repetition: GoRepetitionRule
}

export interface GoScoreSide {
  /** Stones still on the board after confirmed dead groups have been removed. */
  livingStones: number
  territory: number
  /** Kept for auditing; Chinese area scoring does not add these to `total`. */
  prisoners: number
  total: number
}

export interface GoScore {
  ruleset: GoRulesetInfo
  method: string
  black: GoScoreSide
  white: GoScoreSide
  komi: number
  neutralPoints: number
  confirmedDeadStones: readonly GoPoint[]
  winner: GoPlayer | null
  margin: number
}

/**
 * `board` has already had confirmed dead groups removed. This lets every
 * scoring strategy focus on its own counting method while the engine owns
 * validation and whole-string dead-stone expansion.
 */
export interface GoScoringInput {
  ruleset: GoRulesetInfo
  board: GoBoard
  prisoners: Readonly<Record<GoPlayer, number>>
  history: readonly GoMoveRecord[]
  komi: number
  confirmedDeadStones: readonly GoPoint[]
}

/** Strategy boundary for future Japanese territory scoring or other rulesets. */
export interface GoScoringStrategy {
  readonly id: string
  readonly name: string
  score(input: GoScoringInput): GoScore
}

export interface GoRuleset extends GoRulesetInfo {
  readonly scoring: GoScoringStrategy
}

/** Representatives are any one stone from each dead string being confirmed. */
export interface GoScoringRequest {
  deadStoneRepresentatives: readonly GoPoint[]
}

export interface GoGameResult {
  winner: GoPlayer | null
  reason: 'scored'
  score: GoScore
}

export interface GoGameState {
  board: GoBoard
  turn: GoPlayer
  phase: GoGamePhase
  history: readonly GoMoveRecord[]
  lastMove: GoMoveRecord | null
  /** Only populated after an explicit scoring finalization. */
  result: GoGameResult | null
  consecutivePasses: number
  prisoners: Record<GoPlayer, number>
  /** Initial board plus every board that resulted from a placement; passes do not add positions. */
  positionHistory: readonly string[]
  positionCounts: ReadonlyMap<string, number>
}

export interface GoGroup {
  color: GoPlayer
  stones: readonly GoPoint[]
  liberties: readonly GoPoint[]
}

export interface GoMoveOutcome {
  board: GoBoard
  captures: readonly GoPoint[]
}
