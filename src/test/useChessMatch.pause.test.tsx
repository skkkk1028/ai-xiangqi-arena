import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineSearchResponse } from '../game/types'
import { useChessMatch } from '../games/chess/useChessMatch'

const engineMock = vi.hoisted(() => {
  const adapters: any[] = []
  const createEngine = vi.fn((_gameId: string, engineId: string) => {
    const pending: Array<{ resolve: (value: EngineSearchResponse) => void; reject: (reason: unknown) => void }> = []
    const adapter = {
      config: { id: engineId, name: engineId, protocol: 'UCI' },
      pending,
      init: vi.fn(async () => ({ id: engineId, engineType: 'stockfish', protocol: 'UCI', name: engineId, version: 'test', threads: 1, hashMb: 64 })),
      sendCommand: vi.fn(), setPosition: vi.fn(), newGame: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
      search: vi.fn(() => new Promise<EngineSearchResponse>((resolve, reject) => pending.push({ resolve, reject }))),
    }
    adapters.push(adapter)
    return adapter
  })
  return { adapters, createEngine }
})

vi.mock('../engine/default-registry', () => ({ engineRegistry: { createEngine: engineMock.createEngine } }))
vi.mock('../engine/support', () => ({ detectEngineSupport: () => ({ supported: true, mobile: false, threads: 2, hashMb: 64 }) }))
vi.mock('../games/chess/audio', () => ({ playChessMoveSound: vi.fn() }))

describe('国际象棋暂停竞态', () => {
  beforeEach(() => {
    engineMock.adapters.length = 0
    engineMock.createEngine.mockClear()
    localStorage.clear()
  })
  afterEach(cleanup)

  it.each(['theatre', 'arena'] as const)('%s 接管共享暂停任务，等待旧搜索结束后返回稳定快照', async (mode) => {
    const { result } = renderHook(() => useChessMatch({mode}))
    if (mode === 'theatre') act(() => result.current.changeBudget('professional'))
    act(() => result.current.start())
    await waitFor(() => expect(engineMock.adapters[0]?.pending).toHaveLength(1))
    let first!: Promise<import('../games/chess/types').ChessGameState>
    let second!: typeof first
    act(() => { first = result.current.suspendForStudy(); second = result.current.suspendForStudy(); result.current.start() })
    expect(first).toBe(second)
    let complete = false
    void first.then(() => { complete = true })
    await act(async () => { await Promise.resolve() })
    expect(complete).toBe(false)
    act(() => engineMock.adapters[0].pending[0].resolve(response('e2e4')))
    let snapshot!: Awaited<typeof first>
    await act(async () => { snapshot = await first })
    expect(snapshot.history).toHaveLength(0)
    expect(result.current.state).toBe(snapshot)
    expect(result.current.runState).toBe('paused')
    expect(engineMock.adapters[0].search).toHaveBeenCalledTimes(1)
  })

  it('双人格专业搜索暂停后忽略晚返回结果，恢复后只走一手', async () => {
    const { result } = renderHook(() => useChessMatch())
    act(() => result.current.changeBudget('professional'))
    act(() => result.current.start())
    await waitFor(() => expect(engineMock.adapters[0]?.pending).toHaveLength(1))
    const fen = result.current.state.fen

    await act(async () => { await result.current.pause() })
    act(() => engineMock.adapters[0].pending[0].resolve(response('e2e4')))
    await waitFor(() => expect(result.current.runState).toBe('paused'))
    expect(result.current.state.fen).toBe(fen)
    expect(result.current.state.history).toHaveLength(0)
    expect(result.current.analyses).toEqual({})
    expect(localStorage.getItem('ai-board-games:latest:chess:v1')).toBeNull()

    act(() => result.current.start())
    await waitFor(() => expect(engineMock.adapters[0].pending).toHaveLength(2))
    act(() => engineMock.adapters[0].pending[1].resolve(response('e2e4')))
    await waitFor(() => expect(result.current.state.history).toHaveLength(1))
    await act(async () => { await result.current.pause() })
    expect(result.current.state.history[0].uci).toBe('e2e4')
  })

  it('多引擎竞技场暂停后忽略原生引擎的晚返回结果', async () => {
    const { result } = renderHook(() => useChessMatch({ mode: 'arena' }))
    act(() => result.current.start())
    await waitFor(() => expect(engineMock.adapters[0]?.pending).toHaveLength(1))
    const fen = result.current.state.fen
    await act(async () => { await result.current.pause() })
    act(() => engineMock.adapters[0].pending[0].resolve(response('e2e4')))
    await waitFor(() => expect(result.current.runState).toBe('paused'))
    expect(result.current.state.fen).toBe(fen)
    expect(result.current.state.history).toHaveLength(0)
    expect(result.current.analyses).toEqual({})
    expect(localStorage.getItem('ai-board-games:latest:chess-arena:v1')).toBeNull()
  })
})

function response(bestmove: string): EngineSearchResponse {
  const info = { depth: 12, nodes: 1000, nps: 10_000, elapsedMs: 100, score: { kind: 'cp' as const, value: 20 }, wdl: null, pv: [bestmove] }
  return { bestmove, info, candidates: [{ ...info, multipv: 1 }] }
}
