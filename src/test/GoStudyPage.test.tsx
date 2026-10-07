import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoStudyPage } from '../games/go/GoStudyPage'
import { goLibrary, type GoLibraryGame } from '../games/go/library'
import { createGoArchive } from '../games/go/sgf'
import { studyGame } from '../games/go/study-analysis'
import { createConfiguredKataGoTransport } from '../games/go/ai/configured-transport'
import type { KataGoTransport } from '../games/go/ai/KataGoTransport'
import type { KataGoCapabilities } from '../games/go/ai/types'
import { KataGoEngine } from '../games/go/ai/KataGoEngine'
import { WinRateChart } from '../games/go/WinRateChart'
import { useGoLibraryMatch } from '../games/go/useGoLibraryMatch'
import type { useGoMatch } from '../games/go/useGoMatch'

vi.mock('../games/go/ai/configured-transport', () => ({ createConfiguredKataGoTransport: vi.fn() }))
// Board rendering is covered by GoGamePage tests and the real browser walkthrough.
vi.mock('../games/go/GoBoard', () => ({ GoBoard: ({ interactive, onPlay }: { interactive: boolean; onPlay: (move: {row:number;col:number}) => void }) => <button disabled={!interactive} onClick={() => onPlay({row:3,col:15})}>测试落子 Q16</button> }))

const state = studyGame.applyMove(studyGame.init(), { row: 3, col: 3 })
const game: GoLibraryGame = { id: 'source', title: '原局', favorite: false, mode: 'local', configuration: {}, archive: createGoArchive(state) }
let transport: KataGoTransport
beforeEach(() => {
  vi.spyOn(goLibrary, 'analyses').mockResolvedValue([])
  vi.spyOn(goLibrary, 'save').mockResolvedValue()
  vi.spyOn(goLibrary, 'saveAnalysis').mockResolvedValue()
  transport = { initialize: vi.fn().mockRejectedValue(new Error('引擎暂不可用')), analyze: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }
  vi.mocked(createConfiguredKataGoTransport).mockResolvedValue(transport)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('围棋复盘会话与保存故障', () => {
  it('StrictMode 下离开页面会取消初始化，迟到结果不写入分析', async () => {
    let resolve!: (value: KataGoCapabilities) => void
    let signal: AbortSignal | undefined
    vi.mocked(transport.initialize).mockImplementation((next) => { signal = next; return new Promise((done) => { resolve = done }) })
    const close = vi.fn()
    render(<StrictMode><GoStudyPage game={game} onClose={close} onOpen={vi.fn()} /></StrictMode>)
    await waitFor(() => expect(screen.getByText('分析本手')).toBeEnabled())
    fireEvent.click(screen.getByText('分析本手'))
    await waitFor(() => expect(transport.initialize).toHaveBeenCalled())
    fireEvent.click(screen.getByText('返回棋谱库'))
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve({} as KataGoCapabilities))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(transport.analyze).not.toHaveBeenCalled(); expect(goLibrary.saveAnalysis).not.toHaveBeenCalled()
    expect(transport.dispose).toHaveBeenCalledOnce()
  })
  it('重试第一手建立独立合法棋谱；存储和引擎失败保留练习并支持再次复盘', async () => {
    vi.mocked(goLibrary.save).mockRejectedValue(new Error('QuotaExceededError'))
    const open = vi.fn()
    render(<GoStudyPage game={game} onClose={vi.fn()} onOpen={open} />)
    await waitFor(() => expect(screen.getByText('分析本手')).toBeEnabled())
    fireEvent.click(screen.getByText('重试这一手'))
    fireEvent.click(screen.getByText('测试落子 Q16'))
    await waitFor(() => expect(screen.getByText(/练习保存：保存失败/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('引擎暂不可用')).toBeInTheDocument())
    const saved = vi.mocked(goLibrary.save).mock.calls[0][0]
    expect(saved.id).not.toBe(game.id); expect(saved.archive.moves).toEqual(['B:Q16'])
    expect(saved.source).toEqual({ gameId: game.id, moveNumber: 0 })
    expect(game.archive.moves).toEqual(['B:D16'])
    expect(screen.getByText('下载练习备份')).toBeEnabled()
    fireEvent.click(screen.getByText('复盘这盘练习'))
    await waitFor(() => expect(open).toHaveBeenCalledWith(saved))
  })
  it('停止初始化后可再次启动，复用旧局但重新创建可用传输', async () => {
    vi.mocked(transport.initialize).mockImplementation((signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), {once:true})))
    render(<GoStudyPage game={game} onClose={vi.fn()} onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('分析本手')).toBeEnabled())
    fireEvent.click(screen.getByText('分析本手'))
    await waitFor(() => expect(transport.initialize).toHaveBeenCalled())
    fireEvent.click(screen.getByText('停止'))
    await waitFor(() => expect(transport.dispose).toHaveBeenCalled())
    fireEvent.click(screen.getByText('分析本手'))
    await waitFor(() => expect(createConfiguredKataGoTransport).toHaveBeenCalledTimes(2))
  })
  it('曲线点击和键盘跳转使用走完第 N 手的手数', () => {
    const jump = vi.fn()
    render(<WinRateChart points={[{ moveNumber: 7, blackWinRate: .6, whiteWinRate: .4, visits: 256, requestedVisits: 256, elapsedMs: 100, timedOut: false, runtimeLabel: 'test', engineVersion: 'test', modelName: 'test' }]} status="ready" error={null} selectedMove={7} onSelectMove={jump} />)
    const point = screen.getByRole('button', { name: /第 7 手/ })
    expect(point).toHaveAttribute('aria-pressed','true')
    fireEvent.click(point); fireEvent.keyDown(point,{key:'Enter'})
    expect(jump.mock.calls).toEqual([[7], [7]])
  })
  it('自动保存沿用 ID 和创建时间，新局创建新记录，失败状态可恢复', async () => {
    const match = { state, mode: 'local', profile: 'fast', humanColor: 'black', battleEngines: {black:'katago',white:'katago'}, engineDetails:{} } as ReturnType<typeof useGoMatch>
    function SaveProbe({ value }: {value: ReturnType<typeof useGoMatch>}) {
      const saved = useGoLibraryMatch(value)
      return <><span>{saved.status}</span><button onClick={() => void saved.save()}>重存</button></>
    }
    const view = render(<StrictMode><SaveProbe value={match}/></StrictMode>)
    await waitFor(() => expect(screen.getByText('已保存')).toBeInTheDocument())
    const first = vi.mocked(goLibrary.save).mock.calls.at(-1)![0]
    view.rerender(<StrictMode><SaveProbe value={{...match,state:studyGame.applyMove(state,{row:15,col:15})}}/></StrictMode>)
    await waitFor(() => expect(vi.mocked(goLibrary.save).mock.calls.at(-1)![0].archive.moves).toHaveLength(2))
    const second = vi.mocked(goLibrary.save).mock.calls.at(-1)![0]
    expect(second.id).toBe(first.id); expect(second.archive.createdAt).toBe(first.archive.createdAt)
    view.rerender(<StrictMode><SaveProbe value={{...match,state:studyGame.init()}}/></StrictMode>)
    vi.mocked(goLibrary.save).mockRejectedValueOnce(new Error('storage failure'))
    view.rerender(<StrictMode><SaveProbe value={{...match,state:studyGame.applyMove(studyGame.init(),{row:0,col:0})}}/></StrictMode>)
    await waitFor(() => expect(screen.getByText('保存失败')).toBeInTheDocument())
    expect(vi.mocked(goLibrary.save).mock.calls.at(-1)![0].id).not.toBe(first.id)
    fireEvent.click(screen.getByText('重存'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeInTheDocument())
  })
})


