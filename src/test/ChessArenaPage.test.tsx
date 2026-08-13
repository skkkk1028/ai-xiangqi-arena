import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChessArenaPage } from '../games/chess/ChessArenaPage'
import { createChessState } from '../games/chess/rules'
import { CHESS_ARENA_PROFILES } from '../games/chess/useChessMatch'

const hook = vi.hoisted(() => ({ value: null as any }))
vi.mock('../games/chess/useChessMatch', async (original) => ({ ...(await original()), useChessMatch: () => hook.value }))

describe('国际象棋多引擎竞技场', () => {
  afterEach(cleanup)
  it('允许分别选择双方引擎并显示未认证状态', () => {
    hook.value = value()
    render(<ChessArenaPage />)
    fireEvent.change(screen.getByLabelText('白方 AI 引擎'), { target: { value: 'fairy-stockfish-chess' } })
    expect(hook.value.changeArenaEngine).toHaveBeenCalledWith('w', 'fairy-stockfish-chess')
    expect(screen.getByText(/尚未通过项目内 ±50 Elo 认证/)).toBeInTheDocument()
  })
  it('开赛后锁定引擎配置', () => {
    hook.value = value({ runState: 'thinking' })
    render(<ChessArenaPage />)
    expect(screen.getByLabelText('白方 AI 引擎')).toBeDisabled()
    expect(screen.getByLabelText('黑方 AI 引擎')).toBeDisabled()
  })
})

function value(overrides = {}) { return { state: createChessState(2), budgetId: 'standard', profile: CHESS_ARENA_PROFILES.standard, runState: 'ready', analyses: {}, liveInfo: {}, seats: { w: null, b: null }, archivePlayers: [], notice: '配置完成。', error: null, arena: true, arenaEngines: { w: 'stockfish-18', b: 'obsidian-16' }, start: vi.fn(), pause: vi.fn(), step: vi.fn(), newGame: vi.fn(), restore: vi.fn(), changeBudget: vi.fn(), changeArenaEngine: vi.fn(), ...overrides } }
