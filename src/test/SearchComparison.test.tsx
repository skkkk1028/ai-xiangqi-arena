import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchComparison } from '../components/SearchComparison'
import { createInitialBoard } from '../game/board'
import { getLegalMoves } from '../game/rules'

class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.all.push(this) }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); FakeWorker.all = [] })
const board = createInitialBoard()
function setup() { vi.stubGlobal('Worker', FakeWorker); return render(<StrictMode><SearchComparison board={board} turn="red" paused /></StrictMode>) }
const run = () => fireEvent.click(screen.getByRole('button', { name: '搜索当前局面' }))
function finish(worker: FakeWorker, nodes: number, depth = 3) {
  act(() => worker.onmessage?.({ data: { result: { move: getLegalMoves(board, 'red')[0], depth, nodes, elapsedMs: 23, score: 0 } } } as MessageEvent))
}
it('开关发给 Worker，独立保存两次结果，完整同深度才显示收益', () => {
  setup(); run(); const first = FakeWorker.all[0]
  expect(first.postMessage).toHaveBeenCalledWith({ board, turn: 'red', depth: 3, enabled: true })
  finish(first, 100)
  fireEvent.click(screen.getByRole('checkbox'))
  run(); expect(FakeWorker.all[1].postMessage).toHaveBeenCalledWith({ board, turn: 'red', depth: 3, enabled: false })
  finish(FakeWorker.all[1], 200)
  expect(screen.getByRole('status')).toHaveTextContent('节点减少 50.0% · 最佳走法一致 · 分数一致')
})
it('未完成深度不显示收益；改变深度清空结果', () => {
  setup(); run(); finish(FakeWorker.all[0], 100, 2)
  expect(screen.getByRole('status')).toHaveTextContent('未完成目标深度')
  fireEvent.change(screen.getByLabelText('对比搜索深度'), { target: { value: '2' } })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
it('停止、恢复对局和卸载终止 Worker，迟到结果丢弃', () => {
  const view = setup(); run(); const first = FakeWorker.all[0]
  fireEvent.click(screen.getByRole('button', { name: '停止搜索' }))
  finish(first, 999); expect(screen.queryByText('999')).not.toBeInTheDocument()
  run(); const second = FakeWorker.all[1]
  view.rerender(<SearchComparison board={board} turn="red" paused={false} />)
  expect(second.terminate).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '搜索当前局面' })).toBeDisabled()
  view.unmount()
})
it('Worker 出错可重试', () => {
  setup(); run(); act(() => FakeWorker.all[0].onerror?.())
  expect(screen.getByRole('alert')).toHaveTextContent('失败')
  run(); expect(FakeWorker.all).toHaveLength(2)
})
