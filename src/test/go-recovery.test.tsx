import { StrictMode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GoGameEngine } from '../games/go/game-engine'
import { createGoArchive, exportGoSgf, importGoSgf, restoreGoArchive } from '../games/go/sgf'
import { replayAnalysisPositions, useGoMatch } from '../games/go/useGoMatch'
import { useGoWinRateAnalysis } from '../games/go/useGoWinRateAnalysis'

afterEach(cleanup)
const engine = new GoGameEngine()
function scoringPosition() {
  let state = engine.applyMove(engine.init(), { row: 3, col: 3 })
  state = engine.applyMove(state, { row: 15, col: 15 })
  state = engine.applyMove(state, { kind: 'pass' })
  return engine.applyMove(state, { kind: 'pass' })
}

describe('围棋生命周期与档案回归', () => {
  it('StrictMode 重放 Effect 后仍可落子和虚着', () => {
    const { result } = renderHook(() => useGoMatch(), { wrapper: StrictMode })
    act(() => result.current.execute({ row: 3, col: 3 }))
    expect(result.current.state.history).toHaveLength(1)
    act(() => result.current.execute({ kind: 'pass' }))
    expect(result.current.state.history).toHaveLength(2)
  })

  it('StrictMode 下分析队列仍启动并发布失败状态', async () => {
    const { result } = renderHook(() => useGoWinRateAnalysis({
      createTransport: async () => { throw new Error('测试连接失败') },
    }), { wrapper: StrictMode })
    await act(async () => result.current.enqueuePostgame([engine.applyMove(engine.init(), { row: 3, col: 3 })]))
    expect(result.current.error).toContain('测试连接失败')
  })

  it('已结束棋局保留死子方案和重新核验的终局', () => {
    const final = engine.finalizeScoring(scoringPosition(), { deadStoneRepresentatives: [{ row: 3, col: 3 }] })
    const archive = createGoArchive(final)
    expect(restoreGoArchive(JSON.stringify(archive))).toEqual(final)
    expect(() => restoreGoArchive({ ...archive, result: { ...archive.result, margin: 123 } })).toThrow('重算')
    expect(() => restoreGoArchive({ ...archive, ruleset: 'other' })).toThrow('规则集')
    expect(() => restoreGoArchive({ ...archive, result: { ...archive.result, confirmedDeadStones: [{ row: -1, col: 0 }] } })).toThrow('坐标')
  })

  it('兼容无死子旧终局，但拒绝无法重建的旧死子结算', () => {
    const final = engine.finalizeScoring(scoringPosition())
    const archive = createGoArchive(final)
    delete archive.result!.confirmedDeadStones
    expect(restoreGoArchive(archive).result).toEqual(final.result)
    const dead = createGoArchive(engine.finalizeScoring(scoringPosition(), { deadStoneRepresentatives: [{ row: 3, col: 3 }] }))
    delete dead.result!.confirmedDeadStones
    expect(() => restoreGoArchive(dead)).toThrow('旧档案')
  })

  it('恢复行棋前后、再次双虚着和终局均可往返，分析与 SGF 也可重放', () => {
    let state = scoringPosition()
    expect(restoreGoArchive(createGoArchive(state))).toEqual(state)
    state = engine.resumePlay(state)
    expect(restoreGoArchive(createGoArchive(state))).toEqual(state)
    state = engine.applyMove(state, { row: 4, col: 3 })
    expect(restoreGoArchive(createGoArchive(state))).toEqual(state)
    expect(replayAnalysisPositions(state).at(-1)).toEqual(state)
    expect(importGoSgf(exportGoSgf(state))).toEqual(state)
    state = engine.applyMove(state, { kind: 'pass' })
    state = engine.applyMove(state, { kind: 'pass' })
    state = engine.finalizeScoring(state)
    expect(restoreGoArchive(createGoArchive(state))).toEqual(state)
  })
})
