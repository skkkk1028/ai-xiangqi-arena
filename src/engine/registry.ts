import type { EngineAdapter } from './adapter'
import type { AIEngineConfig, EngineAdapterContext } from './types'
import type { EngineGameId } from '../games/core/engine-runtime'

export type EngineAdapterFactory = (
  config: Readonly<AIEngineConfig>,
  context: EngineAdapterContext,
) => EngineAdapter

interface EngineRegistration {
  config: Readonly<AIEngineConfig>
  factory: EngineAdapterFactory
}

/** Registry with explicit game ownership for every engine profile. */
export class EngineRegistry {
  private readonly registrations = new Map<string, EngineRegistration>()

  registerEngine(config: Readonly<AIEngineConfig>, factory: EngineAdapterFactory): void {
    if (this.registrations.has(config.id)) {
      throw new Error(`引擎已注册：${config.id}`)
    }
    this.registrations.set(config.id, { config, factory })
  }

  getEngine(gameId: EngineGameId, id: string): Readonly<AIEngineConfig> | undefined {
    const config = this.registrations.get(id)?.config
    if (!config) return undefined
    if (config.gameId !== gameId) return undefined
    return config
  }

  listEngines(gameId: EngineGameId): ReadonlyArray<Readonly<AIEngineConfig>> {
    return [...this.registrations.values()]
      .map(({ config }) => config)
      .filter((config) => config.gameId === gameId)
  }

  createEngine(
    gameId: EngineGameId,
    id: string,
    context: EngineAdapterContext,
    overrides?: Partial<Pick<AIEngineConfig, 'threads' | 'hash'>>,
  ): EngineAdapter {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`未注册的引擎：${id}`)
    if (registration.config.gameId !== gameId) {
      throw new Error(`引擎 ${id} 不属于棋类 ${gameId}`)
    }
    const config = {
      ...registration.config,
      options: { ...registration.config.options },
      timeControl: { ...registration.config.timeControl },
      nnueParts: registration.config.nnueParts ? [...registration.config.nnueParts] : undefined,
      ...(overrides ?? {}),
    }
    return registration.factory(config, context)
  }
}
