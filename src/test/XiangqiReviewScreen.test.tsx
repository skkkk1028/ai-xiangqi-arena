import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { XiangqiReviewScreen } from '../components/XiangqiReviewScreen'
import { engineRegistry } from '../engine/default-registry'
import * as support from '../engine/support'
import type { EngineAdapter } from '../engine/adapter'
import type { EngineSearchResponse } from '../game/types'
import { XiangqiGameEngine } from '../games/xiangqi/game-engine'
import { reviewPositions } from '../games/xiangqi/review'
import { createNotebookEntry } from '../games/xiangqi/notebook'
import { moveToUcci } from '../engine/ucci'

const history = reviewPositions(['a3a4', 'a6a5', 'a4a5']).at(-1)!.history.map((move) => ({ ...move, score: null, wdl: null, depth: 0 }))
const game = new XiangqiGameEngine()
let search: ReturnType<typeof vi.fn>
let dispose: ReturnType<typeof vi.fn>
let stop: ReturnType<typeof vi.fn>

function answer(moves: string[]): EngineSearchResponse {
  const state = reviewPositions(moves).at(-1)!
  const bestmove = moveToUcci(game.getLegalActions(state)[0])
  return { bestmove, info: { score: { kind: 'cp', value: 80 }, wdl: null, depth: 10, nodes: 100, nps: 100, elapsedMs: 10, pv: [bestmove] }, candidates: [] }
}

beforeEach(() => {
  search = vi.fn(async (moves: string[]) => answer(moves))
  dispose = vi.fn()
  stop = vi.fn()
  vi.spyOn(support, 'detectEngineSupport').mockReturnValue({ supported: true, reason: null, threads: 1, hashMb: 64, mobile: false })
  vi.spyOn(engineRegistry, 'createEngine').mockImplementation(() => ({ init: vi.fn(async () => ({})), search, stop, dispose } as unknown as EngineAdapter))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('无引擎也可逐步浏览，仅按需分析；退出释放引擎', async () => {
  const { unmount } = render(<StrictMode><XiangqiReviewScreen history={history} onClose={() => undefined} /></StrictMode>)
  expect(engineRegistry.createEngine).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByText(/原棋谱 · 已走 1/)).toBeInTheDocument()
  expect(screen.getByText(/己方的卒/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '分析本手' }))
  await screen.findByText('可核验分析')
  expect(search).toHaveBeenCalled()
  unmount()
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('切换步数后忽略迟到的分析，不污染当前点评', async () => {
  let resolve!: (response: EngineSearchResponse) => void
  search.mockImplementationOnce(() => new Promise<EngineSearchResponse>((done) => { resolve = done }))
  render(<XiangqiReviewScreen history={history} onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '分析本手' }))
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await act(async () => resolve(answer([])))
  expect(screen.queryByText('可核验分析')).not.toBeInTheDocument()
  expect(stop).toHaveBeenCalled()
  expect(screen.getByText(/原棋谱 · 已走 1/)).toBeInTheDocument()
})

it('重走一手、核对评价、AI 应手后返回原谱，原棋谱不变', async () => {
  const original = JSON.stringify(history)
  render(<XiangqiReviewScreen history={history} onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '重试这一手' }))
  fireEvent.click(screen.getByRole('button', { name: '红方马 10行2列' }))
  fireEvent.click(screen.getByRole('button', { name: '8行3列空位' }))
  await screen.findByText('你的重试')
  expect(screen.getByText(/练习棋谱：马八进七/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '从此局面继续挑战' }))
  await screen.findByText('AI 已落子，轮到你继续挑战。')
  expect(search.mock.calls.some(([moves]) => JSON.stringify(moves) === JSON.stringify(['b0c2']))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '返回原谱局面' }))
  expect(screen.getByText(/原棋谱 · 已走 0/)).toBeInTheDocument()
  expect(JSON.stringify(history)).toBe(original)
})

it('引擎不可用时仍保留步进浏览，并显示可重试错误', async () => {
  vi.mocked(support.detectEngineSupport).mockReturnValue({ supported: false, reason: '未启用跨源隔离', threads: 1, hashMb: 64, mobile: false })
  render(<XiangqiReviewScreen history={history} onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '分析本手' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('未启用跨源隔离')
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByText(/原棋谱 · 已走 1/)).toBeInTheDocument()
})

it('离开练习局面后迟到的 AI 应手不能改写原谱棋盘', async () => {
  let resolve!: (response: EngineSearchResponse) => void
  search.mockImplementationOnce(() => new Promise<EngineSearchResponse>((done) => { resolve = done }))
  render(<XiangqiReviewScreen history={history} onClose={() => undefined} />)
  fireEvent.change(screen.getByLabelText('练习执子'), { target: { value: 'black' } })
  fireEvent.click(screen.getByRole('button', { name: '从此局面继续挑战' }))
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await act(async () => resolve(answer([])))
  expect(screen.getByText(/原棋谱 · 已走 1/)).toBeInTheDocument()
  expect(screen.queryByText(/AI 已落子/)).not.toBeInTheDocument()
  expect(screen.queryByText(/练习棋谱/)).not.toBeInTheDocument()
})

it('搜索故障后可重新初始化并重试，原谱仍可用', async () => {
  search.mockRejectedValueOnce(new Error('测试搜索失败'))
  render(<XiangqiReviewScreen history={history} onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '分析本手' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('测试搜索失败')
  fireEvent.click(screen.getByRole('button', { name: '分析本手' }))
  await screen.findByText('可核验分析')
  expect(engineRegistry.createEngine).toHaveBeenCalledTimes(2)
})

it('观战接管定位指定局面，不自动搜索；选择另一方只应一手', async () => {
  render(<StrictMode><XiangqiReviewScreen history={history} initialIndex={1} entry="practice" onClose={() => undefined} /></StrictMode>)
  expect(screen.getByText(/原棋谱 · 已走 1/)).toBeInTheDocument()
  expect(screen.getByLabelText('练习执子')).toHaveValue('black')
  expect(engineRegistry.createEngine).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('练习执子'), { target: { value: 'red' } })
  fireEvent.click(screen.getByRole('button', { name: '开始练习' }))
  await screen.findByText('AI 已落子，轮到你继续挑战。')
  expect(search).toHaveBeenCalledTimes(1)
  expect(search.mock.calls[0][0]).toEqual(['a3a4'])
  fireEvent.click(screen.getByRole('button', { name: '重新开始本局面' }))
  expect(screen.getByText(/原棋谱 · 已走 1/)).toBeInTheDocument()
})

it('练习本默认隐藏备注与参考，重走一手不自动分析', async () => {
  const entry = createNotebookEntry({ moves: [], source: { kind: 'guess', label: '出题局面' }, reference: { guessed: 'a3a4', actual: 'b0c2', source: 'opening' } }, '测试局面', '不要提前看到的答案')
  render(<StrictMode><XiangqiReviewScreen history={[]} entry="notebook" notebookEntry={entry} onClose={() => undefined} /></StrictMode>)
  expect(screen.queryByText(/不要提前看到的答案/)).not.toBeInTheDocument()
  expect(search).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重走一手' }))
  fireEvent.click(screen.getByRole('button', { name: '红方马 10行2列' }))
  fireEvent.click(screen.getByRole('button', { name: '8行3列空位' }))
  expect(screen.getByRole('button', { name: '分析这一手' })).toBeEnabled()
  expect(search).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查看参考' }))
  expect(screen.getByText(/不要提前看到的答案/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新作答' }))
  expect(screen.queryByText(/不要提前看到的答案/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '分析这一手' })).not.toBeInTheDocument()
})
