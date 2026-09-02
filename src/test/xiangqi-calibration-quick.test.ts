import { describe, expect, it } from 'vitest'
import {
  assessQuickCandidate,
  determineQuickReference,
  quickDeadlineReached,
  quickFullStrengthTimes,
  quickNodeBudget,
  quickOpeningSectionsAreDisjoint,
  shouldExtendQuickBaseline,
  summarizeCalibration,
  type CalibrationSummary,
} from '../games/xiangqi'

function summary(engineId: string, opponentId: string, scoreRate: number, interval: readonly [number, number]): CalibrationSummary {
  return {
    ...summarizeCalibration([], engineId, opponentId),
    pairs: 50,
    scoreRate,
    eloDifference: scoreRate === 0.5 ? 0 : 400 * Math.log10(scoreRate / (1 - scoreRate)),
    eloInterval95: interval,
    technicalFailures: 0,
    timeouts: 0,
    moveLimits: 0,
    invalidPairs: 0,
  }
}

describe('中国象棋六小时快速工程校准', () => {
  it('冻结 220 局面分区且基线只在区间仍包含零时扩展', () => {
    expect(quickOpeningSectionsAreDisjoint()).toBe(true)
    expect(shouldExtendQuickBaseline(summary('a', 'b', 0.5, [-80, 80]), 20)).toBe(true)
    expect(shouldExtendQuickBaseline(summary('a', 'b', 0.7, [10, 160]), 20)).toBe(false)
    expect(shouldExtendQuickBaseline(summary('a', 'b', 0.5, [-40, 40]), 50)).toBe(false)
  })

  it('只在两场都领先时给出唯一参考，否则保留共同领先', () => {
    const unique = determineQuickReference(['a', 'b', 'c'], [
      summary('a', 'b', 0.65, [15, 140]),
      summary('a', 'c', 0.7, [25, 180]),
      summary('b', 'c', 0.55, [-20, 90]),
    ])
    expect(unique).toMatchObject({ uniqueLeader: 'a', referenceEngineId: 'a', status: 'unique-leader' })
    expect(unique.weakerEngineIds).toContain('c')

    const shared = determineQuickReference(['a', 'b', 'c'], [
      summary('a', 'b', 0.5, [-60, 60]),
      summary('a', 'c', 0.5, [-60, 60]),
      summary('b', 'c', 0.5, [-60, 60]),
    ])
    expect(shared).toMatchObject({ referenceEngineId: null, status: 'shared-lead' })
  })

  it('快速候选最多发布 provisional，并把只改善但未拉齐的配置标为 unmatched', () => {
    expect(assessQuickCandidate(summary('a', 'b', 0.5, [-80, 80]), 0.3, true)).toMatchObject({
      status: 'provisional',
      quickMatched: true,
    })
    expect(assessQuickCandidate(summary('a', 'b', 0.4, [-130, 20]), 0.25, true)).toMatchObject({
      status: 'unmatched',
      improved: true,
    })
    expect(assessQuickCandidate(summary('a', 'b', 0.5, [-80, 80]), 0.3, false).status).toBe('unchanged')
  })

  it('只增加节点和时间并执行生产硬上限与六小时时间守卫', () => {
    expect(quickNodeBudget(30_000, 2.5)).toBe(80_000)
    expect(quickNodeBudget(900_000, 10)).toBe(5_000_000)
    expect(quickFullStrengthTimes(12_000, 18_000, 3, 55_000)).toEqual([36_000, 54_000])
    expect(quickFullStrengthTimes(25_000, 60_000, 3, 60_000)).toEqual([60_000, 60_000])
    expect(quickDeadlineReached(1_000, 999)).toBe(false)
    expect(quickDeadlineReached(1_000, 1_000)).toBe(true)
  })
})
