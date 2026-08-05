import { describe, expect, it, vi } from 'vitest'
import type { EngineAdapter } from '../engine/adapter'
import {
  FAIRY_STOCKFISH_CONFIG,
  PIKAFISH_2025_CONFIG,
  PIKAFISH_CONFIG,
} from '../engine/config'
import { EngineRegistry } from '../engine/registry'
import { engineRegistry } from '../engine/default-registry'

describe('EngineRegistry', () => {
  it('默认注册表提供 Fairy-Stockfish 与两个固定 Pikafish 核心', () => {
    expect(engineRegistry.listEngines().map((engine) => engine.id)).toEqual([
      'fairy-stockfish-nnue',
      'pikafish-2026-nnue',
      'pikafish-2025-nnue',
    ])
  })

  it('两个 Pikafish 固定核心使用相同满强度资源和时间控制', () => {
    expect(PIKAFISH_2025_CONFIG.skillLevel).toBeNull()
    expect(PIKAFISH_CONFIG.skillLevel).toBeNull()
    expect(PIKAFISH_2025_CONFIG).toMatchObject({
      engineType: PIKAFISH_CONFIG.engineType,
      protocol: PIKAFISH_CONFIG.protocol,
      threads: PIKAFISH_CONFIG.threads,
      hash: PIKAFISH_CONFIG.hash,
      options: PIKAFISH_CONFIG.options,
      timeControl: PIKAFISH_CONFIG.timeControl,
    })
  })

  it('按配置注册并通过统一接口创建引擎', () => {
    const registry = new EngineRegistry()
    const init = vi.fn()
    const factory = vi.fn((config): EngineAdapter => ({
      config,
      init,
      sendCommand: vi.fn(),
      setPosition: vi.fn(),
      search: vi.fn(),
      stop: vi.fn(),
      newGame: vi.fn(),
      dispose: vi.fn(),
    }))

    registry.registerEngine(FAIRY_STOCKFISH_CONFIG, factory)
    const adapter = registry.createEngine(
      FAIRY_STOCKFISH_CONFIG.id,
      { assetBase: 'http://localhost/', onProgress: vi.fn() },
      { threads: 2, hash: 128 },
    )

    expect(registry.getEngine(FAIRY_STOCKFISH_CONFIG.id)).toBe(FAIRY_STOCKFISH_CONFIG)
    expect(adapter.config).toMatchObject({
      id: 'fairy-stockfish-nnue',
      protocol: 'UCCI',
      threads: 2,
      hash: 128,
    })
    expect(factory).toHaveBeenCalledOnce()
  })

  it('拒绝重复注册和创建未知引擎', () => {
    const registry = new EngineRegistry()
    const factory = vi.fn()
    registry.registerEngine(FAIRY_STOCKFISH_CONFIG, factory)
    expect(() => registry.registerEngine(FAIRY_STOCKFISH_CONFIG, factory)).toThrow('引擎已注册')
    expect(() =>
      registry.createEngine('missing', { assetBase: '/', onProgress: vi.fn() }),
    ).toThrow('未注册的引擎')
  })
})
