import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGoMatch } from '../games/go/useGoMatch'
import { GoGamePage } from '../games/go/GoGamePage'
import { GoGameEngine } from '../games/go/game-engine'
import { emptyGoGuessStats, nextGoGuessStats } from '../games/go/guess'
import type { KataGoAnalyzeOptions, KataGoTransport } from '../games/go/ai/KataGoTransport'
import type { KataGoAnalyzeRequest, KataGoCapabilities, KataGoWireAnalysisEvent } from '../games/go/ai/types'
import { KataGoEngine } from '../games/go/ai/KataGoEngine'
import { saveLatestArchive, clearLatestArchive } from '../games/core/archive'
import { createGoArchive } from '../games/go/sgf'
import { HttpLeelaZeroTransport } from '../games/go/ai/LeelaZeroTransport'

vi.mock('../games/go/ai/configured-transport', () => ({ createConfiguredKataGoTransport: async () => transport }))
const capabilities: KataGoCapabilities = {
  ready: true, engineVersion: 'test', modelName: 'test', runtimeBackend: 'native-katago', requestedBackend: 'native-katago',
  backendFallback: false, backendFallbackReason: null, modelFallback: false, modelFallbackReason: null,
  profiles: { fast: { maxVisits: 2000, timeoutMs: 30000 }, strong: { maxVisits: 20000, timeoutMs: 180000 },
    'battle-matched': { maxVisits: 250, timeoutMs: 30000 } },
}
function event(request: KataGoAnalyzeRequest, move: string, stage: 'partial' | 'final' = 'final'): KataGoWireAnalysisEvent {
  return { ...capabilities, type: 'analysis', stage, requestId: request.requestId, profile: request.profile,
    elapsedMs: 100, requestedVisits: 20000, timedOut: false, truncated: false, stopReason: stage === 'partial' ? 'in-progress' : 'visit-limit',
    root: { winrate: 0.6, scoreLead: 3, visits: 20000 },
    candidates: [{ move, order: 0, visits: 18000, prior: 0.4, winrate: 0.6, scoreLead: 3, pv: [move, 'Q4'] }] }
}
interface Pending { request: KataGoAnalyzeRequest; options?: KataGoAnalyzeOptions; resolve: (event: KataGoWireAnalysisEvent) => void; reject: (error: Error) => void }
let pending: Pending[] = []
const transport: KataGoTransport = {
  initialize: vi.fn(async () => capabilities),
  analyze: vi.fn((request, options) => new Promise<KataGoWireAnalysisEvent>((resolve, reject) => pending.push({ request, options, resolve, reject }))),
  cancel: vi.fn(), dispose: vi.fn(),
}
async function finish(move = 'D16', index = pending.length - 1) {
  await act(async () => { pending[index].resolve(event(pending[index].request, move)) })
}
async function ready() {
  const hook = renderHook(() => useGoMatch(), { wrapper: StrictMode })
  await act(async () => { await hook.result.current.changeMode('ai') })
  act(() => hook.result.current.toggleGuess(true))
  return hook
}
async function submit(hook: Awaited<ReturnType<typeof ready>>, skip = false) {
  await act(async () => { void hook.result.current.submitGuess(skip) })
}
beforeEach(() => { pending = []; vi.clearAllMocks() })
afterEach(() => { cleanup(); clearLatestArchive('go'); vi.restoreAllMocks() })

