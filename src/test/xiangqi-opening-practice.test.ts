import { describe, expect, it } from 'vitest'
import { PRACTICE_OPENINGS, playOpening, retryOpening, startOpening } from '../games/xiangqi/opening-practice'
import { reviewPositions } from '../games/xiangqi/review'
import { XiangqiGameEngine } from '../games/xiangqi/game-engine'
import { moveToUcci } from '../engine/ucci'

const game = new XiangqiGameEngine()
describe('开局示范谱与练习状态', () => {
  it('四条非镜像示范分支均有 16 手合法着法和唯一身份', () => {
    const ids = new Set<string>()
    for (const opening of PRACTICE_OPENINGS) {
      expect(opening.branches).toHaveLength(2)
      expect(opening.branches[0].moves[0]).toBe(opening.branches[1].moves[0])
      expect(opening.branches[0].moves).not.toEqual(opening.branches[1].moves)
      for (const branch of opening.branches) {
        expect(ids.has(branch.id)).toBe(false); ids.add(branch.id)
        expect(branch.moves).toHaveLength(16)
        expect(reviewPositions([...branch.moves])).toHaveLength(17)
      }
    }
  })
  for (const opening of PRACTICE_OPENINGS) for (const branch of opening.branches) {
    it(`${branch.id}: 任意起点和执子重放，沿谱到末尾`, () => {
      const positions = reviewPositions([...branch.moves])
      for (let ply = 0; ply <= 16; ply++) for (const human of ['red', 'black'] as const) {
        let session = startOpening(branch, ply, human)
        const expectedPly = ply < 16 && positions[ply].turn !== human ? ply + 1 : ply
        expect(session.position).toEqual(positions[expectedPly])
        while (session.phase === 'book') session = playOpening(session, branch.moves[session.position.history.length])
        expect(session.phase).toBe('book-end')
        expect(session.position).toEqual(positions[16])
      }
    })
  }
  it('非法落子不变；偏离保留落子、暂停、重走恢复完整状态', () => {
    const branch = PRACTICE_OPENINGS[0].branches[0]
    const session = startOpening(branch, 4, 'red')
    expect(playOpening(session, 'a0a9')).toBe(session)
    const move = game.getLegalActions(session.position).map(moveToUcci).find((uci) => uci !== branch.moves[4])!
    const next = playOpening(session, move)
    expect(next.phase).toBe('deviated'); expect(next.deviationPly).toBe(4)
    expect(next.position.history).toHaveLength(5)
    expect(playOpening(next, branch.moves[5])).toBe(next)
    expect(retryOpening(next)).toEqual(session)
  })
  it('完整历史保留重复局面裁定，终局后不再接受走子', () => {
    const moves = ['b0c2', 'b9c7', 'c2b0', 'c7b9', 'b0c2', 'b9c7', 'c2b0', 'c7b9']
    const branch = { id: 'repetition-test', name: '重复测试', moves, description: '' }
    let session = startOpening(branch, 6, 'red')
    session = playOpening(session, moves[6])
    expect(session.phase).toBe('finished')
    expect(session.position.result?.winner).toBeNull()
    expect(session.position.history).toHaveLength(8)
    expect(playOpening(session, moves[0])).toBe(session)
  })
})
