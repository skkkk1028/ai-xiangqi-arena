import type { EngineProfile, EngineSearchResponse } from '../game/types'
import type { AIEngineConfig, EngineSearchOptions } from './types'

export interface EngineAdapter {
  readonly config: Readonly<AIEngineConfig>
  init(): Promise<EngineProfile>
  sendCommand(command: string): void
  setPosition(moves: string[]): void
  search(
    moves: string[],
    movetimeMs: number,
    options: EngineSearchOptions,
  ): Promise<EngineSearchResponse>
  stop(reason?: string): void
  newGame(): void
  dispose(): void
}
