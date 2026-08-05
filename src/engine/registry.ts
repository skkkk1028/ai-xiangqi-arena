import type { EngineAdapter } from './adapter'
import type { AIEngineConfig, EngineAdapterContext } from './types'

export type EngineAdapterFactory = (
  config: Readonly<AIEngineConfig>,
  context: EngineAdapterContext,
) => EngineAdapter

interface EngineRegistration {
  config: Readonly<AIEngineConfig>
  factory: EngineAdapterFactory
}

export class EngineRegistry {
  private readonly registrations = new Map<string, EngineRegistration>()

  registerEngine(config: Readonly<AIEngineConfig>, factory: EngineAdapterFactory): void {
    if (this.registrations.has(config.id)) {
      throw new Error(`引擎已注册：${config.id}`)
    }
    this.registrations.set(config.id, { config, factory })
  }

  getEngine(id: string): Readonly<AIEngineConfig> | undefined {
    return this.registrations.get(id)?.config
  }

  listEngines(): ReadonlyArray<Readonly<AIEngineConfig>> {
    return [...this.registrations.values()].map(({ config }) => config)
  }

  createEngine(
    id: string,
    context: EngineAdapterContext,
    overrides: Partial<Pick<AIEngineConfig, 'threads' | 'hash'>> = {},
  ): EngineAdapter {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`未注册的引擎：${id}`)
    const config = {
      ...registration.config,
      options: { ...registration.config.options },
      timeControl: { ...registration.config.timeControl },
      nnueParts: registration.config.nnueParts ? [...registration.config.nnueParts] : undefined,
      ...overrides,
    }
    return registration.factory(config, context)
  }
}
