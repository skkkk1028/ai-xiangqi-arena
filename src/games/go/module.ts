import type { AIEngine, GameEngine } from '../core'
import type { GoPlayer } from './types'

export const GO_GAME_ID = 'go'

/**
 * Compile-time extension points for the future Go implementation.
 * No rules or AI behavior are claimed by these aliases.
 */
export type GoGameEngineContract<TState, TAction, TRecord> = GameEngine<
  TState,
  TAction,
  GoPlayer,
  TRecord
>

export type GoAIEngineContract<TState, TAction, TRecord, TAnalysis = unknown> = AIEngine<
  TState,
  TAction,
  GoPlayer,
  TRecord,
  TAnalysis
>
