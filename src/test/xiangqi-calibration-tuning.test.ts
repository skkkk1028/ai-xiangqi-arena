import { describe, expect, it } from 'vitest'
import {
  bisectNodeBudget,
  enhancedFullStrengthCandidate,
  formalQualification,
  geometricNodeProbes,
  passesLatencyGate,
} from '../games/xiangqi/calibration-tuning'
import { assertXiangqiResourceIncrease } from '../games/xiangqi/strength-profile'

describe('中国象棋只增强调参约束', () => {
  it('按几何级探测并在相邻预算间取几何中点', () => {
    expect(geometricNodeProbes(30_000, 240_000)).toEqual([60_000, 120_000, 240_000])
    expect(bisectNodeBudget(120_000, 240_000)).toBe(169_706)
  })

  it('拒绝降低参考资源或突破硬上限', () => {
    expect(() => assertXiangqiResourceIncrease(
      { maxNodes: 100_000, maxThinkMs: 6_000 },
      { maxNodes: 99_999, maxThinkMs: 6_000 },
    )).toThrow('禁止降低节点')
    expect(() => enhancedFullStrengthCandidate(18_000, 55_000, 'battle-full')).toThrow('3 倍')
    expect(enhancedFullStrengthCandidate(18_000, 54_000, 'battle-full')).toMatchObject({ budgetMs: 54_000, multiPv: 1 })
  })

  it('以实际第 95 百分位和完整运行门槛判定认证', () => {
    expect(passesLatencyGate('human-l1', [...Array.from({ length: 95 }, () => 2_900), ...Array.from({ length: 5 }, () => 3_100)])).toBe(true)
    const clean = {
      practicallyEquivalent: true,
      technicalFailures: 0,
      timeouts: 0,
      moveLimits: 0,
      invalidPairs: 0,
    }
    expect(formalQualification(clean, true)).toBe('validated')
    expect(formalQualification({ ...clean, timeouts: 1 }, true)).toBe('unmatched')
  })
})
