import { describe, expect, it, vi } from 'vitest'
import { GoGameEngine } from '../games/go/game-engine'
import {
  KATAGO_CHINESE_PSK_RULES,
  KataGoEngine,
  KataGoMatchAnalysisStore,
  goMoveToGtp,
  goPointToGtp,
  gtpToGoMove,
  kataGoRuntimeBackendLabel,
  readNdjsonEvents,
  type KataGoAnalyzeOptions,
  type KataGoAnalyzeRequest,
  type KataGoCapabilities,
  type KataGoTransport,
  type KataGoWireAnalysisEvent,
} from '../games/go/ai'
import type { GoMove } from '../games/go/types'

const CAPABILITIES: KataGoCapabilities = {
  ready: true,
  engineVersion: '1.16-test',
  modelName: 'test-model.bin.gz',
  runtimeBackend: 'native-katago',
  requestedBackend: 'native-katago',
  backendFallback: false,
  backendFallbackReason: null,
  modelFallback: false,
  modelFallbackReason: null,
  profiles: {
    fast: { maxVisits: 2_000, timeoutMs: 30_000 },
    strong: { maxVisits: 20_000, timeoutMs: 180_000 },
  },
}

class MockTransport implements KataGoTransport {
  readonly initialize = vi.fn(async () => CAPABILITIES)
  readonly requests: KataGoAnalyzeRequest[] = []
  readonly cancel = vi.fn()
  readonly dispose = vi.fn()
  events: KataGoWireAnalysisEvent[] = []

  async analyze(request: KataGoAnalyzeRequest, options?: KataGoAnalyzeOptions) {
    this.requests.push(request)
    if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const events = [...this.events]
    for (const event of events) options?.onUpdate?.(event)
    const final = [...events].reverse().find((event) => event.stage === 'final')
    if (!final) throw new Error('missing final')
    return final
  }
}

function analysisEvent(
  requestId: string,
  move: string,
  winrate: number,
  stage: 'partial' | 'final' = 'final',
): KataGoWireAnalysisEvent {
  return {
    type: 'analysis',
    stage,
    requestId,
    engineVersion: '1.16-test',
    modelName: 'test-model.bin.gz',
    profile: 'fast',
    elapsedMs: stage === 'final' ? 120 : 40,
    requestedVisits: 2_000,
    runtimeBackend: 'native-katago',
    requestedBackend: 'native-katago',
    backendFallback: false,
    backendFallbackReason: null,
    modelFallback: false,
    modelFallbackReason: null,
    timedOut: false,
    truncated: false,
    stopReason: stage === 'final' ? 'visit-limit' : 'in-progress',
    root: { winrate, scoreLead: 2.5, visits: stage === 'final' ? 200 : 40 },
    candidates: [
      { move, order: 0, visits: 180, prior: 0.2, winrate, scoreLead: 2.5, pv: [move, 'Q4'] },
      { move: 'C3', order: 1, visits: 20, prior: 0.1, winrate: winrate - 0.02, scoreLead: 1.7, pv: ['C3'] },
    ],
  }
}

