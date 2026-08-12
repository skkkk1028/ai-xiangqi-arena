import type { GamePlayerId } from './contracts'
import type { GameController, GameControllerSnapshot } from './GameController'
import type { EngineRuntimeSnapshot, MatchSessionSnapshot } from './engine-runtime'

type AnyController<TState, TPlayer extends GamePlayerId> = GameController<
  TState,
  unknown,
  TPlayer,
  unknown,
  unknown
>

/**
 * Observable lifecycle shell used while the game-specific hooks migrate away
 * from owning cancellation, stale-result and disposal state independently.
 */
export class MatchSession<TState, TPlayer extends GamePlayerId> {
  private listeners = new Set<(snapshot: MatchSessionSnapshot<TState, TPlayer>) => void>()
  private generation = 0
  private snapshot: MatchSessionSnapshot<TState, TPlayer>

  constructor(
    private readonly controller: AnyController<TState, TPlayer>,
    engines: readonly EngineRuntimeSnapshot[] = [],
  ) {
    this.snapshot = {
      state: null,
      phase: 'idle',
      revision: 0,
      currentPlayer: null,
      engines,
      error: null,
    }
  }

  getSnapshot(): MatchSessionSnapshot<TState, TPlayer> {
    return this.snapshot
  }

  subscribe(listener: (snapshot: MatchSessionSnapshot<TState, TPlayer>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<MatchSessionSnapshot<TState, TPlayer>> {
    const generation = ++this.generation
    this.publish({ ...this.snapshot, phase: 'starting', error: null })
    try {
      const controllerSnapshot = await this.controller.start()
      if (generation !== this.generation) throw staleSessionError()
      return this.publishController(controllerSnapshot)
    } catch (error) {
      if (generation !== this.generation) throw error
      this.publish({ ...this.snapshot, phase: 'error', error: errorMessage(error) })
      throw error
    }
  }

  pause(): MatchSessionSnapshot<TState, TPlayer> {
    this.generation += 1
    void this.controller.cancelPendingTurn('对局已暂停。')
    return this.publish({ ...this.snapshot, phase: 'paused' })
  }

  resume(): MatchSessionSnapshot<TState, TPlayer> {
    if (this.snapshot.phase !== 'paused') return this.snapshot
    return this.publish({ ...this.snapshot, phase: 'playing', error: null })
  }

  sync(snapshot: GameControllerSnapshot<TState, TPlayer>): MatchSessionSnapshot<TState, TPlayer> {
    return this.publishController(snapshot)
  }

  async reset(): Promise<MatchSessionSnapshot<TState, TPlayer>> {
    const generation = ++this.generation
    const controllerSnapshot = await this.controller.reset()
    if (generation !== this.generation) throw staleSessionError()
    return this.publishController(controllerSnapshot)
  }

  async dispose(): Promise<void> {
    this.generation += 1
    await this.controller.dispose()
    this.publish({ ...this.snapshot, phase: 'disposed', currentPlayer: null })
    this.listeners.clear()
  }

  private publishController(
    controllerSnapshot: GameControllerSnapshot<TState, TPlayer>,
  ): MatchSessionSnapshot<TState, TPlayer> {
    const status = controllerSnapshot.status
    return this.publish({
      ...this.snapshot,
      state: controllerSnapshot.state,
      revision: controllerSnapshot.revision,
      phase: status.phase,
      currentPlayer: status.phase === 'playing' ? status.currentPlayer : null,
      error: null,
    })
  }

  private publish(next: MatchSessionSnapshot<TState, TPlayer>) {
    this.snapshot = next
    for (const listener of this.listeners) listener(next)
    return next
  }
}

function staleSessionError(): DOMException {
  return new DOMException('会话状态已变化，忽略过期结果。', 'AbortError')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
