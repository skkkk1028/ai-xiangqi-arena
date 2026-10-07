import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChessStudyPage } from '../games/chess/ChessStudyPage'
import { ChessStudyEngine } from '../games/chess/study-engine'
import { chessLibrary } from '../games/chess/library'
import { ChessGameEngine, replayChessState } from '../games/chess/rules'
import type { StudySearch } from '../games/chess/move-comparison'
const source = replayChessState([])
const response: StudySearch = {engine:{name:'Stockfish',version:'18',backend:'worker',threads:1,hashMb:64},elapsedMs:3000,timedOut:false,response:{bestmove:'e2e4',info:{depth:12,nodes:100,nps:100,elapsedMs:3000,score:{kind:'cp',value:20},wdl:null,pv:['e2e4']},candidates:[]}}
afterEach(()=>{cleanup();vi.restoreAllMocks()})
describe('临时练习与原局隔离',()=>{
  it('浏览与重走不加载引擎、不保存；参考默认收起，完整历史不变',()=>{
    const search=vi.spyOn(ChessStudyEngine.prototype,'search')
    const save=vi.spyOn(chessLibrary,'save')
    render(<StrictMode><ChessStudyPage entry={{state:source,source:'原局',note:'答案备注',reference:{actual:'d2d4'}}} onClose={()=>{}} /></StrictMode>)
    expect(screen.queryByText('答案备注')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重走一手'}))
    fireEvent.click(screen.getByRole('gridcell',{name:/e2 白方p/}));fireEvent.click(screen.getByRole('gridcell',{name:/e4 可落子/}))
    expect(screen.getByText(/本次作答：e4/)).toBeInTheDocument()
    expect(source.history).toHaveLength(0);expect(search).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'查看参考'}));expect(screen.getByText('答案备注')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重新作答'}));expect(screen.queryByText(/本次作答/)).not.toBeInTheDocument()
  })
  it('执黑 AI 先行仅一手，重启后迟到响应不落子',async()=>{
    let resolve!: (value:StudySearch)=>void
    const search=vi.spyOn(ChessStudyEngine.prototype,'search').mockImplementation(()=>new Promise(r=>{resolve=r}))
    const dispose=vi.spyOn(ChessStudyEngine.prototype,'dispose')
    render(<StrictMode><ChessStudyPage entry={{state:source,source:'原局'}} /></StrictMode>)
    fireEvent.change(screen.getByRole('combobox',{name:'执子'}),{target:{value:'b'}})
    fireEvent.click(screen.getByRole('button',{name:'开始练习'}))
    await waitFor(()=>expect(search).toHaveBeenCalledTimes(1))
    await act(async()=>resolve(response))
    expect(screen.getByText(/已走 1 手/)).toBeInTheDocument();expect(search).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button',{name:'重新开始本局面'}))
    fireEvent.change(screen.getByRole('combobox',{name:'执子'}),{target:{value:'b'}});fireEvent.click(screen.getByRole('button',{name:'开始练习'}))
    await waitFor(()=>expect(search).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button',{name:'重新开始本局面'}))
    await act(async()=>resolve(response))
    expect(screen.getByText(/已走 0 手/)).toBeInTheDocument();expect(dispose).toHaveBeenCalled()
  })
  it('忽略和棋声明不执行声明预定着法，不自动搜索',()=>{
    const state=replayChessState(['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1'])
    const rules=new ChessGameEngine();const claim=rules.getLegalActions(state).find(a=>a.kind==='claim-draw' && a.intendedMove?.from==='f6')!
    const ended=rules.executeAction(state,claim);const search=vi.spyOn(ChessStudyEngine.prototype,'search')
    render(<ChessStudyPage entry={{state:ended,source:'和棋'}} />)
    expect(screen.queryByRole('button',{name:'开始练习'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'忽略和棋声明并练习'}))
    expect(screen.getByText(/已走 7 手/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'开始练习'})).toBeEnabled()
    expect(ended.result?.termination).toBe('claim');expect(search).not.toHaveBeenCalled()
  })
})
