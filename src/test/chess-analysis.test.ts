import { describe, expect, it } from 'vitest'
import { evaluationCpForWhite, formatWhiteScore, pvToSan, wdlForWhite } from '../games/chess/analysis'
import { alternateChessSeed } from '../games/chess/openings'
import { chessPersonalityForColor } from '../games/chess/ai-engine'
import type { SearchInfo } from '../game/types'

const BLACK_INFO: SearchInfo = {
  depth: 18,
  nodes: 1_000,
  nps: 10_000,
  elapsedMs: 100,
  score: { kind: 'cp', value: 42 },
  wdl: { win: 600, draw: 250, loss: 150 },
  pv: ['e7e5', 'g1f3'],
}

describe('国际象棋分析视角与人格轮换', () => {
  it('把黑方分数和 WDL 统一转换为白方视角', () => {
    expect(formatWhiteScore(BLACK_INFO, 'b')).toBe('-0.42')
    expect(evaluationCpForWhite(BLACK_INFO, 'b')).toBe(-42)
    expect(wdlForWhite(BLACK_INFO.wdl, 'b')).toEqual({ win: 150, draw: 250, loss: 600 })
  })

  it('使用分析自己的根 FEN 转换完整 SAN 主变化', () => {
    const rootFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    expect(pvToSan(rootFen, ['e7e5', 'g1f3', 'b8c6'])).toBe('e5 Nf3 Nc6')
  })

  it('新种子无论候选奇偶如何都保证白方人格翻转', () => {
    for (const candidate of [2, 3, 0xffffffff, 0xfffffffe]) {
      const next = alternateChessSeed(12, candidate)
      expect(chessPersonalityForColor(next, 'w')).not.toBe(chessPersonalityForColor(12, 'w'))
      expect(chessPersonalityForColor(next, 'b')).not.toBe(chessPersonalityForColor(12, 'b'))
    }
  })
})
