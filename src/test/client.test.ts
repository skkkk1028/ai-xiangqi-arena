import { afterEach, describe, expect, it, vi } from 'vitest'
import { UcciEngineClient } from '../engine/client'

class MultiPvWorker {
  static requestedMultiPv: number[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  requestedMultiPv: number | null = null

  postMessage(message: { type: string; searchId?: number; multiPv?: number }) {
    if (message.type === 'init') {
      queueMicrotask(() =>
        this.emit({
          type: 'ready',
          profile: {
            name: 'test',
            version: 'test',
            commit: 'test',
            network: 'test.nnue',
            networkSha256: 'abc',
            threads: 1,
            hashMb: 64,
          },
        }),
      )
    }
    if (message.type === 'search') {
      this.requestedMultiPv = message.multiPv ?? null
      MultiPvWorker.requestedMultiPv.push(message.multiPv ?? -1)
      const searchId = message.searchId!
      queueMicrotask(() => {
        this.emit({ type: 'search-started', searchId })
        this.line('info depth 15 multipv 2 score cp 28 wdl 392 420 188 pv h2e2 h9g7', searchId)
        this.line('info depth 15 multipv 1 score cp 42 wdl 412 420 168 pv b0c2 b9c7', searchId)
        this.line('info depth 15 multipv 3 score cp 7 wdl 372 430 198 pv e3e4 h9g7', searchId)
        this.line('info depth 16 multipv 2 score cp 25 wdl 390 420 190 pv h2e2 h9g7', searchId)
        this.line('info depth 16 multipv 1 score cp 40 wdl 410 420 170 pv b0c2 b9c7', searchId)
        this.line('info depth 16 multipv 3 score cp 5 wdl 370 430 200 pv e3e4 h9g7', searchId)
        this.line('info depth 17 multipv 2 nodes 999999', searchId)
        this.line(
          'info depth 18 multipv 2 score cp 30 upperbound wdl 395 420 185 pv h2e2 h9g7',
          searchId,
        )
        this.line('bestmove b0c2', searchId)
      })
    }
  }

  terminate() {}

  private line(line: string, searchId: number) {
    this.emit({ type: 'line', line, searchId })
  }

  private emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

describe('UCCI MultiPV 客户端', () => {
  afterEach(() => {
    MultiPvWorker.requestedMultiPv = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('分别累计三条候选，并只用第一主变更新实时信息', async () => {
    vi.stubGlobal('Worker', MultiPvWorker)
    const liveRanks: number[] = []
    const client = new UcciEngineClient('http://localhost/', 1, 64, () => undefined)
    await client.init()
    const response = await client.search([], 1_000, {
      multiPv: 3,
      onInfo: (info) => liveRanks.push(info.multipv ?? 1),
    })

    expect(response.bestmove).toBe('b0c2')
    expect(response.candidates.map((candidate) => candidate.multipv)).toEqual([1, 2, 3])
    expect(response.candidates.map((candidate) => candidate.pv[0])).toEqual([
      'b0c2',
      'h2e2',
      'e3e4',
    ])
    expect(response.candidates[1].depth).toBe(16)
    expect(response.candidates[1].previous?.depth).toBe(15)
    expect(response.candidates[0].previousPrincipal?.depth).toBe(15)
    expect(response.info.depth).toBe(16)
    expect(response.info.pv[0]).toBe('b0c2')
    expect(liveRanks).toEqual([1, 1])
    client.dispose()
  })

  it('把连续的4、2、3主变策略原样交给 Worker', async () => {
    vi.stubGlobal('Worker', MultiPvWorker)
    const client = new UcciEngineClient('http://localhost/', 1, 64, () => undefined)
    await client.init()
    await client.search([], 1_000, { multiPv: 4 })
    await client.search([], 1_000, { multiPv: 2 })
    await client.search([], 1_000, { multiPv: 3 })
    expect(MultiPvWorker.requestedMultiPv).toEqual([4, 2, 3])
    client.dispose()
  })

  it('通过统一适配器消息发送命令和局面，初始化携带完整AI配置', async () => {
    const messages: Array<Record<string, unknown>> = []
    class CommandWorker extends MultiPvWorker {
      override postMessage(message: Record<string, unknown>) {
        messages.push(message)
        super.postMessage(message as { type: string; searchId?: number; multiPv?: number })
      }
    }
    vi.stubGlobal('Worker', CommandWorker)
    const client = new UcciEngineClient('http://localhost/', 2, 128, () => undefined)
    await client.init()
    client.sendCommand('isready')
    client.setPosition(['b0c2', 'b9c7'])

    expect(messages[0]).toMatchObject({
      type: 'init',
      config: {
        id: 'fairy-stockfish-nnue',
        engineType: 'fairy-stockfish',
        protocol: 'UCCI',
        threads: 2,
        hash: 128,
      },
    })
    expect(messages.slice(1)).toEqual([
      { type: 'command', command: 'isready' },
      { type: 'set-position', moves: ['b0c2', 'b9c7'] },
    ])
    client.dispose()
  })

  it('搜索超过时限加宽限后发送 stop 并拒绝，避免永久挂起', async () => {
    const messages: string[] = []
    class HangingWorker extends MultiPvWorker {
      override postMessage(message: { type: string; searchId?: number; multiPv?: number }) {
        if (message.type === 'init') super.postMessage(message)
        else {
          messages.push(message.type)
          if (message.type === 'search') {
            queueMicrotask(() =>
              this.onmessage?.({
                data: { type: 'search-started', searchId: message.searchId! },
              } as MessageEvent),
            )
          }
        }
      }
    }
    vi.stubGlobal('Worker', HangingWorker)
    const client = new UcciEngineClient('http://localhost/', 1, 64, () => undefined)
    await client.init()
    vi.useFakeTimers()
    const search = client.search([], 50, { multiPv: 2 })
    const rejection = expect(search).rejects.toThrow('引擎搜索超过')
    await vi.advanceTimersByTimeAsync(5_051)
    await rejection
    expect(messages).toEqual(['search', 'stop'])
    client.dispose()
  })

  it('未 ready 时拒绝搜索，dispose 会结束初始化 Promise', async () => {
    class InitializingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', InitializingWorker)
    const client = new UcciEngineClient('http://localhost/', 1, 64, () => undefined)
    const initialization = client.init()
    const initializationRejection = expect(initialization).rejects.toThrow('初始化已取消')
    await expect(client.search([], 1_000, { multiPv: 2 })).rejects.toThrow('尚未就绪')
    client.dispose()
    await initializationRejection
  })
})
