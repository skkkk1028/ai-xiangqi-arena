import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChessLocalPage, formatClock } from '../games/chess/ChessLocalPage'
import { createChessState } from '../games/chess/rules'
import { CHESS_LOCAL_TIME_CONTROLS } from '../games/chess/useLocalChessMatch'

const hook = vi.hoisted(() => ({ value: null as any }))
vi.mock('../games/chess/useLocalChessMatch', async (original) => ({ ...(await original()), useLocalChessMatch: () => hook.value }))

describe('国际象棋同屏双人页面', () => {
  afterEach(cleanup)

  it('显示双方总时、单步时间和三档计时', () => {
    hook.value = value()
    render(<ChessLocalPage />)
    expect(screen.getByRole('heading', { name: '双人对战' })).toBeInTheDocument()
    expect(screen.getByLabelText('白方总时间')).toHaveTextContent('15:00')
    expect(screen.getByLabelText('黑方单步时间')).toHaveTextContent('1:00')
    fireEvent.click(screen.getByRole('button', { name: CHESS_LOCAL_TIME_CONTROLS.rapid.label }))
    expect(hook.value.changeTimeControl).toHaveBeenCalledWith('rapid')
  })

  it('运行时允许当前方通过棋盘提交着法并可暂停', () => {
    hook.value = value({ runState: 'running' })
    render(<ChessLocalPage />)
    fireEvent.click(screen.getByRole('gridcell', { name: /e2/ }))
    fireEvent.click(screen.getByRole('gridcell', { name: /^e4/ }))
    expect(hook.value.playMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' })
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(hook.value.pause).toHaveBeenCalled()
  })

  it('低于十秒时显示十分之一秒', () => {
    expect(formatClock(9_480)).toBe('0:09.4')
    expect(formatClock(0)).toBe('0:00.0')
  })
})

function value(overrides = {}) {
  return {
    state: { ...createChessState(0), openingName: '标准初始局面' },
    clock: { totals: { w: 900_000, b: 900_000 }, moveRemainingMs: 60_000 },
    clockResult: null,
    runState: 'ready',
    notice: '准备开始。',
    timeControlId: 'standard',
    timeControl: CHESS_LOCAL_TIME_CONTROLS.standard,
    start: vi.fn(), pause: vi.fn(), playMove: vi.fn(), newGame: vi.fn(), changeTimeControl: vi.fn(),
    ...overrides,
  }
}
