import type {
  AIPlayer,
  AIThinkResult,
  GameEngine,
  GamePlayer,
  GamePlayerId,
  GameStatus,
} from './contracts'

export interface GameControllerSnapshot<
  TState,
  TPlayer extends GamePlayerId,
> {
  state: TState
  status: GameStatus<TPlayer>
  revision: number
}

export interface AIBattleOptions<
  TState,
  TAction,
  TPlayer extends GamePlayerId,
  TAnalysis,
> {
  maxTurns?: number
  signal?: AbortSignal
  onTurn?: (
    snapshot: GameControllerSnapshot<TState, TPlayer>,
    decision: AIThinkResult<TAction, TAnalysis>,
  ) => void
}

export interface AIBattleResult<TState, TPlayer extends GamePlayerId> {
  snapshot: GameControllerSnapshot<TState, TPlayer>
  turnsPlayed: number
  stoppedBecause: 'finished' | 'human-turn' | 'turn-limit'
}

export class GameController<
  TState,
  TAction,
  TPlayer extends GamePlayerId,
  TRecord,
  TAnalysis = unknown,
> {
  private state: TState | null = null
  private revision = 0
  private readonly players = new Map<
    TPlayer,
    GamePlayer<TState, TAction, TPlayer, TRecord, TAnalysis>
  >()

  constructor(
    readonly game: GameEngine<TState, TAction, TPlayer, TRecord>,
    players: readonly GamePlayer<TState, TAction, TPlayer, TRecord, TAnalysis>[],
  ) {
    for (const player of players) {
      if (this.players.has(player.id)) {
        throw new Error(`玩家席位重复：${String(player.id)}`)
      }
      this.players.set(player.id, player)
    }
  }

  async start(): Promise<GameControllerSnapshot<TState, TPlayer>> {
    const initialState = this.game.initializeGame()
    const aiPlayers = this.getAIPlayers()
    await Promise.all(
      aiPlayers.map((player) =>
        player.engine.initialize({ gameId: this.game.id, player: player.id }),
      ),
    )
    await Promise.all(this.getUniqueAIEngines().map((engine) => engine.newGame?.()))
    this.assertPlayerExists(this.game.getCurrentPlayer(initialState))
    this.state = initialState
    this.revision += 1
    return this.getSnapshot()
  }

  async reset(): Promise<GameControllerSnapshot<TState, TPlayer>> {
    await this.stopAI('棋局已重置。')
    await Promise.all(this.getUniqueAIEngines().map((engine) => engine.newGame?.()))
    this.state = this.game.initializeGame()
    this.assertPlayerExists(this.game.getCurrentPlayer(this.state))
    this.revision += 1
    return this.getSnapshot()
  }

  getSnapshot(): GameControllerSnapshot<TState, TPlayer> {
    const state = this.requireState()
    return {
      state,
      status: this.game.getStatus(state),
      revision: this.revision,
    }
  }

  getPlayers(): readonly GamePlayer<TState, TAction, TPlayer, TRecord, TAnalysis>[] {
    return [...this.players.values()]
  }

  getLegalActions(): readonly TAction[] {
    const state = this.requireState()
    return this.game.isFinished(state) ? [] : this.game.getLegalActions(state)
  }

  play(action: TAction): GameControllerSnapshot<TState, TPlayer> {
    const state = this.requireState()
    if (this.game.isFinished(state)) throw new Error('棋局已经结束。')
    const canonicalAction = this.game
      .getLegalActions(state)
      .find((candidate) => this.game.actionsEqual(candidate, action))
    if (!canonicalAction) throw new Error('当前回合不能执行该动作。')
    this.state = this.game.executeAction(state, canonicalAction)
    this.revision += 1
    const status = this.game.getStatus(this.state)
    if (status.phase === 'playing') this.assertPlayerExists(status.currentPlayer)
    return this.getSnapshot()
  }

  async playAITurn(
    signal?: AbortSignal,
  ): Promise<{
    snapshot: GameControllerSnapshot<TState, TPlayer>
    decision: AIThinkResult<TAction, TAnalysis>
  }> {
    const state = this.requireState()
    const status = this.game.getStatus(state)
    if (status.phase === 'finished') throw new Error('棋局已经结束。')
    const player = this.players.get(status.currentPlayer)
    if (!player || player.kind !== 'ai') throw new Error('当前回合不是 AI 玩家。')
    if (signal?.aborted) throw new DOMException('AI 行棋已取消。', 'AbortError')

    const revisionAtRequest = this.revision
    const decision = await player.engine.think({
      state,
      player: player.id,
      legalActions: this.game.getLegalActions(state),
      record: this.game.getRecord(state),
      signal,
    })
    if (signal?.aborted) throw new DOMException('AI 行棋已取消。', 'AbortError')
    if (revisionAtRequest !== this.revision || this.state !== state) {
      throw new DOMException('棋局状态已变化，忽略过期 AI 结果。', 'AbortError')
    }
    return { snapshot: this.play(decision.action), decision }
  }

  async runAIBattle(
    options: AIBattleOptions<TState, TAction, TPlayer, TAnalysis> = {},
  ): Promise<AIBattleResult<TState, TPlayer>> {
    const maxTurns = options.maxTurns ?? 1_000
    if (!Number.isInteger(maxTurns) || maxTurns < 1) {
      throw new Error('AI 对战最大回合数必须是正整数。')
    }

    let turnsPlayed = 0
    while (turnsPlayed < maxTurns) {
      const snapshot = this.getSnapshot()
      if (snapshot.status.phase === 'finished') {
        return { snapshot, turnsPlayed, stoppedBecause: 'finished' }
      }
      const player = this.players.get(snapshot.status.currentPlayer)
      if (!player || player.kind !== 'ai') {
        return { snapshot, turnsPlayed, stoppedBecause: 'human-turn' }
      }
      const turn = await this.playAITurn(options.signal)
      turnsPlayed += 1
      options.onTurn?.(turn.snapshot, turn.decision)
    }
    return { snapshot: this.getSnapshot(), turnsPlayed, stoppedBecause: 'turn-limit' }
  }

  async dispose(): Promise<void> {
    this.revision += 1
    await this.stopAI('控制器已释放。')
    await Promise.all(this.getUniqueAIEngines().map((engine) => engine.dispose()))
    this.state = null
  }

  async cancelPendingTurn(reason = '当前回合已取消。'): Promise<void> {
    this.revision += 1
    await this.stopAI(reason)
  }

  invalidatePendingTurn(): void {
    this.revision += 1
  }

  private requireState(): TState {
    if (this.state === null) throw new Error('请先初始化棋局。')
    return this.state
  }

  private assertPlayerExists(player: TPlayer): void {
    if (!this.players.has(player)) throw new Error(`未配置玩家席位：${String(player)}`)
  }

  private getAIPlayers(): Array<AIPlayer<TState, TAction, TPlayer, TRecord, TAnalysis>> {
    return [...this.players.values()].filter(
      (player): player is AIPlayer<TState, TAction, TPlayer, TRecord, TAnalysis> =>
        player.kind === 'ai',
    )
  }

  private getUniqueAIEngines() {
    return [...new Set(this.getAIPlayers().map((player) => player.engine))]
  }

  private async stopAI(reason: string): Promise<void> {
    await Promise.all(this.getUniqueAIEngines().map((engine) => engine.stop?.(reason)))
  }
}