describe('围棋竞猜回合', () => {
  it('统计区分命中、未命中和跳过，虚着可命中', () => {
    const game = new GoGameEngine()
    const record = game.applyMove(game.init(), { row: 3, col: 3 }).history[0]
    const hit = nextGoGuessStats(emptyGoGuessStats(), { row: 3, col: 3 }, record)
    expect(hit).toEqual({ answered: 1, hits: 1, streak: 1, longest: 1 })
    expect(nextGoGuessStats(hit, null, record)).toEqual({ ...hit, streak: 0 })
    expect(nextGoGuessStats(hit, { row: 4, col: 3 }, record)).toEqual({ answered: 2, hits: 1, streak: 0, longest: 1 })
    const pass = game.applyMove(game.init(), { kind: 'pass' }).history[0]
    expect(nextGoGuessStats(hit, { kind: 'pass' }, pass)).toEqual({ answered: 2, hits: 2, streak: 2, longest: 2 })
  })

  it('选点不改棋局，重复提交及下一题不多走一手，保留原搜索预算', async () => {
    const hook = await ready()
    const before = hook.result.current.state
    act(() => { hook.result.current.selectGuess({ row: 3, col: 3 }); hook.result.current.selectGuess({ row: 4, col: 3 }); hook.result.current.selectGuess({ row: 3, col: 3 }) })
    expect(hook.result.current.state).toBe(before)
    await act(async () => { void hook.result.current.submitGuess(); void hook.result.current.submitGuess(); await hook.result.current.startAI(); await hook.result.current.stepAI(); await hook.result.current.analyzePostgame() })
    expect(pending).toHaveLength(1)
    expect(pending[0].request).toMatchObject({ profile: 'strong', moves: [] })
    await finish()
    expect(hook.result.current.state.history).toHaveLength(1)
    expect(hook.result.current.guess).toMatchObject({ phase: 'revealed', stats: { hits: 1, answered: 1 } })
    act(() => { hook.result.current.nextGuess(); hook.result.current.nextGuess() })
    expect(hook.result.current.guess.round?.before.history).toHaveLength(1)
    act(() => hook.result.current.selectGuess({ row: 3, col: 3 }))
    expect(hook.result.current.guess.round?.selected).toBeNull()
    expect(pending).toHaveLength(1)
    await submit(hook, true); await finish('Q4')
    expect(hook.result.current.guess.stats).toEqual({ hits: 1, answered: 1, streak: 0, longest: 1 })
    act(() => { hook.result.current.toggleGuess(false); hook.result.current.toggleGuess(true) })
    expect(hook.result.current.guess.stats.answered).toBe(1)
  })

  it('自动观战中开启，当前手不计分且下一手不自动搜索', async () => {
    const hook = renderHook(() => useGoMatch())
    await act(async () => { await hook.result.current.changeMode('ai'); await hook.result.current.startAI() })
    expect(pending).toHaveLength(1)
    act(() => hook.result.current.toggleGuess(true))
    expect(hook.result.current.guess.phase).toBe('armed')
    await finish()
    expect(hook.result.current.guess).toMatchObject({ phase: 'choosing', stats: { answered: 0 } })
    expect(hook.result.current.state.history).toHaveLength(1)
    expect(hook.result.current.runState).toBe('paused')
    expect(pending).toHaveLength(1)
    act(() => hook.result.current.toggleGuess(false))
    await act(async () => { void hook.result.current.stepAI() })
    await finish('Q4')
    expect(hook.result.current.state.history).toHaveLength(2)
  })

  it('暂停后忽略不遵守取消信号的迟到结果，并可重试', async () => {
    const hook = await ready()
    await submit(hook, true)
    await act(async () => { await hook.result.current.pauseAI() })
    expect(pending[0].options?.signal?.aborted).toBe(true)
    expect(hook.result.current.guess.phase).toBe('void')
    await finish()
    expect(hook.result.current.state.history).toHaveLength(0)
    expect(hook.result.current.guess.stats.answered).toBe(0)
    act(() => { hook.result.current.nextGuess(); hook.result.current.selectGuess({ row: 3, col: 3 }) })
    await submit(hook); await finish()
    expect(hook.result.current.guess.stats.hits).toBe(1)
  })

  it('搜索失败作废，不清空之前的连续命中', async () => {
    const hook = await ready()
    act(() => hook.result.current.selectGuess({ row: 3, col: 3 }))
    await submit(hook); await finish()
    act(() => hook.result.current.nextGuess())
    await submit(hook, true)
    await act(async () => pending[1].reject(new Error('测试搜索失败')))
    expect(hook.result.current.guess).toMatchObject({ phase: 'void', round: null, stats: { answered: 1, streak: 1 } })
    expect(hook.result.current.state.history).toHaveLength(1)
  })

  it.each(['newGame', 'changeMode', 'changeProfile', 'suspendForStudy'] as const)('搜索期间 %s 使旧题失效', async (action) => {
    const hook = await ready()
    await submit(hook, true)
    await act(async () => {
      if (action === 'changeMode') await hook.result.current.changeMode('local')
      else if (action === 'changeProfile') await hook.result.current.changeProfile('fast')
      else await hook.result.current[action]()
    })
    await finish()
    expect(hook.result.current.guess).toMatchObject({ phase: 'off', stats: { answered: 0 } })
    expect(hook.result.current.state.history).toHaveLength(0)
  })

  it('恢复档案取消旧题并清空成绩，迟到结果不覆盖档案', async () => {
    const hook = await ready()
    act(() => hook.result.current.selectGuess({ row: 3, col: 3 }))
    await submit(hook); await finish()
    act(() => hook.result.current.nextGuess())
    await submit(hook, true)
    const game = new GoGameEngine()
    const saved = game.applyMove(game.init(), { row: 15, col: 15 })
    saveLatestArchive(createGoArchive(saved))
    await act(async () => { await hook.result.current.restoreLatest() })
    await finish('Q4')
    expect(hook.result.current.state).toEqual(saved)
    expect(hook.result.current.guess).toMatchObject({ phase: 'off', stats: emptyGoGuessStats() })
  })

  it('进入复盘保留成绩，新局清空成绩；无本题分析时不复用上一手数据', async () => {
    const hook = await ready()
    act(() => hook.result.current.selectGuess({ row: 3, col: 3 }))
    await submit(hook); await finish()
    act(() => hook.result.current.nextGuess())
    vi.spyOn(KataGoEngine.prototype, 'think').mockResolvedValueOnce({ action: { row: 15, col: 15 } })
    await submit(hook, true)
    expect(hook.result.current.guess.round?.actual?.notation).toBe('Q4')
    expect(hook.result.current.guess.round?.analysis).toBeUndefined()
    await act(async () => { await hook.result.current.suspendForStudy() })
    expect(hook.result.current.guess).toMatchObject({ phase: 'off', stats: { hits: 1, answered: 1 } })
    await act(async () => { await hook.result.current.newGame() })
    expect(hook.result.current.guess.stats).toEqual(emptyGoGuessStats())
  })

  it('开启竞猜取消已有后台分析，过期分析不再出现在走势中', async () => {
    const hook = await ready()
    await submit(hook, true); await finish()
    act(() => hook.result.current.toggleGuess(false))
    await act(async () => { await hook.result.current.analyzePostgame() })
    expect(pending).toHaveLength(2)
    expect(pending[1].request.profile).toBe('winrate')
    act(() => hook.result.current.toggleGuess(true))
    expect(pending[1].options?.signal?.aborted).toBe(true)
    await finish('Q4')
    expect(hook.result.current.winRateHistory).toHaveLength(0)
    expect(hook.result.current.guess.phase).toBe('choosing')
  })

  it('两次虚着先结算题目再计分，恢复落子关闭竞猜', async () => {
    const hook = await ready()
    for (let i = 0; i < 2; i++) {
      act(() => hook.result.current.selectGuess({ kind: 'pass' }))
      await submit(hook); await finish('pass')
      if (i === 0) act(() => hook.result.current.nextGuess())
    }
    expect(hook.result.current.state.phase).toBe('scoring')
    expect(hook.result.current.guess).toMatchObject({ phase: 'revealed', stats: { hits: 2, answered: 2 } })
    act(() => hook.result.current.nextGuess())
    expect(hook.result.current.guess.phase).toBe('revealed')
    await act(async () => { await hook.result.current.resumePlay() })
    expect(hook.result.current.guess.phase).toBe('off')
    expect(hook.result.current.state.phase).toBe('playing')
  })

  it('卸载取消回合，迟到结果不再发布', async () => {
    const hook = await ready()
    await submit(hook, true)
    hook.unmount()
    expect(pending[0].options?.signal?.aborted).toBe(true)
    await finish()
  })

  it('互对弈支持 KataGo 和 Leela Zero 交替出题', async () => {
    vi.spyOn(HttpLeelaZeroTransport.prototype, 'initialize').mockResolvedValue({ ready: true, engineVersion: 'test', modelName: 'lz', runtimeBackend: 'native-leela-zero', playouts: 3200, timeoutMs: 30000 })
    vi.spyOn(HttpLeelaZeroTransport.prototype, 'dispose').mockImplementation(() => {})
    const lz = vi.spyOn(HttpLeelaZeroTransport.prototype, 'analyze').mockImplementation(async (request) => ({ requestId: request.requestId, move: 'Q4', elapsedMs: 10, requestedPlayouts: 3200, timedOut: false, engineVersion: 'test', modelName: 'lz' }))
    const hook = renderHook(() => useGoMatch())
    await act(async () => { await hook.result.current.changeMode('battle') })
    expect(hook.result.current.runState).toBe('ready')
    act(() => { hook.result.current.toggleGuess(true); hook.result.current.selectGuess({ row: 3, col: 3 }) })
    await submit(hook); await finish()
    expect(pending[0].request.profile).toBe('battle-matched')
    act(() => { hook.result.current.nextGuess(); hook.result.current.selectGuess({ row: 15, col: 15 }) })
    await submit(hook)
    expect(lz).toHaveBeenCalledOnce()
    expect(hook.result.current.guess).toMatchObject({ phase: 'revealed', stats: { hits: 2 }, round: { analysis: { engineId: 'leela-zero' } } })
  })
})

