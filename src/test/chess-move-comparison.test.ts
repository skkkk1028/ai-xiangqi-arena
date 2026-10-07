import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChessStudyEngine } from '../games/chess/study-engine'
import { compareChessMoves, comparisonDifference, type StudySearch } from '../games/chess/move-comparison'
import { replayChessState } from '../games/chess/rules'
const info = (move: string, depth = 12, value = 20) => ({depth, nodes:100, nps:100, elapsedMs:3000, score:{kind:'cp' as const,value}, wdl:null, pv:[move]})
function response(moves: string[], depths?: number[]): StudySearch { return {engine:{name:'Stockfish',version:'18',backend:'worker',threads:1,hashMb:64},elapsedMs:3000,timedOut:false,response:{bestmove:moves[0],info:info(moves[0]), candidates:moves.map((move,i)=>({...info(move,depths?.[i]),multipv:i+1}))}} }
afterEach(() => vi.restoreAllMocks())
describe('独立两招比较', () => {
  it('两招同根同深度仅一次搜索，同招共用证据', async () => {
    const search = vi.spyOn(ChessStudyEngine.prototype,'search').mockResolvedValue(response(['e2e4','d2d4']))
    const result = await compareChessMoves(replayChessState([]),'e2e4','d2d4')
    expect(search).toHaveBeenCalledTimes(1); expect(result.selected.method).toBe('root')
    expect(comparisonDifference(result.reference!,result.best)).toBe(0)
    const same = await compareChessMoves(replayChessState([]),'e2e4','e2e4')
    expect(same.selected).toBe(same.reference)
  })
  it('候选不同深度补搜，翻转落子后视角；最多三次', async () => {
    const search = vi.spyOn(ChessStudyEngine.prototype,'search').mockResolvedValueOnce(response(['g1f3','e2e4'],[12,10])).mockResolvedValue(response(['e7e5']))
    const result = await compareChessMoves(replayChessState([]),'e2e4','d2d4')
    expect(search).toHaveBeenCalledTimes(3); expect(result.selected.score?.value).toBe(-20); expect(result.reference?.method).toBe('after')
    expect(search.mock.calls.map(call=>call[3])).toEqual([4,1,1])
  })
  it('黑方根评分不翻转；缺失候选补搜；配置不一致不能计算损失', async () => {
    const fallback = response(['g1f3']); fallback.engine.backend='native'
    vi.spyOn(ChessStudyEngine.prototype,'search').mockResolvedValueOnce(response(['e7e5'])).mockResolvedValue(fallback)
    const result = await compareChessMoves(replayChessState(['e2e4']),'d7d5','e7e5')
    expect(result.reference?.score?.value).toBe(20); expect(result.selected.score?.value).toBe(-20)
    expect(comparisonDifference(result.selected,result.best)).toBeNull()
  })
  it('非法输入不搜索；将死着只使用规则终局证据', async () => {
    const search = vi.spyOn(ChessStudyEngine.prototype,'search').mockResolvedValue(response(['d8h4']))
    await expect(compareChessMoves(replayChessState([]),'e2e5')).rejects.toThrow()
    expect(search).not.toHaveBeenCalled()
    const result = await compareChessMoves(replayChessState(['f2f3','e7e5','g2g4']),'d8h4')
    expect(search).toHaveBeenCalledTimes(1); expect(result.selected.method).toBe('terminal'); expect(result.selected.score).toBeNull()
  })
  it('取消销毁独立实例，迟到结果被拒绝', async () => {
    let resolve!: (r: StudySearch) => void
    vi.spyOn(ChessStudyEngine.prototype,'search').mockImplementation(()=>new Promise(r=>{resolve=r}))
    const dispose=vi.spyOn(ChessStudyEngine.prototype,'dispose')
    const controller=new AbortController()
    const pending=compareChessMoves(replayChessState([]),'e2e4',undefined,'quick',controller.signal)
    controller.abort(); resolve(response(['e2e4']))
    await expect(pending).rejects.toMatchObject({name:'AbortError'}); expect(dispose).toHaveBeenCalled()
  })
})
