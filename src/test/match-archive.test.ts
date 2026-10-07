import { describe, expect, it } from 'vitest'
import { parseMatchArchive, serializeMatchArchive, type MatchArchiveV1 } from '../games/core'
import { exportGoSgf, importGoSgf, GoGameEngine } from '../games/go'
import { createXiangqiArchive, exportXiangqiFen, replayXiangqiUcci } from '../games/xiangqi'

describe('版本化棋局档案', () => {
  it('严格校验并稳定序列化 MatchArchiveV1', () => {
    const archive: MatchArchiveV1<'xiangqi'> = {
      version: 1,
      game: 'xiangqi',
      ruleset: 'xiangqi-standard',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:01:00.000Z',
      status: 'playing',
      players: [
        { seat: 'red', kind: 'human', name: '玩家甲' },
        { seat: 'black', kind: 'human', name: '玩家乙' },
      ],
      moves: ['a3a4'],
      result: null,
    }
    expect(parseMatchArchive(serializeMatchArchive(archive))).toEqual(archive)
    expect(() => parseMatchArchive({ ...archive, version: 2 })).toThrow('版本')
    expect(() => parseMatchArchive({ ...archive, moves: [123] })).toThrow('moves')
  })

  it('围棋 SGF 往返后仍由生产规则逐手得到相同棋盘', () => {
    const engine = new GoGameEngine()
    let state = engine.init()
    state = engine.applyMove(state, { row: 3, col: 3 })
    state = engine.applyMove(state, { row: 15, col: 15 })
    state = engine.applyMove(state, { kind: 'pass' })

    const restored = importGoSgf(exportGoSgf(state))
    expect(restored.board).toEqual(state.board)
    expect(restored.history.map((move) => move.notation)).toEqual(state.history.map((move) => move.notation))
    expect(() => importGoSgf('(;GM[1]SZ[19]KM[7.5]RU[Chinese];W[dd])')).toThrow('执子顺序')
  })

  it('象棋 UCCI 导入逐手验证并输出当前 FEN', () => {
    const restored = replayXiangqiUcci(['a3a4', 'a6a5'])
    expect(restored.history).toHaveLength(2)
    expect(exportXiangqiFen(restored)).toContain(' w ')
    expect(() => replayXiangqiUcci(['a0a9'])).toThrow('不是合法 UCCI')
  })

  it('生成包含 UCCI 与当前 FEN 的象棋档案', () => {
    const state = replayXiangqiUcci(['a3a4', 'a6a5'])
    const history = state.history.map((entry) => ({
      ...entry,
      notation: entry.ucci,
      ucci: entry.ucci,
      ply: entry.ply,
      score: null,
      wdl: null,
      depth: 0,
    }))
    const archive = createXiangqiArchive({
      history,
      players: [
        { seat: 'red', kind: 'ai', name: 'Red' },
        { seat: 'black', kind: 'ai', name: 'Black' },
      ],
      result: null,
      now: new Date('2026-08-12T00:00:00.000Z'),
    })

    expect(archive.moves).toEqual(['a3a4', 'a6a5'])
    expect(archive.metadata?.currentFen).toBe(exportXiangqiFen(state))
    expect(() => parseMatchArchive(archive)).not.toThrow()
  })
})