describe('围棋竞猜界面', () => {
  it('独立标记、切换面板不绕过竞猜、隐藏部分结果与旧变化，揭晓展示本题分析', async () => {
    render(<GoGamePage />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 自对弈' }))
    await screen.findByText(/KataGo 已就绪/)
    fireEvent.click(screen.getByRole('checkbox', { name: /猜下一手/ }))
    expect(screen.getByRole('button', { name: '提交猜招' })).toBeDisabled()
    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，空点' }))
    expect(screen.getByRole('gridcell', { name: 'D16，空点，竞猜已选' }).querySelector('.go-board__guess-marker')).not.toBeNull()
    expect(screen.getByText('0 手')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /单步/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: /分析/ }))
    expect(screen.getByRole('button', { name: '启动赛后分析' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '提交猜招' }))
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => pending[0].options?.onUpdate?.(event(pending[0].request, 'Q16', 'partial')))
    fireEvent.click(screen.getByRole('tab', { name: /引擎/ }))
    expect(screen.queryByLabelText('KataGo 候选着')).not.toBeInTheDocument()
    expect(screen.queryByText(/主变化：/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /猜下一手/ })).toBeDisabled()
    await finish()
    expect(screen.getByLabelText('围棋猜下一手')).toHaveTextContent('AI 实际落子：D16 · 猜中')
    expect(screen.getByLabelText('KataGo 候选着')).toHaveTextContent('D16')
    expect(screen.getByRole('gridcell', { name: 'D16，黑子，最近一步' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(screen.queryByText(/主变化：/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('KataGo 候选着')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '猜虚着' })).toBeEnabled()
  }, 20000)
})


it('接管暂停共享同一 Promise，返回稳定快照并阻止迟到落子',async()=>{
  const hook=await ready()
  act(()=>hook.result.current.selectGuess({row:3,col:3}))
  await submit(hook);await finish()
  act(()=>hook.result.current.nextGuess())
  await submit(hook,true)
  let snapshot!: Awaited<ReturnType<typeof hook.result.current.suspendForStudy>>
  await act(async()=>{
    const first=hook.result.current.suspendForStudy(), second=hook.result.current.suspendForStudy()
    expect(first).toBe(second);snapshot=await first
  })
  expect(snapshot.history.map(move=>move.notation)).toEqual(['D16'])
  expect(hook.result.current.guess.stats.answered).toBe(1)
  expect(hook.result.current.runState).toBe('paused')
  await finish('Q16')
  expect(hook.result.current.state).toEqual(snapshot)
  expect(hook.result.current.guess.stats.answered).toBe(1)
})
