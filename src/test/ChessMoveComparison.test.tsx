import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChessMoveComparison } from '../games/chess/ChessMoveComparison'
import { ChessStudyEngine } from '../games/chess/study-engine'
import { replayChessState } from '../games/chess/rules'
import type { StudySearch } from '../games/chess/move-comparison'
const info = {depth:12,nodes:100,nps:100,elapsedMs:3000,score:{kind:'cp' as const,value:20},wdl:null,pv:['e2e4']}
const response:StudySearch={engine:{name:'Stockfish',version:'18',backend:'worker',threads:1,hashMb:64},elapsedMs:3000,timedOut:false,response:{bestmove:'e2e4',info,candidates:[{...info,multipv:1}]}}
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('完成结果按档位缓存，主动重算和加深才再次搜索',async()=>{
 const search=vi.spyOn(ChessStudyEngine.prototype,'search').mockResolvedValue(response)
 render(<StrictMode><ChessMoveComparison before={replayChessState([])} selected="e2e4" reference="e2e4" /></StrictMode>)
 expect(search).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'分析我的猜招'}))
 await waitFor(()=>expect(screen.getByText(/每次预算 3000/)).toBeInTheDocument())
 fireEvent.click(screen.getByRole('button',{name:'分析我的猜招'}));expect(search).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'重新分析'}));await waitFor(()=>expect(search).toHaveBeenCalledTimes(2))
 await waitFor(()=>expect(screen.getByRole('button',{name:/加深分析/})).toBeEnabled())
 fireEvent.click(screen.getByRole('button',{name:/加深分析/}));await waitFor(()=>expect(search).toHaveBeenCalledTimes(3))
 expect(search.mock.calls[2][2]).toBe('deep')
})
it('停止后可重试，旧任务和切题的迟到结果不能显示',async()=>{
 const pending:Array<(r:StudySearch)=>void>=[]
 vi.spyOn(ChessStudyEngine.prototype,'search').mockImplementation(()=>new Promise(r=>pending.push(r)))
 const view=render(<ChessMoveComparison before={replayChessState([])} selected="e2e4" />)
 fireEvent.click(screen.getByRole('button',{name:'分析我的猜招'}));fireEvent.click(screen.getByRole('button',{name:'停止分析'}))
 fireEvent.click(screen.getByRole('button',{name:'分析我的猜招'}))
 await act(async()=>pending[0](response));expect(screen.queryByText(/每次预算 3000/)).not.toBeInTheDocument()
 view.rerender(<ChessMoveComparison before={replayChessState([])} selected="d2d4" />)
 await act(async()=>pending[1](response));expect(screen.queryByText(/每次预算 3000/)).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'分析我的猜招'})).toBeEnabled()
})
