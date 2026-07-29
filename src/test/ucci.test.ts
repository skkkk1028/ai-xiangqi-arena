import { describe, expect, it } from 'vitest'
import { createInitialBoard } from '../game/board'
import { getLegalMoves } from '../game/rules'
import {
  matchUcciMove,
  moveToUcci,
  parseBestmove,
  parseInfoLine,
  positionToUcci,
  scoreLabel,
} from '../engine/ucci'

describe('UCCI 协议解析', () => {
  it('在本地坐标与 UCCI 坐标之间往返并只接受合法着法', () => {
    const board = createInitialBoard()
    const legal = getLegalMoves(board, 'red')
    const horse = matchUcciMove(board, legal, 'b0c2')
    expect(horse).not.toBeNull()
    expect(moveToUcci(horse!)).toBe('b0c2')
    expect(positionToUcci(9, 1)).toBe('b0')
    expect(matchUcciMove(board, legal, 'b0b9')).toBeNull()
    expect(matchUcciMove(board, legal, 'z0z1')).toBeNull()
  })

  it('解析深度、普通分值、WDL、节点、NPS 与 PV', () => {
    const parsed = parseInfoLine(
      'info depth 18 seldepth 27 score cp -143 wdl 73 166 761 nodes 123456 nps 987654 time 13500 pv b0c2 b9c7 h0g2',
    )
    expect(parsed).toEqual({
      depth: 18,
      seldepth: 27,
      score: { kind: 'cp', value: -143 },
      wdl: { win: 73, draw: 166, loss: 761 },
      nodes: 123456,
      nps: 987654,
      elapsedMs: 13500,
      pv: ['b0c2', 'b9c7', 'h0g2'],
    })
    expect(scoreLabel(parsed!.score)).toBe('-1.43')
  })

  it('明确区分将杀分值与普通分值并解析无着', () => {
    const parsed = parseInfoLine('info depth 32 score mate -4 nodes 88 pv e0e1')
    expect(parsed?.score).toEqual({ kind: 'mate', value: -4 })
    expect(scoreLabel(parsed!.score)).toBe('被杀 4')
    expect(parseBestmove('bestmove b0c2 ponder b9c7')).toBe('b0c2')
    expect(parseBestmove('nobestmove')).toBeNull()
    expect(parseBestmove('info depth 2')).toBeUndefined()
  })

  it('可合并引擎分片后形成的逐行增量信息', () => {
    const first = parseInfoLine('info depth 8 nodes 1000')
    const second = parseInfoLine('info depth 9 nps 50000 pv h2e2', first!)
    expect(second?.nodes).toBe(1000)
    expect(second?.depth).toBe(9)
    expect(second?.pv).toEqual(['h2e2'])
  })
})
