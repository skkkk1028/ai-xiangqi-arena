import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineSearchResponse } from '../game/types'
import { useChessMatch } from '../games/chess/useChessMatch'
import { ChessGamePage } from '../games/chess/ChessGamePage'
import { ChessLibraryActions } from '../games/chess/ChessLibraryActions'
import { ChessLibraryPage } from '../games/chess/ChessLibraryPage'
import { ChessBoard } from '../games/chess/ChessBoard'
import { ChessGameEngine, createChessState, parseChessUci, replayChessState, actionToUci } from '../games/chess/rules'
import { createChessArchive } from '../games/chess/archive'
import { chessLibrary } from '../games/chess/library'
import { readChessLiveReturn, writeChessLiveReturn } from '../games/chess/live-return'
import { emptyChessGuessStats, nextChessGuessStats } from '../games/chess/guess'
import { CHESS_OPENINGS } from '../games/chess/openings'

const engineMock = vi.hoisted(() => {
  const adapters: any[] = []
  let blockInit = false
  const initResolvers: Array<() => void> = []
  const createEngine = vi.fn((_game: string, id: string, callbacks: any) => {
    const pending: Array<{ resolve: (result: EngineSearchResponse) => void; reject: (error: Error) => void }> = []
    const adapter = {
      config: { id, name: id, protocol: 'UCI' }, pending, callbacks,
      init: vi.fn(async () => {
        if (blockInit) await new Promise<void>((resolve) => initResolvers.push(resolve))
        return { id, engineType: 'stockfish', protocol: 'UCI', name: id, version: 'test', threads: 1, hashMb: 64 }
      }),
      sendCommand: vi.fn(), setPosition: vi.fn(), newGame: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
      search: vi.fn(() => new Promise<EngineSearchResponse>((resolve, reject) => pending.push({ resolve, reject }))),
    }
    adapters.push(adapter)
    return adapter
  })
  return { adapters, createEngine, initResolvers, setBlockInit: (value: boolean) => { blockInit = value } }
})
vi.mock('../engine/default-registry', () => ({ engineRegistry: { createEngine: engineMock.createEngine } }))
vi.mock('../engine/support', () => ({ detectEngineSupport: () => ({ supported: true, mobile: false, threads: 2, hashMb: 64 }) }))
vi.mock('../games/chess/audio', () => ({ playChessMoveSound: vi.fn() }))
function response(bestmove: string): EngineSearchResponse {
  const info = { depth: 12, nodes: 1000, nps: 10000, elapsedMs: 100, score: { kind: 'cp' as const, value: 20 }, wdl: null, pv: [bestmove] }
  return { bestmove, info, candidates: [{ ...info, multipv: 1 }] }
}
const game = new ChessGameEngine()
function saveState(state: ReturnType<typeof createChessState>) {
  localStorage.setItem('ai-board-games:latest:chess:v1', JSON.stringify(createChessArchive({ state, players: [{ seat: 'w', kind: 'ai', name: 'white' }, { seat: 'b', kind: 'ai', name: 'black' }] })))
}
function setup() {
  const hook = renderHook(() => useChessMatch(), { wrapper: StrictMode })
  act(() => hook.result.current.changeBudget('professional'))
  act(() => hook.result.current.toggleGuess(true))
  return hook
}
async function search(hook: ReturnType<typeof setup>, skip = false) {
  act(() => hook.result.current.submitGuess(skip))
  await waitFor(() => expect(engineMock.adapters.some((adapter) => adapter.pending.length)).toBe(true))
}
async function finish(move = 'e2e4', seat = 0, index = 0) {
  await act(async () => engineMock.adapters[seat].pending[index].resolve(response(move)))
}
beforeEach(() => {
  engineMock.adapters.length = 0; engineMock.initResolvers.length = 0; engineMock.setBlockInit(false); engineMock.createEngine.mockClear()
  localStorage.clear(); sessionStorage.clear()
  vi.spyOn(chessLibrary, 'migrateLatest').mockResolvedValue()
  vi.spyOn(chessLibrary, 'save').mockResolvedValue()
  vi.spyOn(chessLibrary, 'list').mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('国际象棋竞猜控制', () => {
  it('选招不落子，非法着法不接受，重复提交和下一题不重复搜索', async () => {
    const hook = setup()
    const before = hook.result.current.state
    act(() => hook.result.current.selectGuess({ from: 'e2', to: 'e5' }))
    act(() => hook.result.current.submitGuess())
    expect(engineMock.createEngine).not.toHaveBeenCalled()
    act(() => { hook.result.current.selectGuess({ from: 'd2', to: 'd4' }); hook.result.current.selectGuess({ from: 'e2', to: 'e4' }) })
    expect(hook.result.current.state).toBe(before)
    act(() => { hook.result.current.submitGuess(); hook.result.current.submitGuess(); hook.result.current.start(); hook.result.current.step() })
    await waitFor(() => expect(engineMock.adapters[0]?.pending).toHaveLength(1))
    expect(engineMock.adapters[0].search.mock.calls[0][1]).toBe(hook.result.current.profile.movetimeMs)
    await finish()
    expect(hook.result.current.guess).toMatchObject({ phase: 'revealed', stats: { hits: 1, answered: 1, streak: 1 } })
    expect(hook.result.current.state.history).toHaveLength(1)
    act(() => { hook.result.current.nextGuess(); hook.result.current.nextGuess() })
    expect(hook.result.current.guess.round?.before.history).toHaveLength(1)
    expect(engineMock.adapters[0].search).toHaveBeenCalledOnce()
    act(() => hook.result.current.submitGuess(true))
    await waitFor(() => expect(engineMock.adapters[1].pending).toHaveLength(1))
    await finish('e7e5', 1)
    expect(hook.result.current.guess.stats).toEqual({ answered: 1, hits: 1, streak: 0, longest: 1 })
    act(() => { hook.result.current.toggleGuess(false); hook.result.current.toggleGuess(true) })
    expect(hook.result.current.guess.stats.hits).toBe(1)
  })
  it('运行中开启让当前手正常完成，从下一手作答', async () => {
    const hook = setup()
    act(() => { hook.result.current.toggleGuess(false); hook.result.current.start() })
    await waitFor(() => expect(engineMock.adapters[0]?.pending).toHaveLength(1))
    act(() => hook.result.current.toggleGuess(true))
    expect(hook.result.current.guess.phase).toBe('armed')
    await finish()
    expect(hook.result.current.guess).toMatchObject({ phase: 'choosing', stats: emptyChessGuessStats() })
    expect(engineMock.adapters[1].search).not.toHaveBeenCalled()
    act(() => hook.result.current.toggleGuess(false))
    act(() => hook.result.current.step())
    await waitFor(() => expect(engineMock.adapters[1].pending).toHaveLength(1))
    await finish('e7e5', 1)
    expect(hook.result.current.state.history).toHaveLength(2)
  })
  it('暂停后必须等迟到搜索结束才可重新出题，旧结果不落子', async () => {
    const hook = setup()
    await search(hook, true)
    await act(async () => hook.result.current.pause())
    expect(hook.result.current.guess.phase).toBe('void')
    act(() => hook.result.current.nextGuess())
    expect(hook.result.current.guess.phase).toBe('void')
    await finish()
    expect(hook.result.current.state.history).toHaveLength(0)
    act(() => { hook.result.current.nextGuess(); hook.result.current.selectGuess({ from: 'e2', to: 'e4' }) })
    act(() => hook.result.current.submitGuess())
    await waitFor(() => expect(engineMock.adapters[0].pending).toHaveLength(2))
    await finish('e2e4', 0, 1)
    expect(hook.result.current.guess.stats.hits).toBe(1)
  })
  it.each(['pause', 'newGame', 'unmount'] as const)('首次加载引擎时 %s 不让旧初始化继续落子', async (action) => {
    engineMock.setBlockInit(true)
    const hook = setup()
    act(() => hook.result.current.submitGuess(true))
    await waitFor(() => expect(engineMock.initResolvers).toHaveLength(2))
    if (action === 'unmount') hook.unmount()
    else await act(async () => hook.result.current[action]())
    await act(async () => engineMock.initResolvers.forEach((resolve) => resolve()))
    expect(engineMock.adapters.every((adapter) => adapter.search.mock.calls.length === 0)).toBe(true)
    if (action !== 'unmount') expect(hook.result.current.state.history).toHaveLength(0)
  })
  it.each(['newGame', 'restore', 'suspendForStudy'] as const)('%s 使未完成题失效', async (action) => {
    const hook = setup()
    await search(hook, true)
    if (action === 'restore') saveState(replayChessState(['d2d4']))
    if (action === 'suspendForStudy') {
      let pending!: Promise<unknown>
      act(() => { pending = hook.result.current.suspendForStudy() })
      await finish()
      await act(async () => { await pending })
    } else {
      await act(async () => hook.result.current[action]())
      await finish()
    }
    expect(hook.result.current.guess).toMatchObject({ phase: 'off', stats: emptyChessGuessStats() })
    expect(hook.result.current.state.history.map((move) => move.uci)).toEqual(action === 'restore' ? ['d2d4'] : [])
  })
  it('引擎失败重建后仍为作废题，不能自动重提答案', async () => {
    const hook = setup()
    await search(hook, true)
    await act(async () => engineMock.adapters[0].pending[0].reject(new Error('engine failed')))
    await waitFor(() => expect(hook.result.current.guessBusy).toBe(false))
    expect(hook.result.current.guess).toMatchObject({ phase: 'void', stats: emptyChessGuessStats() })
    expect(engineMock.adapters).toHaveLength(3)
    expect(engineMock.adapters[2].search).not.toHaveBeenCalled()
  })
  it('开局库题无需搜索，按真实开局着法判分', async () => {
    const hook = renderHook(() => useChessMatch())
    const opening = CHESS_OPENINGS.find((candidate) => candidate.id === hook.result.current.state.openingId)!
    act(() => { hook.result.current.toggleGuess(true); hook.result.current.selectGuess(parseChessUci(opening.moves[0])!) })
    act(() => hook.result.current.submitGuess())
    await waitFor(() => expect(hook.result.current.guess.phase).toBe('revealed'))
    expect(hook.result.current.guess).toMatchObject({ stats: { hits: 1 }, round: { analysis: { source: 'opening', budgetMs: 0 } } })
    expect(engineMock.adapters.every((adapter) => !adapter.search.mock.calls.length)).toBe(true)
  })
  it.each([false, true])('人格模式按重排后的实际着法计分，声明预定着法不落子时作废：%s', async (claim) => {
    const hook = renderHook(() => useChessMatch())
    saveState(replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']))
    await act(async () => hook.result.current.restore())
    act(() => { hook.result.current.toggleGuess(true); hook.result.current.selectGuess(parseChessUci(claim ? 'f6g8' : 'f6h5')!); hook.result.current.submitGuess() })
    await waitFor(() => expect(engineMock.adapters[1]?.pending).toHaveLength(1))
    const candidate = (multipv: number, move: string, score: number) => {
      const snapshot = { depth: 17, score: { kind: 'cp' as const, value: score }, wdl: { win: 500, draw: 350, loss: 150 } }
      return { ...response(move).info, depth: 18, score: snapshot.score, wdl: snapshot.wdl, multipv, previous: snapshot, ...(multipv === 1 ? { previousPrincipal: snapshot } : {}) }
    }
    const principal = candidate(1, 'f6g8', 20)
    await act(async () => engineMock.adapters[1].pending[0].resolve({ bestmove: 'f6g8', info: principal, candidates: claim ? [principal] : [principal, candidate(2, 'f6h5', 5)] }))
    if (claim) {
      expect(hook.result.current.state.result?.intendedMove).toBe('f6g8')
      expect(hook.result.current.state.history).toHaveLength(7)
      expect(hook.result.current.guess).toMatchObject({ phase: 'void', stats: emptyChessGuessStats() })
    } else {
      expect(hook.result.current.guess).toMatchObject({ phase: 'revealed', stats: { hits: 1 }, round: { actual: { uci: 'f6h5' }, analysis: { source: 'engine', response: { bestmove: 'f6g8' } } } })
    }
  })
  it('申请和棋没有实际落子时作废，不把预定着法计为答案', async () => {
    const hook = setup()
    saveState(createChessState(1, '7k/8/8/8/8/8/R7/K7 w - - 100 51'))
    await act(async () => hook.result.current.restore())
    act(() => { hook.result.current.toggleGuess(true); hook.result.current.selectGuess({ from: 'a2', to: 'a3' }); hook.result.current.submitGuess() })
    await waitFor(() => expect(hook.result.current.state.result?.termination).toBe('claim'))
    expect(hook.result.current.guess).toMatchObject({ phase: 'void', stats: emptyChessGuessStats() })
    expect(hook.result.current.guess.reason).toContain('AI 申请和棋')
    expect(hook.result.current.state.history).toHaveLength(0)
  })
  it('将死的实际落子仍结算本题，终局不再出题', async () => {
    const hook = setup()
    saveState(replayChessState(['f2f3', 'e7e5', 'g2g4']))
    await act(async () => hook.result.current.restore())
    act(() => { hook.result.current.toggleGuess(true); hook.result.current.selectGuess({ from: 'd8', to: 'h4' }); hook.result.current.submitGuess() })
    await waitFor(() => expect(engineMock.adapters[1]?.pending).toHaveLength(1))
    await finish('d8h4', 1)
    expect(hook.result.current.state.result?.reason).toBe('checkmate')
    expect(hook.result.current.guess).toMatchObject({ phase: 'revealed', stats: { hits: 1, answered: 1 } })
    act(() => hook.result.current.nextGuess())
    expect(hook.result.current.guess.phase).toBe('revealed')
  })
  it('档位切换保留成绩，复盘返回恢复内存成绩，显式恢复清零', async () => {
    const hook = setup()
    act(() => hook.result.current.selectGuess({ from: 'e2', to: 'e4' }))
    await search(hook); await finish()
    act(() => hook.result.current.changeBudget('fast'))
    await waitFor(() => expect(hook.result.current.runState).toBe('ready'))
    expect(hook.result.current.guess).toMatchObject({ phase: 'off', stats: { hits: 1 } })
    const record = { id: hook.result.current.libraryId, title: 'test', favorite: false, mode: 'theatre' as const, configuration: {}, archive: createChessArchive({ state: hook.result.current.state, players: [{ seat: 'w', kind: 'ai' as const, name: 'w' }, { seat: 'b', kind: 'ai' as const, name: 'b' }] }) }
    await act(async () => hook.result.current.suspendForStudy())
    hook.unmount()
    vi.spyOn(chessLibrary, 'get').mockResolvedValue(record)
    writeChessLiveReturn({ id: record.id, mode: 'theatre', phase: 'resume' })
    const returned = renderHook(() => useChessMatch(), { wrapper: StrictMode })
    await waitFor(() => expect(returned.result.current.libraryId).toBe(record.id))
    expect(returned.result.current.guess).toMatchObject({ phase: 'off', stats: { hits: 1 } })
    await act(async () => returned.result.current.restore())
    expect(returned.result.current.guess.stats).toEqual(emptyChessGuessStats())
  })
  it('剧场进入棋谱库提供原局返回入口，其他模式不创建返回标记', async () => {
    const pause = vi.fn(async () => {})
    const saveNow = vi.fn(async () => true)
    const props = { id: 'guess-library-return', state: createChessState(), status: 'saved' as const, pause, saveNow }
    const actions = render(<ChessLibraryActions {...props} mode="theatre" />)
    fireEvent.click(screen.getByRole('link', { name: '棋谱库' }))
    await waitFor(() => expect(readChessLiveReturn()).toEqual({ id: props.id, mode: 'theatre', phase: 'resume' }))
    expect(pause).toHaveBeenCalledOnce()
    actions.unmount()
    const library = render(<ChessLibraryPage />)
    expect(screen.getByRole('link', { name: '返回观战对局' })).toHaveAttribute('href', '#/games/chess/theatre')
    await waitFor(() => expect(screen.getByText(/尚无保存的棋局/)).toBeInTheDocument())
    library.unmount()
    writeChessLiveReturn(null)
    render(<ChessLibraryActions {...props} mode="human" />)
    fireEvent.click(screen.getByRole('link', { name: '棋谱库' }))
    await waitFor(() => expect(saveNow).toHaveBeenCalledTimes(2))
    expect(readChessLiveReturn()).toBeNull()
  })
  it.each(['arena', 'human'] as const)('%s 模式不能启用竞猜', (mode) => {
    const { result } = renderHook(() => useChessMatch({ mode }))
    act(() => { result.current.toggleGuess(true); result.current.submitGuess(true) })
    expect(result.current.guess.phase).toBe('off')
    expect(engineMock.createEngine).not.toHaveBeenCalled()
  })
})

describe('国际象棋特殊猜招与棋盘', () => {
  it.each([
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'],
    ['7k/8/8/3pP3/8/8/8/K7 w - d6 0 1', 'e5d6'],
    ...['q', 'r', 'b', 'n'].map((piece) => ['7k/P7/8/8/8/8/8/7K w - - 0 1', `a7a8${piece}`]),
  ])('特殊着法 %s / %s 使用完整 UCI 判分', (fen, uci) => {
    const before = createChessState(1, fen)
    const move = parseChessUci(uci)!
    const actual = game.executeAction(before, move).lastMove!
    expect(nextChessGuessStats(emptyChessGuessStats(), move, actual).hits).toBe(1)
    if (move.promotion) expect(nextChessGuessStats(emptyChessGuessStats(), { ...move, promotion: move.promotion === 'q' ? 'n' : 'q' }, actual).hits).toBe(0)
    expect(nextChessGuessStats({ hits: 2, answered: 2, streak: 2, longest: 2 }, null, actual)).toEqual({ hits: 2, answered: 2, streak: 0, longest: 2 })
  })
  it('升变明确选择，竞猜状态重置后不残留选择框或落子', () => {
    const state = createChessState(1, '7k/P7/8/8/8/8/8/7K w - - 0 1')
    const onMove = vi.fn()
    const view = render(<ChessBoard state={state} interactive humanColor="w" interactionKey="choosing-1" onMove={onMove} />)
    fireEvent.click(screen.getByRole('gridcell', { name: 'a7 白方p' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'a8 可落子' }))
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^马$/ }))
    expect(actionToUci(onMove.mock.calls[0][0])).toBe('a7a8n')
    expect(state.history).toHaveLength(0)
    fireEvent.click(screen.getByRole('gridcell', { name: 'a7 白方p' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'a8 可落子' }))
    view.rerender(<ChessBoard state={state} interactive={false} humanColor="w" interactionKey="off" onMove={onMove} />)
    expect(screen.queryByRole('group', { name: '选择升变棋子' })).not.toBeInTheDocument()
    expect(onMove).toHaveBeenCalledOnce()
  })
  it('剧场选招与标记不落子，切换面板不泄露当前或历史主变化', async () => {
    render(<ChessGamePage />)
    fireEvent.click(screen.getByRole('button', { name: /专业.*10 秒/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /猜下一手/ }))
    expect(screen.getByRole('button', { name: '提交猜招' })).toBeDisabled()
    fireEvent.click(screen.getByRole('gridcell', { name: 'e2 白方p' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'e4 可落子' }))
    expect(screen.getByRole('gridcell', { name: 'e2 白方p 竞猜已选' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '单步' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '提交猜招' }))
    await waitFor(() => expect(engineMock.adapters[0]?.pending).toHaveLength(1))
    act(() => engineMock.adapters[0].search.mock.calls[0][2].onInfo(response('d2d4').info))
    fireEvent.click(screen.getByRole('tab', { name: /分析/ }))
    expect(screen.queryByText(/d2d4/)).not.toBeInTheDocument()
    await finish()
    expect(screen.getByLabelText('国际象棋猜下一手')).toHaveTextContent('AI 实际落子：e4 · 猜中')
    expect(screen.getByText('e4 · e2e4', { exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(screen.getAllByText('e2e4', { exact: true }).length).toBeGreaterThan(0) // factual move log remains
    expect(screen.queryByText('e4 · e2e4', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('等待搜索…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交猜招' })).toBeDisabled()
  }, 20000)
})
