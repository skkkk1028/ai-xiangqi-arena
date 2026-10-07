import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChessStudyPage } from '../games/chess/ChessStudyPage'
import { createChessArchive } from '../games/chess/archive'
import { chessLibrary, type ChessLibraryGameV1 } from '../games/chess/library'
import { replayChessState } from '../games/chess/rules'
import { engineRegistry } from '../engine/default-registry'
import type { EngineAdapter } from '../engine/adapter'
import type { EngineSearchResponse } from '../game/types'

const game: ChessLibraryGameV1 = {
  id: 'original', title: '原局', favorite: false, mode: 'local', configuration: {},
  archive: createChessArchive({ state: replayChessState(['e2e4']), players: [
    { seat: 'w', kind: 'human', name: '甲' }, { seat: 'b', kind: 'human', name: '乙' },
  ] }),
}

beforeEach(() => {
  vi.spyOn(chessLibrary, 'get').mockResolvedValue(game)
  vi.spyOn(chessLibrary, 'analyses').mockResolvedValue([])
  vi.spyOn(chessLibrary, 'save').mockResolvedValue()
  vi.spyOn(chessLibrary, 'saveAnalysis').mockResolvedValue()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('国际象棋复盘会话', () => {
  it('键盘逐手定位与棋盘手数保持一致', async () => {
    render(<ChessStudyPage gameId="original" />)
    await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('1'))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('slider')).toHaveValue('0')
    fireEvent.keyDown(window, { key: 'End' })
    expect(screen.getByRole('slider')).toHaveValue('1')
  })

  it('StrictMode 离开页面后取消在途分析，不保存迟到结果', async () => {
    let resolveSearch!: (value: EngineSearchResponse) => void
    const adapter = {
      init: vi.fn().mockResolvedValue({ id: 'stockfish-18-full', name: 'Stockfish 18', version: '18', threads: 1, hashMb: 64 }),
      search: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve })),
      stop: vi.fn(), dispose: vi.fn(),
    } as unknown as EngineAdapter
    vi.spyOn(engineRegistry, 'createEngine').mockReturnValue(adapter)
    const view = render(<StrictMode><ChessStudyPage gameId="original" /></StrictMode>)
    await waitFor(() => expect(screen.getByRole('button', { name: '分析本手' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '分析本手' }))
    await waitFor(() => expect(adapter.search).toHaveBeenCalled())
    view.unmount()
    await act(async () => resolveSearch({ bestmove: 'e2e4', info: { depth: 10, nodes: 100, nps: 10, elapsedMs: 3000, score: { kind: 'cp', value: 20 }, wdl: null, pv: ['e2e4'] }, candidates: [] }))
    expect(chessLibrary.saveAnalysis).not.toHaveBeenCalled()
    expect(adapter.stop).toHaveBeenCalled()
    expect(adapter.dispose).toHaveBeenCalled()
  })

  it('重试后创建独立练习记录，原局棋谱不变', async () => {
    render(<ChessStudyPage gameId="original" />)
    await waitFor(() => expect(screen.getByRole('button', { name: '重试这一手' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '重试这一手' }))
    fireEvent.click(screen.getByRole('gridcell', { name: /d2 白方p/ }))
    fireEvent.click(screen.getByRole('gridcell', { name: /d4 可落子/ }))
    fireEvent.click(screen.getByRole('button', { name: '执黑' }))
    await waitFor(() => expect(chessLibrary.save).toHaveBeenCalled())
    const saved = vi.mocked(chessLibrary.save).mock.calls.at(-1)![0]
    expect(saved.id).not.toBe(game.id)
    expect(saved.mode).toBe('practice')
    expect(saved.source).toEqual({ gameId: game.id, ply: 0 })
    expect(saved.archive.moves).toEqual(['d2d4'])
    expect(game.archive.moves).toEqual(['e2e4'])
  })
})
