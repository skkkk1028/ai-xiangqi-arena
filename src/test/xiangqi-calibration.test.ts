import { describe, expect, it } from 'vitest'
import {
  createCalibrationSchedule,
  summarizeCalibration,
  wilsonInterval,
  XIANGQI_CALIBRATION_TARGETS,
} from '../games/xiangqi/calibration'

describe('中国象棋强度校准统计', () => {
  it('为每个开局生成交换红黑的成对赛程', () => {
    const schedule = createCalibrationSchedule('a', 'b', 3, 42)
    expect(schedule).toHaveLength(6)
    expect(schedule[0]).toMatchObject({ pairIndex: 0, gameIndex: 0, redEngineId: 'a', blackEngineId: 'b', swapped: false })
    expect(schedule[1]).toMatchObject({ pairIndex: 0, gameIndex: 1, redEngineId: 'b', blackEngineId: 'a', swapped: true })
    expect(schedule[0].openingSeed).toBe(schedule[1].openingSeed)
    expect(schedule[2].openingSeed).not.toBe(schedule[0].openingSeed)
  })

  it('输出胜和负、Wilson 区间与描述性 Elo', () => {
    const results = [
      { pairIndex: 0, gameIndex: 0, openingSeed: 1, redEngineId: 'a', blackEngineId: 'b', outcome: 'red-win' as const, plies: 40 },
      { pairIndex: 0, gameIndex: 1, openingSeed: 1, redEngineId: 'b', blackEngineId: 'a', outcome: 'black-win' as const, plies: 42 },
      { pairIndex: 1, gameIndex: 2, openingSeed: 2, redEngineId: 'a', blackEngineId: 'b', outcome: 'draw' as const, plies: 120 },
      { pairIndex: 1, gameIndex: 3, openingSeed: 2, redEngineId: 'b', blackEngineId: 'a', outcome: 'technical' as const, plies: 0, technicalError: 'test' },
    ]
    const summary = summarizeCalibration(results, 'a', 'b')
    expect(summary).toMatchObject({ games: 3, wins: 2, draws: 1, losses: 0, technicalFailures: 1, scoreRate: 5 / 6 })
    expect(summary.eloDifference).toBeGreaterThan(200)
    expect(summary.practicallyEquivalent).toBe(false)
    expect(summary.scoreRateWilson95[0]).toBeLessThan(summary.scoreRate)
    expect(summary.scoreRateWilson95[1]).toBeGreaterThan(summary.scoreRate)
  })

  it('只有足够窄且无技术失败的区间才认定实用等效', () => {
    const interval = wilsonInterval(0.5, 500)
    expect(interval[0]).toBeGreaterThanOrEqual(XIANGQI_CALIBRATION_TARGETS.equivalenceBand.low)
    expect(interval[1]).toBeLessThanOrEqual(XIANGQI_CALIBRATION_TARGETS.equivalenceBand.high)
    const shortDrawReport = summarizeCalibration(
      Array.from({ length: 500 }, (_, index) => ({
        pairIndex: Math.floor(index / 2),
        gameIndex: index,
        openingSeed: index,
        redEngineId: index % 2 === 0 ? 'a' : 'b',
        blackEngineId: index % 2 === 0 ? 'b' : 'a',
        outcome: 'draw' as const,
        plies: 120,
        termination: 'move-limit' as const,
      })),
      'a',
      'b',
    )
    expect(shortDrawReport.practicallyEquivalent).toBe(false)
  })
})
