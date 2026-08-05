export type GamePlayerId = string | number | symbol

export type GameStatus<TPlayer extends GamePlayerId> =
  | {
      phase: 'playing'
      currentPlayer: TPlayer
    }
  | {
      phase: 'finished'
      winner: TPlayer | null
      reason: string
    }

/**
 * Pure rules contract shared by every board game.
 *
 * Implementations should treat state as immutable: executeAction returns a new
 * state and must not mutate the value supplied by the caller.
 */
export interface GameEngine<
  TState,
  TAction,
  TPlayer extends GamePlayerId,
  TRecord,
> {
  readonly id: string
  readonly name: string
  initializeGame(): TState
  getCurrentPlayer(state: TState): TPlayer
  getLegalActions(state: TState): readonly TAction[]
  actionsEqual(left: TAction, right: TAction): boolean
  executeAction(state: TState, action: TAction): TState
  isFinished(state: TState): boolean
  getStatus(state: TState): GameStatus<TPlayer>
  getRecord(state: TState): readonly TRecord[]
}

export interface AIInitialization<TPlayer extends GamePlayerId> {
  gameId: string
  player: TPlayer
}

export interface AIThinkRequest<TState, TAction, TPlayer extends GamePlayerId, TRecord> {
  state: TState
  player: TPlayer
  legalActions: readonly TAction[]
  record: readonly TRecord[]
  signal?: AbortSignal
}

export interface AIThinkResult<TAction, TAnalysis = unknown> {
  action: TAction
  analysis?: TAnalysis
}

/** AI contract is deliberately independent from UCCI, UCI, WASM and Worker. */
export interface AIEngine<
  TState,
  TAction,
  TPlayer extends GamePlayerId,
  TRecord,
  TAnalysis = unknown,
> {
  readonly id: string
  readonly name: string
  initialize(context: AIInitialization<TPlayer>): Promise<void>
  newGame?(): void | Promise<void>
  think(
    request: AIThinkRequest<TState, TAction, TPlayer, TRecord>,
  ): Promise<AIThinkResult<TAction, TAnalysis>>
  stop?(reason?: string): void | Promise<void>
  dispose(): void | Promise<void>
}

export interface HumanPlayer<TPlayer extends GamePlayerId> {
  id: TPlayer
  name: string
  kind: 'human'
}

export interface AIPlayer<
  TState,
  TAction,
  TPlayer extends GamePlayerId,
  TRecord,
  TAnalysis = unknown,
> {
  id: TPlayer
  name: string
  kind: 'ai'
  engine: AIEngine<TState, TAction, TPlayer, TRecord, TAnalysis>
}

export type GamePlayer<
  TState,
  TAction,
  TPlayer extends GamePlayerId,
  TRecord,
  TAnalysis = unknown,
> = HumanPlayer<TPlayer> | AIPlayer<TState, TAction, TPlayer, TRecord, TAnalysis>
