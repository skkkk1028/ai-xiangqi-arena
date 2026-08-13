import { describe, expect, it } from 'vitest'
import { createChessArchive, exportChessPgn, restoreChessArchive } from '../games/chess/archive'
import { createChessState, ChessGameEngine, replayChessState } from '../games/chess/rules'
import { CHESS_LEGACY_RULESET } from '../games/chess/types'

describe('国际象棋棋谱档案', () => {
  it('导出 PGN/JSON 后按 UCI 逐手恢复', () => {
    const engine = new ChessGameEngine()
    let state = createChessState(12)
    state = engine.executeAction(state, engine.getLegalActions(state)[0])
    state = engine.executeAction(state, engine.getLegalActions(state)[0])
    const archive = createChessArchive({ state, players: [{ seat: 'w', kind: 'ai', name: '曜刃' }, { seat: 'b', kind: 'ai', name: '玄垒' }] })
    const restored = restoreChessArchive(archive)
    expect(restored.fen).toBe(state.fen)
    expect(restored.history.map((move) => move.uci)).toEqual(state.history.map((move) => move.uci))
    expect(String(archive.metadata?.pgn)).toContain('1.')
  })

  it('拒绝非法 UCI、伪造 FEN 和伪造终局', () => {
    const archive = createChessArchive({ state: replayChessState(['e2e4']), players: [{ seat: 'w', kind: 'ai', name: '曜刃' }, { seat: 'b', kind: 'ai', name: '玄垒' }] })
    expect(() => restoreChessArchive({ ...archive, moves: ['e2e5'] })).toThrow()
    expect(() => restoreChessArchive({ ...archive, metadata: { ...archive.metadata, currentFen: '8/8/8/8/8/8/8/8 w - - 0 1' } })).toThrow()
    expect(() => restoreChessArchive({ ...archive, result: { reason: 'checkmate', winner: 'w', loser: 'b' } })).toThrow()
  })

  it('严格校验棋种、版本、状态、席位和 PGN 元数据', () => {
    const archive = createChessArchive({ state: replayChessState(['e2e4']), players: [{ seat: 'w', kind: 'ai', name: '曜刃' }, { seat: 'b', kind: 'ai', name: '玄垒' }] })
    expect(() => restoreChessArchive({ ...archive, game: 'go' })).toThrow('不属于国际象棋')
    expect(() => restoreChessArchive({ ...archive, version: 2 })).toThrow('版本')
    expect(() => restoreChessArchive({ ...archive, status: 'finished' })).toThrow('状态')
    expect(() => restoreChessArchive({ ...archive, players: [{ seat: 'w', kind: 'ai', name: '曜刃' }, { seat: 'w', kind: 'ai', name: '玄垒' }] })).toThrow('席位')
    expect(() => restoreChessArchive({ ...archive, metadata: { ...archive.metadata, pgn: 'tampered' } })).toThrow('PGN')
  })

  it('完整比较和棋申请字段，并允许自身导出的合法自定义 FEN 往返', () => {
    const engine = new ChessGameEngine()
    const repetition = replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'])
    const claimed = engine.executeAction(repetition, { kind: 'claim-draw', reason: 'threefold-repetition' })
    const repetitionArchive = createChessArchive({ state: claimed, players: [{ seat: 'w', kind: 'ai', name: '曜刃' }, { seat: 'b', kind: 'ai', name: '玄垒' }] })
    expect(restoreChessArchive(repetitionArchive).result).toEqual(claimed.result)
    expect(() => restoreChessArchive({ ...repetitionArchive, result: { ...repetitionArchive.result, claimant: 'b' } })).toThrow('申请')

    const customFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const custom = createChessState(7, customFen)
    const customArchive = createChessArchive({ state: custom, players: [{ seat: 'w', kind: 'ai', name: '玄垒' }, { seat: 'b', kind: 'ai', name: '曜刃' }] })
    expect(restoreChessArchive(customArchive)).toMatchObject({ initialFen: customFen, fen: customFen, seed: 7 })
  })

  it('兼容并校验 v1 自动申请档案，恢复时迁移为规则申请结果', () => {
    const repetition = replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'])
    const current = createChessArchive({ state: repetition, players: [{ seat: 'w', kind: 'ai', name: '曜刃' }, { seat: 'b', kind: 'ai', name: '玄垒' }] })
    const legacy = {
      ...current,
      ruleset: CHESS_LEGACY_RULESET,
      status: 'finished',
      result: { winner: null, loser: null, reason: 'threefold-repetition', automaticClaim: true },
    }
    expect(restoreChessArchive(legacy).result).toMatchObject({ reason: 'threefold-repetition', termination: 'claim', claimant: 'w' })
    expect(() => restoreChessArchive({ ...legacy, result: { ...legacy.result, automaticClaim: false } })).toThrow('旧档案')
  })

  it('技术停止 PGN 使用未决结果而不是规则和棋', () => {
    const state = {
      ...createChessState(2),
      phase: 'technical' as const,
      result: { winner: null, loser: null, reason: 'technical-stop' as const, termination: 'technical' as const, claimant: null, intendedMove: null },
    }
    const pgn = exportChessPgn(state)
    expect(pgn).toContain('[Result "*"]')
    expect(pgn).toContain('[Termination "technical stop after 0 plies"]')
    expect(pgn).not.toContain('[Result "1/2-1/2"]')
  })
})