describe('围棋临时练习入口', () => {
  it('从指定手数重走，不加载引擎、不自动保存，StrictMode 可重新开始', async () => {
    render(<StrictMode><GoStudyPage game={game} entry={{ initialIndex: 1, note: '答案备注' }} onClose={vi.fn()} onOpen={vi.fn()} /></StrictMode>)
    expect(screen.getByText('原棋谱 · 已走 1 / 1 手')).toBeInTheDocument()
    expect(screen.getByLabelText('练习执子')).toHaveValue('white')
    expect(screen.queryByText(/答案备注/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('重走一手'))
    fireEvent.click(screen.getByText('测试落子 Q16'))
    expect(screen.getByText('独立练习 · 已走 2 手')).toBeInTheDocument()
    expect(goLibrary.save).not.toHaveBeenCalled()
    expect(goLibrary.analyses).not.toHaveBeenCalled()
    expect(createConfiguredKataGoTransport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('重新开始本局面'))
    expect(screen.getByText('原棋谱 · 已走 1 / 1 手')).toBeInTheDocument()
  })
  it('两次虚着来源先只读，显式恢复不触发 AI 并保留历史', () => {
    const scoring = studyGame.applyMove(studyGame.applyMove(state, {kind:'pass'}), {kind:'pass'})
    render(<GoStudyPage game={{...game, archive:createGoArchive(scoring)}} entry={{initialIndex:3}} onClose={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('开始练习')).toBeDisabled()
    expect(screen.getByText('重走一手')).toBeDisabled()
    fireEvent.click(screen.getByText('恢复行棋练习'))
    expect(screen.getByText('开始练习')).toBeEnabled()
    expect(screen.getByText('独立练习 · 已走 3 手')).toBeInTheDocument()
    expect(createConfiguredKataGoTransport).not.toHaveBeenCalled()
    expect(goLibrary.save).not.toHaveBeenCalled()
  })
})

it('临时练习执非当前方只应手一次，重启与卸载隔离迟到结果',async()=>{
  vi.mocked(transport.initialize).mockResolvedValue({} as KataGoCapabilities)
  vi.spyOn(KataGoEngine.prototype,'initialize').mockResolvedValue()
  let complete!: (value:{action:{row:number;col:number}})=>void
  const think=vi.spyOn(KataGoEngine.prototype,'think').mockImplementation(()=>new Promise(done=>{complete=done}))
  const view=render(<StrictMode><GoStudyPage game={game} entry={{initialIndex:1}} onClose={vi.fn()} onOpen={vi.fn()}/></StrictMode>)
  fireEvent.change(screen.getByLabelText('练习执子'),{target:{value:'black'}})
  const start=screen.getByText('开始练习');fireEvent.click(start);fireEvent.click(start)
  await waitFor(()=>expect(think).toHaveBeenCalledOnce())
  await act(async()=>complete({action:{row:3,col:15}}))
  expect(screen.getByText('独立练习 · 已走 2 手')).toBeInTheDocument()
  expect(goLibrary.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('重新开始本局面'))
  fireEvent.click(screen.getByText('开始练习'))
  await waitFor(()=>expect(think).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByText('重新开始本局面'))
  await act(async()=>complete({action:{row:3,col:15}}))
  expect(screen.getByText('原棋谱 · 已走 1 / 1 手')).toBeInTheDocument()
  view.unmount();expect(goLibrary.save).not.toHaveBeenCalled()
})
