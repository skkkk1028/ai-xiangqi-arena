import { describe, expect, it } from 'vitest'
import { emptyGuessStats, guessPrefix, nextGuessStats } from '../games/xiangqi/guess'
import { XiangqiGameEngine } from '../games/xiangqi/game-engine'

describe('中国象棋猜下一手', () => {
  it('完整 UCCI 匹配才算命中，跳过不增加作答数并中断连胜', () => {
    let stats = emptyGuessStats()
    stats = nextGuessStats(stats, 'a0a1', 'a0a1')
    stats = nextGuessStats(stats, 'b9b8', 'c9c8')
    expect(stats).toEqual({ answered: 2, hits: 1, streak: 0, longest: 1 })
    expect(nextGuessStats(stats, null, 'a0a1')).toEqual({ answered: 2, hits: 1, streak: 0, longest: 1 })
  })

  it('题目绑定完整棋谱前缀，局面改变后不能提交旧题', () => {
    const game = new XiangqiGameEngine()
    const state = game.initializeGame()
    expect(guessPrefix(state)).toBe('[]')
    const move = game.findLegalActionByUcci(state, 'a0a1')!
    expect(guessPrefix(game.executeAction(state, move))).toBe('["a0a1"]')
  })
})
