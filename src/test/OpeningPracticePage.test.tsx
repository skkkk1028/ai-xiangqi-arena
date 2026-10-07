import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OpeningPracticePage } from '../games/xiangqi/OpeningPracticePage'
import { engineRegistry } from '../engine/default-registry'
import * as support from '../engine/support'
import type { EngineAdapter } from '../engine/adapter'
import { reviewPositions } from '../games/xiangqi/review'
import { XiangqiGameEngine } from '../games/xiangqi/game-engine'
import { moveToUcci } from '../engine/ucci'
import type { EngineSearchResponse } from '../game/types'

let search: ReturnType<typeof vi.fn>
let init: ReturnType<typeof vi.fn>
let dispose: ReturnType<typeof vi.fn>
function answer(moves: string[]): EngineSearchResponse {
  const state = reviewPositions(moves).at(-1)!
  const bestmove = moveToUcci(new XiangqiGameEngine().getLegalActions(state)[0])
  return { bestmove, info: { score: null, wdl: null, depth: 1, nodes: 1, nps: 1, elapsedMs: 1, pv: [bestmove] }, candidates: [] }
}
beforeEach(() => {
  search = vi.fn(async (moves: string[]) => answer(moves)); init = vi.fn(async () => ({})); dispose = vi.fn()
  vi.spyOn(support, 'detectEngineSupport').mockReturnValue({ supported: true, reason: null, threads: 1, hashMb: 64, mobile: false })
  vi.spyOn(engineRegistry, 'createEngine').mockImplementation(() => ({ init, search, stop: vi.fn(), dispose } as unknown as EngineAdapter))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const button = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
function deviate() {
  button('从此局面开始')
  button('红方马 10行2列'); button('8行3列空位')
}
it('沿谱不启动引擎，执黑只自动走一手，隐藏未来着法', () => {
  render(<StrictMode><OpeningPracticePage onClose={() => undefined} /></StrictMode>)
  fireEvent.change(screen.getByLabelText('练习执子'), { target: { value: 'black' } })
  button('从此局面开始')
  expect(screen.getByText('沿谱练习 · 已走 1 手')).toBeInTheDocument()
  expect(screen.queryByText(/原谱下一手/)).not.toBeInTheDocument()
  expect(engineRegistry.createEngine).not.toHaveBeenCalled()
})
it('偏离后查看原谱再返回保留历史，继续实战发送偏离着法，重走清除变化', async () => {
  render(<OpeningPracticePage onClose={() => undefined} />); deviate()
  expect(screen.getByText('已偏离所选分支 · 已走 1 手')).toBeInTheDocument()
  expect(search).not.toHaveBeenCalled()
  button('查看原谱'); button('下一步'); button('下一步'); button('返回练习')
  expect(screen.getByText('已偏离所选分支 · 已走 1 手')).toBeInTheDocument()
  button('继续实战')
  await screen.findByText('AI 实战 · 已走 2 手')
  expect(search).toHaveBeenCalledWith(['b0c2'], 1500, { multiPv: 1 })
  button('回到偏离前重走')
  expect(screen.getByText('沿谱练习 · 已走 0 手')).toBeInTheDocument()
})
it('查看原谱取消搜索并丢弃迟到结果，返回重新搜索且重复点击不重入', async () => {
  let resolve!: (value: EngineSearchResponse) => void
  search.mockImplementationOnce(() => new Promise<EngineSearchResponse>((done) => { resolve = done }))
  render(<StrictMode><OpeningPracticePage onClose={() => undefined} /></StrictMode>); deviate(); button('继续实战')
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  button('查看原谱')
  await act(async () => resolve(answer(['b0c2'])))
  expect(screen.getByText('原谱浏览 · 已走 0 手')).toBeInTheDocument()
  button('返回练习')
  await screen.findByText('AI 实战 · 已走 2 手')
  expect(search).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalled()
})
it.each(['init', 'search', 'illegal'])('引擎 %s 故障保留局面并可重试', async (failure) => {
  if (failure === 'init') init.mockRejectedValueOnce(new Error('初始化失败'))
  if (failure === 'search') search.mockRejectedValueOnce(new Error('搜索失败'))
  if (failure === 'illegal') search.mockResolvedValueOnce({ ...answer(['b0c2']), bestmove: 'a0a9' })
  render(<OpeningPracticePage onClose={() => undefined} />); deviate(); button('继续实战')
  await screen.findByRole('alert')
  expect(screen.getByText('AI 实战 · 已走 1 手')).toBeInTheDocument()
  button('重试 AI 应手'); await screen.findByText('AI 实战 · 已走 2 手')
})
it('原谱末尾须主动继续，退出后迟到结果不生效', async () => {
  let resolve!: (value: EngineSearchResponse) => void
  search.mockImplementationOnce(() => new Promise<EngineSearchResponse>((done) => { resolve = done }))
  const onClose = vi.fn()
  const view = render(<OpeningPracticePage onClose={onClose} />)
  button('最后局面'); button('从此局面开始')
  expect(screen.getByText('本分支已走完 · 已走 16 手')).toBeInTheDocument()
  expect(search).not.toHaveBeenCalled()
  button('重新选择'); button('初始局面'); deviate(); button('继续实战')
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  button('返回首页'); expect(onClose).toHaveBeenCalledTimes(1); view.unmount()
  await act(async () => resolve(answer(['b0c2'])))
  expect(dispose).toHaveBeenCalled()
})
