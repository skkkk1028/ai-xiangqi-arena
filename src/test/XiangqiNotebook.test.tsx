import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NotebookSave } from '../games/xiangqi/NotebookSave'
import { NotebookPage } from '../games/xiangqi/NotebookPage'
import { createNotebookEntry, xiangqiNotebook } from '../games/xiangqi/notebook'
import { MoveComparison } from '../games/xiangqi/MoveComparison'
import { replayXiangqiUcci } from '../games/xiangqi/archive'
import { engineRegistry } from '../engine/default-registry'
import * as support from '../engine/support'
import type { EngineAdapter } from '../engine/adapter'
import type { EngineSearchResponse } from '../game/types'
const draft = { moves: [], source: { kind: 'guess' as const, label: '出题局面' }, reference: { actual: 'b0c2', source: 'opening' as const } }
const response: EngineSearchResponse = { bestmove: 'b0c2', info: { depth: 10, score: { kind: 'cp', value: 80 }, nodes: 100, nps: 100, elapsedMs: 10, pv: ['b0c2'], wdl: null }, candidates: [] }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('保存失败不丢编辑内容，可重试；连续提交只写一次', async () => {
  const save = vi.spyOn(xiangqiNotebook, 'save').mockRejectedValueOnce(new Error('空间不足')).mockImplementation(async (e) => e)
  render(<NotebookSave draft={draft} />)
  fireEvent.click(screen.getByRole('button', { name: '收藏局面' }))
  fireEvent.change(await screen.findByLabelText('备注'), { target: { value: '保留这段备注' } })
  const form = screen.getByRole('form', { name: '收藏局面信息' })
  fireEvent.submit(form); fireEvent.submit(form)
  expect(await screen.findByRole('alert')).toHaveTextContent('空间不足')
  expect(screen.getByLabelText('备注')).toHaveValue('保留这段备注')
  expect(save).toHaveBeenCalledTimes(1)
  fireEvent.submit(form)
  await screen.findByText('已收藏到个人练习本。')
  expect(save).toHaveBeenCalledTimes(2)
})
it('列表筛选与编辑保留元数据，打开条目默认不显示备注', async () => {
  const entry = createNotebookEntry(draft, '练习甲', '答案提示', '待理解')
  vi.spyOn(xiangqiNotebook, 'list').mockResolvedValue([entry])
  const update = vi.spyOn(xiangqiNotebook, 'update').mockResolvedValue()
  render(<StrictMode><NotebookPage onClose={() => undefined} /></StrictMode>)
  await screen.findByText('练习甲')
  fireEvent.change(screen.getByLabelText('筛选分类'), { target: { value: '已掌握' } })
  expect(screen.queryByText('练习甲')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('筛选分类'), { target: { value: '全部' } })
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '修改备注' } })
  fireEvent.submit(screen.getByRole('form', { name: '编辑收藏' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ note: '修改备注', moves: [] })))
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '打开局面' }))
  expect(screen.queryByText(/答案提示/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重走一手' })).toBeEnabled()
})
it('比较结果缓存，主动重算；停止旧搜索后迟到结果不能覆盖新任务', async () => {
  let resolve!: (value: EngineSearchResponse) => void
  const search = vi.fn().mockResolvedValueOnce(response).mockImplementationOnce(() => new Promise<EngineSearchResponse>((done) => { resolve = done })).mockResolvedValue(response)
  const dispose = vi.fn()
  vi.spyOn(support, 'detectEngineSupport').mockReturnValue({ supported: true, reason: null, threads: 1, hashMb: 64, mobile: false })
  const create = vi.spyOn(engineRegistry, 'createEngine').mockImplementation(() => ({ init: vi.fn(async () => ({})), search, dispose } as unknown as EngineAdapter))
  const view = render(<StrictMode><MoveComparison before={replayXiangqiUcci([])} userUcci="b0c2" referenceUcci="b0c2" /></StrictMode>)
  fireEvent.click(screen.getByRole('button', { name: '分析这一手' })); fireEvent.click(screen.getByRole('button', { name: '分析这一手' }))
  await screen.findByRole('button', { name: '重新分析' })
  expect(search).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '分析这一手' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重新分析' }))
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '停止分析' }))
  fireEvent.click(screen.getByRole('button', { name: '分析这一手' }))
  await screen.findByRole('button', { name: '重新分析' })
  expect(create).toHaveBeenCalledTimes(3)
  await act(async () => resolve({ ...response, info: { ...response.info, depth: 99 } }))
  expect(screen.queryByText(/深度 99/)).not.toBeInTheDocument()
  view.unmount(); expect(dispose).toHaveBeenCalledTimes(3)
})
