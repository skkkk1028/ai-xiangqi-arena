import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NotebookSave } from '../games/go/NotebookSave'
import { NotebookPage } from '../games/go/NotebookPage'
import { createNotebookEntry, goNotebook } from '../games/go/notebook'
import { GoMoveComparison } from '../games/go/GoMoveComparison'
import { createGoArchive } from '../games/go/sgf'
import { studyGame } from '../games/go/study-analysis'
import { createConfiguredKataGoTransport } from '../games/go/ai/configured-transport'
import type { KataGoTransport } from '../games/go/ai/KataGoTransport'
import type { KataGoWireAnalysisEvent } from '../games/go/ai/types'
vi.mock('../games/go/ai/configured-transport',()=>({createConfiguredKataGoTransport:vi.fn()}))
const draft = { archive:createGoArchive(studyGame.init()), source: { kind: 'guess' as const, label: '出题局面' }, reference: { actual: {row:3,col:3}, description:'KataGo 实战着' } }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('保存失败不丢编辑内容，可重试；连续提交只写一次', async () => {
  const save = vi.spyOn(goNotebook, 'save').mockRejectedValueOnce(new Error('空间不足')).mockImplementation(async (e) => e)
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
  vi.spyOn(goNotebook, 'list').mockResolvedValue([entry])
  const update = vi.spyOn(goNotebook, 'update').mockResolvedValue()
  render(<StrictMode><NotebookPage onClose={() => undefined} /></StrictMode>)
  await screen.findByText('练习甲')
  fireEvent.change(screen.getByLabelText('筛选分类'), { target: { value: '已掌握' } })
  expect(screen.queryByText('练习甲')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('筛选分类'), { target: { value: '全部' } })
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '修改备注' } })
  fireEvent.submit(screen.getByRole('form', { name: '编辑收藏' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ note: '修改备注', archive: expect.objectContaining({moves: []}) })))
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '打开局面' }))
  expect(screen.queryByText(/答案提示/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重走一手' })).toBeEnabled()
})

function event(overrides: Partial<KataGoWireAnalysisEvent> = {}): KataGoWireAnalysisEvent {
  return { type: 'analysis', stage: 'final', requestId: 'test', engineVersion: 'test', modelName: 'model', profile: 'winrate',
    elapsedMs: 100, requestedVisits: 256, runtimeBackend: 'browser-wasm', requestedBackend: 'browser-webgpu',
    backendFallback: true, backendFallbackReason: 'test', modelFallback: false, modelFallbackReason: null,
    timedOut: false, truncated: false, stopReason: 'visit-limit', root: { winrate: 0.6, scoreLead: 3, visits: 256 },
    candidates: [{ move: 'D16', order: 0, visits: 220, prior: 0.4, winrate: 0.7, scoreLead: 5, pv: ['D16', 'Q4', 'D16'] },
      { move: 'Q16', order: 1, visits: 36, prior: 0.2, winrate: 0.5, scoreLead: 1, pv: ['Q16'] }], ...overrides }
}


it('比较缓存与加深、取消串行重试，切换局面及卸载不接受迟到结果',async()=>{
  let resolve!: (value:KataGoWireAnalysisEvent)=>void
  let delayedId=''
  let calls=0
  const search=vi.fn(async (request)=>{
    calls++
    if(calls===2 || calls===5){delayedId=request.requestId; return new Promise<KataGoWireAnalysisEvent>(done=>{resolve=done})}
    return {...event(),requestId:request.requestId,profile:request.profile,requestedVisits:request.profile==='fast'?2000:256}
  })
  const dispose=vi.fn()
  vi.mocked(createConfiguredKataGoTransport).mockImplementation(async()=>({initialize:vi.fn().mockResolvedValue({}),analyze:search,dispose,cancel:vi.fn()} as unknown as KataGoTransport))
  const initial=studyGame.init(),d={row:3,col:3}
  const view=render(<StrictMode><GoMoveComparison before={initial} selected={d} reference={d}/></StrictMode>)
  const start=screen.getByRole('button',{name:'分析这一手'})
  fireEvent.click(start);fireEvent.click(start)
  await screen.findByRole('button',{name:'重新分析'});expect(search).toHaveBeenCalledTimes(1)
  expect(start).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'重新分析'}))
  await waitFor(()=>expect(search).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button',{name:'停止分析'}))
  fireEvent.click(start)
  expect(search).toHaveBeenCalledTimes(2)
  await act(async()=>resolve({...event({modelName:'过期模型'}),requestId:delayedId}))
  await screen.findByRole('button',{name:'重新分析'})
  expect(search).toHaveBeenCalledTimes(3);expect(screen.queryByText(/过期模型/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'加深分析'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'重新分析'})).toBeEnabled())
  expect(search).toHaveBeenCalledTimes(4);expect(search.mock.calls[3][0].profile).toBe('fast')
  fireEvent.click(screen.getByRole('button',{name:'重新分析'}));await waitFor(()=>expect(search).toHaveBeenCalledTimes(5))
  view.rerender(<StrictMode><GoMoveComparison before={studyGame.applyMove(initial,{row:0,col:0})} selected={d}/></StrictMode>)
  expect(screen.queryByText(/推荐候选/)).not.toBeInTheDocument()
  view.unmount()
  await act(async()=>resolve({...event(),requestId:delayedId,profile:'fast'}))
  expect(dispose).toHaveBeenCalledTimes(5)
})