describe('KataGo 围棋 AI 适配器', () => {
  it('显示四种实际运行后端的明确名称', () => {
    expect(kataGoRuntimeBackendLabel('browser-webgpu')).toBe('Browser WebGPU')
    expect(kataGoRuntimeBackendLabel('browser-wasm')).toBe('Browser WASM')
    expect(kataGoRuntimeBackendLabel('browser-cpu')).toBe('CPU fallback')
    expect(kataGoRuntimeBackendLabel('native-katago')).toBe('Native KataGo · OpenCL')
  })

  it('battle-matched 是独立请求档位，不改变 fast/strong 类型', async () => {
    const game = new GoGameEngine()
    const state = game.init()
    const transport = new MockTransport()
    const ai = new KataGoEngine('battle-katago', { transport, profile: 'battle-matched' })
    await ai.initialize({ gameId: 'go', player: 'black' })
    transport.analyze = vi.fn(async (request) => {
      transport.requests.push(request)
      return {
        ...analysisEvent(request.requestId, 'D16', 0.5),
        profile: 'battle-matched' as const,
        requestedVisits: 250,
      }
    })
    const result = await ai.think({
      state, player: 'black', legalActions: game.getLegalActions(state), record: [],
    })
    expect(transport.requests[0].profile).toBe('battle-matched')
    expect(result.analysis?.profileLabel).toBe('BATTLE MATCHED · 250')
  })

  it('在 GTP 坐标中跳过 I 列并支持 pass', () => {
    expect(goPointToGtp({ row: 15, col: 3 })).toBe('D4')
    expect(goPointToGtp({ row: 3, col: 8 })).toBe('J16')
    expect(gtpToGoMove('T1')).toEqual({ row: 18, col: 18 })
    expect(gtpToGoMove('pass')).toEqual({ kind: 'pass' })
    expect(goMoveToGtp({ kind: 'pass' })).toBe('pass')
    expect(() => gtpToGoMove('I9')).toThrow('无效坐标')
  })

  it('序列化完整棋谱、固定中国面积规则，并解析候选和实时分析', async () => {
    const game = new GoGameEngine()
    let state = game.initializeGame()
    state = game.executeAction(state, { row: 15, col: 3 })
    const transport = new MockTransport()
    const ai = new KataGoEngine('white-katago', { transport })
    await ai.init({ gameId: 'go', player: 'white' })
    const partials: number[] = []
    ai.subscribe((analysis) => partials.push(analysis.visits))

    transport.analyze = vi.fn(async (request, options) => {
      transport.requests.push(request)
      const partial = analysisEvent(request.requestId, 'Q16', 0.55, 'partial')
      const final = analysisEvent(request.requestId, 'Q16', 0.54)
      options?.onUpdate?.(partial)
      options?.onUpdate?.(final)
      return final
    })
    const result = await ai.think({
      state,
      player: 'white',
      legalActions: game.getLegalActions(state),
      record: game.getRecord(state),
    })

    expect(transport.requests[0]).toMatchObject({
      gameId: 'go',
      player: 'white',
      boardSize: 19,
      komi: 7.5,
      rules: KATAGO_CHINESE_PSK_RULES,
      moves: [['B', 'D4']],
    })
    expect(result.action).toEqual({ row: 3, col: 15 })
    expect(result.analysis).toMatchObject({
      blackWinRate: 0.54,
      winRateChange: null,
      visits: 200,
      pvNotation: ['Q16', 'Q4'],
    })
    expect(result.analysis!.whiteWinRate).toBeCloseTo(0.46)
    expect(result.analysis!.currentPlayerWinRate).toBeCloseTo(0.46)
    expect(partials).toEqual([40, 200])
  })

  it('两个座位共享上一局面基线，并从当前行棋方视角计算胜率变化', async () => {
    const game = new GoGameEngine()
    const store = new KataGoMatchAnalysisStore()
    const transport = new MockTransport()
    const black = new KataGoEngine('black-katago', { transport, analysisStore: store })
    const white = new KataGoEngine('white-katago', { transport, analysisStore: store })
    await black.initialize({ gameId: 'go', player: 'black' })
    await white.initialize({ gameId: 'go', player: 'white' })

    let state = game.initializeGame()
    transport.analyze = vi.fn(async (request) => analysisEvent(request.requestId, 'D16', 0.6))
    const blackTurn = await black.think({
      state,
      player: 'black',
      legalActions: game.getLegalActions(state),
      record: state.history,
    })
    state = game.executeAction(state, blackTurn.action)

    transport.analyze = vi.fn(async (request) => analysisEvent(request.requestId, 'Q16', 0.55))
    const whiteTurn = await white.think({
      state,
      player: 'white',
      legalActions: game.getLegalActions(state),
      record: state.history,
    })

    expect(blackTurn.analysis!.winRateChange).toBeNull()
    expect(whiteTurn.analysis!.currentPlayerWinRate).toBeCloseTo(0.45)
    expect(whiteTurn.analysis!.winRateChange).toBeCloseTo(0.05)
  })

  it('第一候选非法时继续采用后续合法候选，并同步主变化图', async () => {
    const game = new GoGameEngine()
    const state = game.initializeGame()
    const transport = new MockTransport()
    const ai = new KataGoEngine('black-katago', { transport })
    await ai.initialize({ gameId: 'go', player: 'black' })
    transport.analyze = vi.fn(async (request) => {
      const event = analysisEvent(request.requestId, 'D16', 0.5)
      return {
        ...event,
        candidates: [
          ...event.candidates.slice(0, 1),
          { move: 'E15', order: 1, visits: 20, prior: 0.1, winrate: 0.48, scoreLead: 1.2, pv: ['E15', 'Q4'] },
        ],
      }
    })

    const result = await ai.think({
      state,
      player: 'black',
      legalActions: [{ row: 4, col: 4 }] satisfies GoMove[],
      record: [],
    })

    expect(result.action).toEqual({ row: 4, col: 4 })
    expect(result.analysis?.pvNotation).toEqual(['E15', 'Q4'])
  })

  it('所有 KataGo 候选都非法时拒绝执行', async () => {
    const game = new GoGameEngine()
    const state = game.initializeGame()
    const transport = new MockTransport()
    const ai = new KataGoEngine('black-katago', { transport })
    await ai.initialize({ gameId: 'go', player: 'black' })
    transport.analyze = vi.fn(async (request) => analysisEvent(request.requestId, 'D16', 0.5))

    await expect(ai.think({
      state,
      player: 'black',
      legalActions: [{ row: 4, col: 4 }] satisfies GoMove[],
      record: [],
    })).rejects.toThrow('已拒绝执行')
  })

  it('可解析被任意分块的 NDJSON 流', async () => {
    const encoder = new TextEncoder()
    const payload = '{"type":"error","code":"A","message":"one"}\n' +
      '{"type":"error","code":"B","message":"two"}\n'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0, 17)))
        controller.enqueue(encoder.encode(payload.slice(17)))
        controller.close()
      },
    })
    const events = []
    for await (const event of readNdjsonEvents(stream)) events.push(event)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ code: 'B', message: 'two' })
  })
})
