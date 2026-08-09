import { describe, expect, it } from 'vitest'
import { GoGameEngine } from '../games/go/game-engine'
import { LeelaZeroEngine, type LeelaZeroAnalyzeRequest, type LeelaZeroCapabilities, type LeelaZeroTransport } from '../games/go/ai'

describe('Leela Zero 围棋适配器', () => {
  it('通过统一 AIEngine 契约返回并校验合法着', async () => {
    const transport = new FakeLeelaZeroTransport('D16')
    const engine = new LeelaZeroEngine('leela-black', transport)
    const rules = new GoGameEngine()
    const state = rules.init()
    await engine.initialize({ gameId: 'go', player: 'black' })

    const result = await engine.think({
      state,
      player: 'black',
      legalActions: rules.getLegalMoves(state),
      record: [],
    })

    expect(result.action).toEqual({ row: 3, col: 3 })
    expect(result.analysis).toMatchObject({
      engineId: 'leela-zero',
      winRateAvailable: false,
      requestedVisits: 3200,
      runtimeLabel: 'Native Leela Zero · OpenCL',
    })
    expect(transport.requests).toHaveLength(1)
  })

  it('拒绝本项目规则判定为非法的引擎输出', async () => {
    const transport = new FakeLeelaZeroTransport('D16')
    const engine = new LeelaZeroEngine('leela-white', transport)
    const rules = new GoGameEngine()
    const first = rules.applyMove(rules.init(), { row: 3, col: 3 })
    await engine.initialize({ gameId: 'go', player: 'white' })

    await expect(engine.think({
      state: first,
      player: 'white',
      legalActions: rules.getLegalMoves(first),
      record: first.history,
    })).rejects.toThrow('不符合当前围棋规则')
  })
})

class FakeLeelaZeroTransport implements LeelaZeroTransport {
  requests: LeelaZeroAnalyzeRequest[] = []
  constructor(private readonly move: string) {}
  async initialize(): Promise<LeelaZeroCapabilities> {
    return {
      ready: true,
      engineVersion: 'Leela Zero 0.17',
      modelName: '0e9ea880.gz',
      runtimeBackend: 'native-leela-zero',
      playouts: 3200,
      timeoutMs: 180000,
    }
  }
  async analyze(request: LeelaZeroAnalyzeRequest) {
    this.requests.push(request)
    return {
      requestId: request.requestId,
      move: this.move,
      elapsedMs: 25,
      requestedPlayouts: 3200,
      timedOut: false,
      engineVersion: 'Leela Zero 0.17',
      modelName: '0e9ea880.gz',
    }
  }
  cancel() {}
  dispose() {}
}
