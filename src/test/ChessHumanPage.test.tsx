import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChessHumanPage } from '../games/chess/ChessHumanPage'
import { CHESS_ARENA_PROFILES } from '../games/chess/useChessMatch'
import { createChessState } from '../games/chess/rules'

const hook = vi.hoisted(() => ({ value: null as any }))
vi.mock('../games/chess/useChessMatch', async (original) => ({ ...(await original()), useChessMatch: () => hook.value }))

describe('国际象棋人机入口', () => {
  afterEach(cleanup)

  it('允许选择执子颜色、AI 对手和思考强度', () => {
    hook.value = value()
    render(<ChessHumanPage />)
    fireEvent.change(screen.getByLabelText('真人执子方'), { target: { value: 'b' } })
    fireEvent.change(screen.getByLabelText('AI 对手'), { target: { value: 'obsidian-16' } })
    fireEvent.click(screen.getByRole('button', { name: CHESS_ARENA_PROFILES.deep.label }))
    expect(hook.value.changeHumanColor).toHaveBeenCalledWith('b')
    expect(hook.value.changeHumanEngine).toHaveBeenCalledWith('obsidian-16')
    expect(hook.value.changeBudget).toHaveBeenCalledWith('deep')
  })

  it('轮到真人时允许点击棋盘提交合法着法', () => {
    hook.value = value({ runState: 'paused' })
    render(<ChessHumanPage />)
    fireEvent.click(screen.getByRole('gridcell', { name: /e2/ }))
    fireEvent.click(screen.getByRole('gridcell', { name: /^e4/ }))
    expect(hook.value.playHumanMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' })
  })
})

function value(overrides = {}) {
  return {
    state: createChessState(2),
    budgetId: 'standard',
    profile: CHESS_ARENA_PROFILES.standard,
    runState: 'ready',
    human: true,
    humanColor: 'w',
    humanEngine: 'stockfish-18',
    arena: false,
    arenaEngines: { w: 'stockfish-18', b: 'obsidian-16' },
    analyses: {},
    liveInfo: {},
    seats: { w: null, b: null },
    archivePlayers: [],
    notice: '配置完成。',
    error: null,
    start: vi.fn(),
    pause: vi.fn(),
    step: vi.fn(),
    newGame: vi.fn(),
    restore: vi.fn(),
    changeBudget: vi.fn(),
    changeArenaEngine: vi.fn(),
    changeHumanColor: vi.fn(),
    changeHumanEngine: vi.fn(),
    playHumanMove: vi.fn(),
    ...overrides,
  }
}
