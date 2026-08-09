import { describe, expect, it } from 'vitest'
import { GO_CALIBRATION_OPENINGS } from '../../benchmark/go-ai/openings'
import { gtpToGoMove } from '../games/go/ai'
import { GoGameEngine } from '../games/go/game-engine'

describe('围棋 AI 校准开局集', () => {
  it('包含 50 个固定、唯一且经项目规则验证的十九路开局', () => {
    expect(GO_CALIBRATION_OPENINGS).toHaveLength(50)
    expect(new Set(GO_CALIBRATION_OPENINGS.map((opening) => opening.moves.join(','))).size).toBe(50)
    const rules = new GoGameEngine()
    for (const opening of GO_CALIBRATION_OPENINGS) {
      let state = rules.init()
      for (const vertex of opening.moves) state = rules.applyMove(state, gtpToGoMove(vertex))
      expect(state.phase, opening.id).toBe('playing')
      expect(state.history, opening.id).toHaveLength(opening.moves.length)
    }
  })
})
