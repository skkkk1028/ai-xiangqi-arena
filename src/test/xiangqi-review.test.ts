import { describe, expect, it, vi } from 'vitest'
import type { EngineAdapter } from '../engine/adapter'
import type { EngineScore, EngineSearchResponse, SearchCandidate } from '../game/types'
import { compareReviewMoves, analyzeReviewMove, recordedCaptureNotes, reviewPositions } from '../games/xiangqi/review'

function response(bestmove: string, score: EngineScore | null, candidates: SearchCandidate[] = []): EngineSearchResponse {
  return { bestmove, info: { depth: 10, nodes: 100, nps: 100, elapsedMs: 10, score, wdl: null, pv: [bestmove] }, candidates }
}
function adapter(...responses: EngineSearchResponse[]) {
  const search = vi.fn()
  for (const value of responses) search.mockResolvedValueOnce(value)
  return { engine: { search } as unknown as EngineAdapter, search }
}
const cp = (value: number): EngineScore => ({ kind: 'cp', value })

describe('象棋可核验复盘', () => {
  it('棋谱逐手校验，吃子事实不直接推断失误', () => {
    const positions = reviewPositions(['a3a4', 'a6a5', 'a4a5'])
    expect(positions).toHaveLength(4)
    const records = positions[3].history.map((move) => ({ ...move, score: null, wdl: null, depth: 0 }))
    expect(recordedCaptureNotes(records, 1)[0]).toContain('己方的卒')
    expect(recordedCaptureNotes(records, 1)[0]).toContain('不能仅据此判错')
    expect(() => reviewPositions(['a0a9'])).toThrow('不是合法')
    expect(positions[0].history).toHaveLength(0)
  })

  it.each([{ prefix: [] as string[] }, { prefix: ['a3a4'] }])('红黑行棋方均将落子后对方评价翻转，前缀 $prefix', async ({ prefix }) => {
    const before = reviewPositions(prefix).at(-1)!
    const white = prefix.length === 0
    const best = white ? 'b0c2' : 'b9c7'
    const played = white ? 'a3a4' : 'a6a5'
    const { engine, search } = adapter(response(best, cp(120)), response(white ? 'b9c7' : 'b0c2', cp(30)))
    const result = await analyzeReviewMove(engine, before, played)
    expect(result.playedScore).toEqual(cp(-30))
    expect(result.lossCp).toBe(150)
    expect(result.comparison).toBe('after-move')
    expect(search.mock.calls[1][0]).toEqual([...prefix, played])
  })

  it('同深度候选直接比较，不多搜也不翻转同根评价', async () => {
    const root = response('b0c2', cp(120))
    root.candidates = [{ ...root.info, pv: ['a3a4'], score: cp(90), multipv: 2 }]
    const { engine, search } = adapter(root)
    const result = await analyzeReviewMove(engine, reviewPositions([])[0], 'a3a4')
    expect(result.lossCp).toBe(30)
    expect(result.comparison).toBe('same-root')
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('只把实际提子写成棋谱事实', async () => {
    const before = reviewPositions(['a3a4', 'a6a5']).at(-1)!
    const { engine } = adapter(response('a4a5', cp(80)))
    const result = await analyzeReviewMove(engine, before, 'a4a5')
    expect(result.notes.join()).toContain('棋谱事实：本手吃掉对方的卒')
  })

  it('不同深度候选必须补搜，缺失评价不制造评价差', async () => {
    const root = response('b0c2', cp(120))
    root.candidates = [{ ...root.info, pv: ['a3a4'], score: cp(-999), multipv: 2, depth: 9 }]
    const { engine, search } = adapter(root, response('b9c7', null))
    const result = await analyzeReviewMove(engine, reviewPositions([])[0], 'a3a4')
    expect(search).toHaveBeenCalledTimes(2)
    expect(result.lossCp).toBeNull()
    expect(result.notes.join()).toContain('评价信息不足')
  })

  it('可能漏杀只表达搜索证据，不把 mate 当厘兵相减', async () => {
    const { engine } = adapter(response('b0c2', { kind: 'mate', value: 3 }), response('b9c7', cp(10)))
    const result = await analyzeReviewMove(engine, reviewPositions([])[0], 'a3a4')
    expect(result.lossCp).toBeNull()
    expect(result.notes.join()).toContain('尚不能证明实战着无杀')
  })

  it('取消后不补搜，非法最佳着直接拒绝', async () => {
    const { engine, search } = adapter(response('b0c2', cp(100)))
    let checks = 0
    await expect(analyzeReviewMove(engine, reviewPositions([])[0], 'a3a4', () => {
      if (++checks === 2) throw new DOMException('取消', 'AbortError')
    })).rejects.toThrow('取消')
    expect(search).toHaveBeenCalledTimes(1)
    const invalid = adapter(response('a0a9', cp(100)))
    await expect(analyzeReviewMove(invalid.engine, reviewPositions([])[0], 'a3a4')).rejects.toThrow('合法最佳着')
  })
})

describe('两招共享根局面分析', () => {
  it('两个同深度候选只搜索一次，相同着法复用结果', async () => {
    const root = response('b0c2', cp(120))
    root.candidates = [{ ...root.info, pv: ['a3a4'], score: cp(90), multipv: 2 }]
    const first = adapter(root)
    const result = await compareReviewMoves(first.engine, reviewPositions([])[0], 'a3a4', 'b0c2')
    expect(first.search).toHaveBeenCalledTimes(1)
    expect(result.user.playedScore).toEqual(cp(90))
    expect(result.reference?.playedScore).toEqual(cp(120))
    const same = adapter(root)
    const duplicate = await compareReviewMoves(same.engine, reviewPositions([])[0], 'a3a4', 'a3a4')
    expect(same.search).toHaveBeenCalledTimes(1)
    expect(duplicate.user).toBe(duplicate.reference)
  })
  it('两招都不在候选时最多三次搜索，补搜统一视角', async () => {
    const { engine, search } = adapter(response('b0c2', cp(120)), response('b9c7', cp(30)), response('b9c7', cp(50)))
    const result = await compareReviewMoves(engine, reviewPositions([])[0], 'a3a4', 'c3c4')
    expect(search).toHaveBeenCalledTimes(3)
    expect(result.user.playedScore).toEqual(cp(-30))
    expect(result.reference?.playedScore).toEqual(cp(-50))
  })
  it('参考着法非法时不启动搜索，非法 PV 只展示合法前缀', async () => {
    const root = response('b0c2', cp(120)); root.info.pv = ['b0c2', 'a0a9']
    const { engine, search } = adapter(root)
    await expect(compareReviewMoves(engine, reviewPositions([])[0], 'b0c2', 'a0a9')).rejects.toThrow('不一致')
    expect(search).not.toHaveBeenCalled()
    const result = await compareReviewMoves(engine, reviewPositions([])[0], 'b0c2')
    expect(result.user.variation).toHaveLength(1)
  })
})
