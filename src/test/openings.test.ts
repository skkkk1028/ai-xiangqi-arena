import { describe, expect, it } from 'vitest'
import { OPENING_PREFIXES, selectOpening } from '../engine/openings'
import { AI_PERSONALITIES, PERSONALITY_RUNTIME } from '../engine/personality'
import { applyMove, createInitialBoard, opposite } from '../game/board'
import { getLegalMoves } from '../game/rules'
import { matchUcciMove } from '../engine/ucci'
import type { Color } from '../game/types'

describe('AI 人格化开局', () => {
  it('同一 seed 始终选择同一条命名棋谱', () => {
    expect(selectOpening(20260730)).toEqual(selectOpening(20260730))
    expect(selectOpening(20260730).moves).toHaveLength(4)
  })

  it('所有内置棋谱都能从初始局面逐步合法执行', () => {
    for (const prefix of OPENING_PREFIXES) {
      let board = createInitialBoard()
      let turn: Color = 'red'
      for (const ucci of prefix) {
        const move = matchUcciMove(board, getLegalMoves(board, turn), ucci)
        expect(move, `${prefix.join(' ')} 中的 ${ucci} 非法`).not.toBeNull()
        board = applyMove(board, move!)
        turn = opposite(turn)
      }
    }
  })

  it('红方和黑方条件开局权重符合人格配置', () => {
    const samples = Array.from({ length: 20_000 }, (_, seed) => selectOpening(seed))
    const redCounts = countBy(samples, (opening) => opening.redFamily)

    expect(redCounts['central-cannon'] / samples.length).toBeCloseTo(0.5, 1)
    expect(redCounts['xianren-guide'] / samples.length).toBeCloseTo(0.2, 1)
    expect(redCounts['flying-elephant'] / samples.length).toBeCloseTo(0.2, 1)
    expect(redCounts.other / samples.length).toBeCloseTo(0.1, 1)

    const central = samples.filter((opening) => opening.redFamily === 'central-cannon')
    const centralResponses = countBy(central, (opening) => opening.blackResponse)
    expect(centralResponses['screen-horses'] / central.length).toBeCloseTo(0.5, 1)
    expect(centralResponses['shun-cannon'] / central.length).toBeCloseTo(0.2, 1)
    expect(centralResponses.other / central.length).toBeCloseTo(0.3, 1)

    const nonCentral = samples.filter((opening) => opening.redFamily !== 'central-cannon')
    const nonCentralResponses = countBy(nonCentral, (opening) => opening.blackResponse)
    expect(nonCentralResponses['shun-cannon'] ?? 0).toBe(0)
    expect(nonCentralResponses['screen-horses'] / nonCentral.length).toBeCloseTo(0.5, 1)
    expect(nonCentralResponses.other / nonCentral.length).toBeCloseTo(0.5, 1)
  })

  it('第三阶段保持满强度配置并启用动态主变安全候选选择', () => {
    expect(PERSONALITY_RUNTIME).toMatchObject({
      implementationPhase: 3,
      multiPvPolicy: 'dynamic-4-3-2',
      candidateSelectionEnabled: true,
    })
    expect(AI_PERSONALITIES.red.name).toBe('进攻型')
    expect(AI_PERSONALITIES.black.name).toBe('稳健型')
  })
})

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const name = key(value)
    counts[name] = (counts[name] ?? 0) + 1
    return counts
  }, {})
}
