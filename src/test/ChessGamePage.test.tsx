import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChessGamePage } from '../games/chess/ChessGamePage'
import { CHESS_SEARCH_PROFILES } from '../games/chess/ai-engine'
import { replayChessState } from '../games/chess/rules'

const hook = vi.hoisted(() => ({ value: null as any }))

vi.mock('../games/chess/useChessMatch', () => ({ useChessMatch: () => hook.value }))

describe('国际象棋终局界面', () => {
  beforeEach(() => {
    hook.value = {
      state: replayChessState(['f2f3', 'e7e5', 'g2g4', 'd8h4']),
      budgetId: 'standard',
      profile: CHESS_SEARCH_PROFILES.standard,
      runState: 'finished',
      guess: { phase: 'off', round: null, stats: { answered: 0, hits: 0, streak: 0, longest: 0 } },
      guessBusy: false,
      suspendForStudy: vi.fn(),
      analyses: {},
      liveInfo: {},
      seats: { w: null, b: null },
      notice: '对局结束。',
      error: null,
      start: vi.fn(),
      pause: vi.fn(),
      step: vi.fn(),
      newGame: vi.fn(),
      restore: vi.fn(),
      changeBudget: vi.fn(),
      arena: false,
      arenaEngines: { w: 'stockfish-18', b: 'obsidian-16' },
      archivePlayers: [],
      changeArenaEngine: vi.fn(),
    }
  })

  afterEach(cleanup)

  it('将死后禁用继续和单步，不再调用引擎入口', () => {
    render(<ChessGamePage />)
    const finished = screen.getByRole('button', { name: '对局已结束' })
    const step = screen.getByRole('button', { name: '单步' })
    expect(finished).toBeDisabled()
    expect(step).toBeDisabled()
    fireEvent.click(finished)
    fireEvent.click(step)
    expect(hook.value.start).not.toHaveBeenCalled()
    expect(hook.value.step).not.toHaveBeenCalled()
    expect(screen.getAllByText('黑方将死').length).toBeGreaterThan(0)
    expect(screen.queryByText('引擎故障已暂停')).not.toBeInTheDocument()
  })
})
