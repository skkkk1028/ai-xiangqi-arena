import { expect, it } from 'vitest'
import { applyMove, createInitialBoard, opposite } from '../game/board'
import { getLegalMoves } from '../game/rules'
import { hashAfterMove, hashPosition } from '../ai/zobrist'
import { searchBestMove } from '../ai/search'
import { reviewPositions } from '../games/xiangqi/review'
import { PRACTICE_OPENINGS } from '../games/xiangqi/opening-practice'
import { moveToUcci } from '../engine/ucci'

it('64 位哈希包含棋子颜色和行棋方；增量普通走子、吃子等于重算', () => {
  const board = createInitialBoard()
  const side = 'red' as const
  expect(hashPosition(board, 'red')).not.toBe(hashPosition(board, 'black'))
  expect(hashPosition(board, side)).toBeGreaterThan(0xffffffffn)
  for (const opening of PRACTICE_OPENINGS) for (const branch of opening.branches) {
    for (const position of reviewPositions([...branch.moves])) {
      for (const move of getLegalMoves(position.board, position.turn)) {
        const hash = hashAfterMove(hashPosition(position.board, position.turn), move, position.board[move.to.row][move.to.col])
        expect(hash).toBe(hashPosition(applyMove(position.board, move), opposite(position.turn)))
      }
    }
  }
})

it.each([3, 4, 5])('固定深度 %i 对比，分数与选招相同，输入不变并报告实际节点', (depth) => {
  const fixtures = [[], ...PRACTICE_OPENINGS.map((opening) => [...opening.branches[0].moves])]
  for (const moves of fixtures) {
    const state = reviewPositions(moves).at(-1)!
    const before = JSON.stringify(state.board)
    const off = searchBestMove(state.board, state.turn, 60_000, 20261003, depth, { comparison: true, transpositionTable: false })
    const on = searchBestMove(state.board, state.turn, 60_000, 20261003, depth, { comparison: true, transpositionTable: true })
    console.log(JSON.stringify({ depth, plies: moves.length, off: { nodes: off.nodes, ms: off.elapsedMs }, on: { nodes: on.nodes, ms: on.elapsedMs }, reduction: 1-on.nodes/off.nodes, move: on.move && moveToUcci(on.move), score: on.score }))
    expect(on.depth).toBe(depth); expect(off.depth).toBe(depth)
    expect(on.score).toBe(off.score)
    expect(on.move).toEqual(off.move)
    if (depth >= 4) expect(on.nodes).toBeLessThan(off.nodes)
    expect(JSON.stringify(state.board)).toBe(before)
  }
}, 180_000)

it('异序到达同一局面哈希相同，往返移动恢复原哈希', () => {
  const a = reviewPositions(['b0c2', 'b9c7', 'h0g2', 'h9g7']).at(-1)!
  const b = reviewPositions(['h0g2', 'h9g7', 'b0c2', 'b9c7']).at(-1)!
  expect(hashPosition(a.board, a.turn)).toBe(hashPosition(b.board, b.turn))
  const returned = reviewPositions(['b0c2', 'b9c7', 'c2b0', 'c7b9']).at(-1)!
  expect(hashPosition(returned.board, returned.turn)).toBe(hashPosition(createInitialBoard(), 'red'))
})
