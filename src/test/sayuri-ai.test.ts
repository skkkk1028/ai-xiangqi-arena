import { describe, expect, it } from 'vitest'
import { GoGameEngine } from '../games/go/game-engine'
import { GO_AI_ENGINES, SayuriEngine, type SayuriAnalyzeRequest, type SayuriCapabilities, type SayuriTransport } from '../games/go/ai'

describe('Sayuri 围棋适配器', () => {
  it('通过统一 AIEngine 契约返回并校验合法着', async () => {
    const transport = new FakeSayuriTransport('D16')
    const engine = new SayuriEngine('sayuri-black', transport)
    const rules = new GoGameEngine()
    const state = rules.init()
    await engine.initialize({ gameId: 'go', player: 'black' })

    const result = await engine.think({
      state,
      player: 'black',
      legalActions: rules.getLegalActions(state),
      record: [],
    })

    expect(result.action).toEqual({ row: 3, col: 3 })
    expect(result.analysis).toMatchObject({
      engineId: 'sayuri',
      winRateAvailable: false,
      requestedVisits: 250,
      runtimeLabel: 'Native Sayuri · CUDA 12',
    })
    expect(transport.requests).toHaveLength(1)
  })

  it('拒绝非法输出，并枚举三个引擎的全部九种有序组合', async () => {
    const transport = new FakeSayuriTransport('I9')
    const engine = new SayuriEngine('sayuri-black', transport)
    const rules = new GoGameEngine()
    const state = rules.init()
    await engine.initialize({ gameId: 'go', player: 'black' })
    await expect(engine.think({
      state, player: 'black', legalActions: rules.getLegalActions(state), record: [],
    })).rejects.toThrow('无效坐标')

    const combinations = GO_AI_ENGINES.flatMap((black) => GO_AI_ENGINES.map((white) => `${black.id}:${white.id}`))
    expect(new Set(combinations).size).toBe(9)
    expect(combinations).toContain('katago:sayuri')
    expect(combinations).toContain('sayuri:katago')
    expect(combinations).toContain('sayuri:sayuri')
  })
})

class FakeSayuriTransport implements SayuriTransport {
  requests: SayuriAnalyzeRequest[] = []
  constructor(private readonly move: string) {}
  async initialize(): Promise<SayuriCapabilities> {
    return {
      ready: true,
      engineVersion: 'Sayuri 0.10.0',
      modelName: 'test.bin.txt',
      runtimeBackend: 'native-sayuri',
      playouts: 250,
      timeoutMs: 180_000,
      threads: 16,
      batchSize: 8,
    }
  }
  async analyze(request: SayuriAnalyzeRequest) {
    this.requests.push(request)
    return {
      requestId: request.requestId,
      move: this.move,
      elapsedMs: 25,
      requestedPlayouts: 250,
      timedOut: false,
      engineVersion: 'Sayuri 0.10.0',
      modelName: 'test.bin.txt',
    }
  }
  cancel() {}
  dispose() {}
}
