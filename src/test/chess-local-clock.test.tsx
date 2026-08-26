import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceChessLocalClock,
  CHESS_LOCAL_TIME_CONTROLS,
  createChessLocalClock,
  useLocalChessMatch,
} from '../games/chess/useLocalChessMatch'

describe('国际象棋同屏双人计时', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('提供三档对称时间并默认采用标准档', () => {
    expect(CHESS_LOCAL_TIME_CONTROLS).toMatchObject({
      rapid: { totalMs: 300_000, moveMs: 30_000 },
      standard: { totalMs: 900_000, moveMs: 60_000 },
      deep: { totalMs: 1_800_000, moveMs: 120_000 },
    })
    const { result } = renderHook(() => useLocalChessMatch())
    expect(result.current.timeControlId).toBe('standard')
    expect(result.current.clock).toEqual({ totals: { w: 900_000, b: 900_000 }, moveRemainingMs: 60_000 })
  })

  it('按先到的总时或单步时限判负', () => {
    const moveClock = advanceChessLocalClock({ totals: { w: 100_000, b: 100_000 }, moveRemainingMs: 5_000 }, 'w', 5_000)
    expect(moveClock.result).toEqual({ reason: 'move-timeout', winner: 'b', loser: 'w' })
    const totalClock = advanceChessLocalClock({ totals: { w: 4_000, b: 100_000 }, moveRemainingMs: 8_000 }, 'w', 4_000)
    expect(totalClock.result).toEqual({ reason: 'total-timeout', winner: 'b', loser: 'w' })
    expect(createChessLocalClock(CHESS_LOCAL_TIME_CONTROLS.rapid).totals).toEqual({ w: 300_000, b: 300_000 })
  })

  it('开始后只扣当前方，暂停冻结，落子后切换并重置单步时钟', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useLocalChessMatch())
    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current.clock.totals.w).toBe(898_000)
    expect(result.current.clock.totals.b).toBe(900_000)
    expect(result.current.clock.moveRemainingMs).toBe(58_000)

    act(() => result.current.pause())
    const frozen = result.current.clock
    act(() => vi.advanceTimersByTime(5_000))
    expect(result.current.clock).toEqual(frozen)

    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(1_000))
    act(() => result.current.playMove({ from: 'e2', to: 'e4' }))
    expect(result.current.state.turn).toBe('b')
    expect(result.current.clock.totals.w).toBe(897_000)
    expect(result.current.clock.totals.b).toBe(900_000)
    expect(result.current.clock.moveRemainingMs).toBe(60_000)
  })

  it('单步超时后锁定棋局并拒绝同一时刻的落子', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useLocalChessMatch())
    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.runState).toBe('finished')
    expect(result.current.clockResult).toEqual({ reason: 'move-timeout', winner: 'b', loser: 'w' })
    act(() => result.current.playMove({ from: 'e2', to: 'e4' }))
    expect(result.current.state.history).toHaveLength(0)
  })

  it('棋盘将死后停止计时且拒绝后续落子', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useLocalChessMatch())
    act(() => result.current.start())
    for (const move of [
      { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
    ] as const) act(() => result.current.playMove(move))
    expect(result.current.state.result?.reason).toBe('checkmate')
    expect(result.current.runState).toBe('finished')
    const history = result.current.state.history
    act(() => vi.advanceTimersByTime(10_000))
    act(() => result.current.playMove({ from: 'a2', to: 'a3' }))
    expect(result.current.state.history).toBe(history)
  })
})
