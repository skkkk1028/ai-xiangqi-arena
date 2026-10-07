import { StrictMode, type PropsWithChildren } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChessArchive } from '../games/chess/archive'
import { chessLibrary, type ChessLibraryGameV1 } from '../games/chess/library'
import { writeChessLiveReturn } from '../games/chess/live-return'
import { replayChessState } from '../games/chess/rules'
import { useChessMatch } from '../games/chess/useChessMatch'
import { useLocalChessMatch } from '../games/chess/useLocalChessMatch'

const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>
const archive = createChessArchive({ state: replayChessState(['e2e4']), players: [
  { seat: 'w', kind: 'human', name: '白方' }, { seat: 'b', kind: 'human', name: '黑方' },
] })

afterEach(() => { cleanup(); writeChessLiveReturn(null); vi.restoreAllMocks() })

describe('从复盘返回原对局', () => {
  it('StrictMode 下恢复本地双人的同一记录、棋局和冻结时钟', async () => {
    const saved: ChessLibraryGameV1 = {
      id: 'local-original', title: '双人原局', favorite: false, mode: 'local', archive,
      configuration: { timeControl: 'rapid' },
      clock: { controlId: 'rapid', totals: { w: 275_000, b: 293_000 }, moveRemainingMs: 23_000, runState: 'paused', result: null },
    }
    vi.spyOn(chessLibrary, 'get').mockResolvedValue(saved)
    vi.spyOn(chessLibrary, 'migrateLatest').mockResolvedValue()
    writeChessLiveReturn({ id: saved.id, mode: 'local', phase: 'resume' })
    const { result } = renderHook(() => useLocalChessMatch(), { wrapper })
    await waitFor(() => expect(result.current.libraryId).toBe(saved.id))
    expect(result.current.state.history.map((move) => move.uci)).toEqual(['e2e4'])
    expect(result.current.clock).toEqual({ totals: { w: 275_000, b: 293_000 }, moveRemainingMs: 23_000 })
    expect(result.current.timeControlId).toBe('rapid')
    expect(result.current.runState).toBe('paused')
  })

  it('恢复人机对局时保留执色和搜索档位', async () => {
    const saved: ChessLibraryGameV1 = {
      id: 'human-original', title: '人机原局', favorite: false, mode: 'human',
      archive: createChessArchive({ state: replayChessState(['e2e4']), players: [
        { seat: 'w', kind: 'ai', name: 'Stockfish 18' }, { seat: 'b', kind: 'human', name: '真人' },
      ] }),
      configuration: { budget: 'fast', humanColor: 'b', humanEngine: 'stockfish-18' },
    }
    vi.spyOn(chessLibrary, 'get').mockResolvedValue(saved)
    vi.spyOn(chessLibrary, 'migrateLatest').mockResolvedValue()
    writeChessLiveReturn({ id: saved.id, mode: 'human', phase: 'resume' })
    const { result } = renderHook(() => useChessMatch({ mode: 'human' }), { wrapper })
    await waitFor(() => expect(result.current.libraryId).toBe(saved.id))
    expect(result.current.state.history.map((move) => move.uci)).toEqual(['e2e4'])
    expect(result.current.humanColor).toBe('b')
    expect(result.current.budgetId).toBe('fast')
    expect(result.current.runState).toBe('paused')
  })
})
