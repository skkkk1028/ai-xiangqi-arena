import { describe, expect, it, vi } from 'vitest'
import { compareGoMoves } from '../games/go/move-comparison'
import { studyGame } from '../games/go/study-analysis'
import { gtpToGoMove } from '../games/go/ai/coordinates'
import type { KataGoCapabilities, KataGoWireAnalysisEvent } from '../games/go/ai/types'
import type { KataGoTransport } from '../games/go/ai/KataGoTransport'
function event(overrides: Partial<KataGoWireAnalysisEvent> = {}): KataGoWireAnalysisEvent {
  return { type: 'analysis', stage: 'final', requestId: 'test', engineVersion: 'test', modelName: 'model', profile: 'winrate',
    elapsedMs: 100, requestedVisits: 256, runtimeBackend: 'browser-wasm', requestedBackend: 'browser-webgpu',
    backendFallback: true, backendFallbackReason: 'test', modelFallback: false, modelFallbackReason: null,
    timedOut: false, truncated: false, stopReason: 'visit-limit', root: { winrate: 0.6, scoreLead: 3, visits: 256 },
    candidates: [{ move: 'D16', order: 0, visits: 220, prior: 0.4, winrate: 0.7, scoreLead: 5, pv: ['D16', 'Q4', 'D16'] },
      { move: 'Q16', order: 1, visits: 36, prior: 0.2, winrate: 0.5, scoreLead: 1, pv: ['Q16'] }], ...overrides }
}

function fake(events: KataGoWireAnalysisEvent[]): KataGoTransport {
  return {initialize:vi.fn().mockResolvedValue({} as KataGoCapabilities),cancel:vi.fn(),dispose:vi.fn(),analyze:vi.fn().mockImplementation(async request=>({...events.shift(),requestId:request.requestId,profile:request.profile}))}
}
const d=gtpToGoMove('D16'),q=gtpToGoMove('Q16'),pass={kind:'pass' as const}
const signal=()=>new AbortController().signal
describe('围棋独立两招比较',()=>{
  it('同根候选只搜索一次，PV 丢弃非法尾部，黑白视角一致换算',async()=>{
    for(const white of [false,true]){
      const transport=fake([event()])
      const state=white?studyGame.applyMove(studyGame.init(),gtpToGoMove('A1')):studyGame.init()
      const result=await compareGoMoves(state,q,d,'winrate',signal(),transport)
      expect(transport.analyze).toHaveBeenCalledOnce()
      expect(result.selected.method).toBe('candidate')
      expect(result.selected.lossPoints).toBe(white?-4:4)
      expect(result.selected.lossWinrate).toBeCloseTo(white?-20:20)
      expect(result.reference?.variation).toEqual(['D16','Q4'])
    }
  })
  it('单招缺失补搜一次；双招缺失最多三次；两招相同只评估一次',async()=>{
    const empty=event({candidates:[]})
    const one=fake([event(),event()]);await compareGoMoves(studyGame.init(),pass,d,'winrate',signal(),one);expect(one.analyze).toHaveBeenCalledTimes(2)
    const both=fake([empty,event(),event()]);await compareGoMoves(studyGame.init(),q,d,'winrate',signal(),both);expect(both.analyze).toHaveBeenCalledTimes(3)
    const same=fake([empty,event()]);const result=await compareGoMoves(studyGame.init(),q,q,'winrate',signal(),same);expect(same.analyze).toHaveBeenCalledTimes(2);expect(result.selected).toBe(result.reference)
    const hit=fake([event()]);await compareGoMoves(studyGame.init(),q,q,'winrate',signal(),hit);expect(hit.analyze).toHaveBeenCalledOnce()
  })
  it('零 visits 候选要补搜，缺评分和模型不同不伪造损失',async()=>{
    const root=event({candidates:event().candidates.map((c,i)=>i===1?{...c,visits:0}:c)})
    const transport=fake([root,event({modelName:'different'})])
    const result=await compareGoMoves(studyGame.init(),q,undefined,'winrate',signal(),transport)
    expect(transport.analyze).toHaveBeenCalledTimes(2);expect(result.selected.method).toBe('after');expect(result.selected.lossPoints).toBeNull();expect(result.selected.lossWinrate).toBeNull()
    const missing=event({candidates:event().candidates.map((c,i)=>i===1?{...c,scoreLead:null}:c)})
    expect((await compareGoMoves(studyGame.init(),q,undefined,'winrate',signal(),fake([missing]))).selected.lossPoints).toBeNull()
  })
  it('第二次虚着补搜只作估计，不修改原局阶段',async()=>{
    const before=studyGame.applyMove(studyGame.init(),pass)
    const transport=fake([event(),event({timedOut:true,truncated:true})])
    const result=await compareGoMoves(before,pass,undefined,'winrate',signal(),transport)
    expect(result.selected.notes.join()).toContain('计分尚未确认');expect(result.selected.notes.join()).toContain('超时')
    expect(before.phase).toBe('playing');expect(before.consecutivePasses).toBe(1)
    expect(vi.mocked(transport.analyze).mock.calls[1][0].moves).toEqual([['B','pass'],['W','pass']])
  })
  it('非法落子、计分局面、预先取消均不启动搜索',async()=>{
    const before=studyGame.applyMove(studyGame.init(),d), transport=fake([])
    await expect(compareGoMoves(before,d,undefined,'winrate',signal(),transport)).rejects.toThrow()
    await expect(compareGoMoves(studyGame.applyMove(studyGame.applyMove(before,pass),pass),q,undefined,'winrate',signal(),transport)).rejects.toThrow()
    const aborted=new AbortController();aborted.abort()
    await expect(compareGoMoves(before,q,undefined,'winrate',aborted.signal,transport)).rejects.toThrow()
    expect(transport.initialize).not.toHaveBeenCalled();expect(transport.analyze).not.toHaveBeenCalled()
  })
  it('根搜索迟到且已取消，不继续补搜',async()=>{
    const controller=new AbortController(),transport=fake([])
    vi.mocked(transport.analyze).mockImplementation(async request=>{controller.abort();return {...event(),requestId:request.requestId}})
    await expect(compareGoMoves(studyGame.init(),pass,q,'winrate',controller.signal,transport)).rejects.toThrow()
    expect(transport.analyze).toHaveBeenCalledOnce()
  })
})
