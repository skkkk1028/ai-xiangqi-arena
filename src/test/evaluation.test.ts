import { describe, expect, it } from 'vitest'
import { normalizePositionEvaluation } from '../engine/evaluation'

describe('局面评价视角转换', () => {
  it('把黑方行棋视角的正 cp 转换为黑方优势', () => {
    const result = normalizePositionEvaluation(
      { kind: 'cp', value: 60 },
      { win: 600, draw: 300, loss: 100 },
      'black',
    )
    expect(result.cpFromRed).toBe(-60)
    expect(result.label).toBe('黑方优势 +0.60')
    expect(result.wdlFromRed).toEqual({ win: 100, draw: 300, loss: 600 })
  })

  it('保留红方行棋视角并单独显示将杀', () => {
    expect(normalizePositionEvaluation({ kind: 'cp', value: 35 }, null, 'red').label).toBe(
      '红方优势 +0.35',
    )
    expect(normalizePositionEvaluation({ kind: 'mate', value: -4 }, null, 'red').label).toBe(
      '黑方将杀（4 步）',
    )
    expect(normalizePositionEvaluation({ kind: 'mate', value: 3 }, null, 'black').label).toBe(
      '黑方将杀（3 步）',
    )
  })
})
