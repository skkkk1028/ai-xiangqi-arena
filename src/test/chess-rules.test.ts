import { describe, expect, it } from 'vitest'
import { CHESS_OPENINGS } from '../games/chess/openings'
import { ChessGameEngine, actionToUci, canClaimFiftyMove, canClaimThreefold, chessPositionIdentity, createChessState, isChessMoveAction, parseChessUci, replayChessState } from '../games/chess/rules'

describe('国际象棋不可变裁判适配层', () => {
  it('初始局面有 20 个合法着法，并且执行不会修改旧状态', () => {
    const engine = new ChessGameEngine()
    const initial = createChessState(1)
    const legal = engine.getLegalActions(initial)
    expect(legal).toHaveLength(20)
    const next = engine.executeAction(initial, legal[0])
    expect(initial.history).toHaveLength(0)
    expect(next.history).toHaveLength(1)
    expect(next.fen).not.toBe(initial.fen)
  })

  it('支持王车易位、吃过路兵和四种升变', () => {
    const engine = new ChessGameEngine()
    const castle = replayChessState(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1e2', 'g8f6', 'e1g1'])
    expect(castle.lastMove?.san).toBe('O-O')
    const enPassant = replayChessState(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])
    expect(enPassant.lastMove?.san).toBe('exd6')
    for (const promotion of ['q', 'r', 'b', 'n'] as const) {
      const state = replayChessState([], { initialFen: `4k3/P7/8/8/8/8/8/4K3 w - - 0 1` })
      const action = parseChessUci(`a7a8${promotion}`)
      expect(action).not.toBeNull()
      const next = engine.executeAction(state, action!)
      expect(next.lastMove?.uci).toBe(`a7a8${promotion}`)
    }
  })

  it('判定将死、逼和和子力不足，并把三次重复/五十回合作为申请权', () => {
    const engine = new ChessGameEngine()
    const mate = replayChessState(['f2f3', 'e7e5', 'g2g4', 'd8h4'])
    expect(mate.result?.reason).toBe('checkmate')
    const stale = replayChessState([], { initialFen: '7k/5Q2/6K1/8/8/8/8/R7 w - - 0 1' })
    expect(stale.result).toBeNull()
    const staleAfter = engine.executeAction(stale, { from: 'a1', to: 'a2' })
    expect(staleAfter.result?.reason).toBe('stalemate')
    const insufficient = replayChessState([], { initialFen: '8/8/8/8/8/8/2k5/3K4 w - - 0 1' })
    expect(insufficient.result).toBeNull()
    const repetition = replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'])
    expect(repetition.result).toBeNull()
    expect(canClaimThreefold(repetition)).toBe(true)
    const repetitionClaim = engine.executeAction(repetition, { kind: 'claim-draw', reason: 'threefold-repetition' })
    expect(repetitionClaim.result).toMatchObject({ reason: 'threefold-repetition', termination: 'claim', claimant: 'w' })
    const fifty = replayChessState([], { initialFen: '8/8/8/8/8/8/N6k/K6R w - - 99 50' })
    expect(canClaimFiftyMove(fifty, { from: 'a2', to: 'b4' })).toBe(true)
    const fiftyClaim = engine.executeAction(fifty, { kind: 'claim-draw', reason: 'fifty-move', intendedMove: { from: 'a2', to: 'b4' } })
    expect(fiftyClaim.fen).toBe(fifty.fen)
    expect(fiftyClaim.result).toMatchObject({ reason: 'fifty-move', termination: 'claim', intendedMove: 'a2b4' })
  })

  it('非法申请被拒绝，五次重复和七十五回合自动终局', () => {
    const engine = new ChessGameEngine()
    expect(() => engine.executeAction(createChessState(), { kind: 'claim-draw', reason: 'threefold-repetition' })).toThrow('不满足')
    const fivefold = replayChessState([
      'g1f3', 'g8f6', 'f3g1', 'f6g8',
      'g1f3', 'g8f6', 'f3g1', 'f6g8',
      'g1f3', 'g8f6', 'f3g1', 'f6g8',
      'g1f3', 'g8f6', 'f3g1', 'f6g8',
    ])
    expect(fivefold.result).toMatchObject({ reason: 'fivefold-repetition', termination: 'automatic' })
    const seventyFive = replayChessState([], { initialFen: '8/8/8/8/8/8/N6k/K6R w - - 149 75' })
    const automatic = engine.executeAction(seventyFive, { from: 'a2', to: 'b4' })
    expect(automatic.result).toMatchObject({ reason: 'seventy-five-move', termination: 'automatic' })
    const mateAtSeventyFive = replayChessState([], { initialFen: '7k/5Q2/6K1/8/8/8/8/8 w - - 149 75' })
    expect(engine.executeAction(mateAtSeventyFive, { from: 'f7', to: 'g7' }).result?.reason).toBe('checkmate')
  })

  it('兵步和吃子重置半回合计数，局面身份包含行棋方、易位权和有效吃过路兵权', () => {
    const engine = new ChessGameEngine()
    const pawn = replayChessState([], { initialFen: '7k/8/8/8/8/8/P7/K7 w - - 149 75' })
    expect(engine.executeAction(pawn, { from: 'a2', to: 'a3' }).result).toBeNull()
    const capture = replayChessState([], { initialFen: '7k/8/8/8/8/8/Rp6/K7 w - - 149 75' })
    expect(engine.executeAction(capture, { from: 'a2', to: 'b2' }).result).toBeNull()

    const beforeThird = replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'])
    expect(canClaimThreefold(beforeThird, { from: 'f6', to: 'g8' })).toBe(true)
    expect(canClaimThreefold(beforeThird, { from: 'f6', to: 'h5' })).toBe(false)
    expect(engine.getLegalActions(beforeThird).filter((action) => !isChessMoveAction(action))).toContainEqual({
      kind: 'claim-draw', reason: 'threefold-repetition', intendedMove: { from: 'f6', to: 'g8' },
    })
    expect(chessPositionIdentity('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).not.toBe(chessPositionIdentity('4k3/8/8/8/8/8/8/4K3 b - - 0 1'))
    expect(chessPositionIdentity('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')).not.toBe(chessPositionIdentity('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1'))
    expect(chessPositionIdentity('7k/8/8/3pP3/8/8/8/K7 w - d6 0 1')).not.toBe(chessPositionIdentity('7k/8/8/3pP3/8/8/8/K7 w - - 0 1'))
  })

  it('12 条六半回合开局前缀均可逐手重放', () => {
    const engine = new ChessGameEngine()
    expect(CHESS_OPENINGS).toHaveLength(12)
    for (const opening of CHESS_OPENINGS) {
      const state = replayChessState(opening.moves, { seed: 7, openingId: opening.id, openingName: opening.name })
      expect(state.history).toHaveLength(6)
      expect(engine.getLegalActions(state).length).toBeGreaterThan(0)
    }
  })

  it('UCI 包含升变后缀且棋谱重放校验 FEN', () => {
    expect(actionToUci({ from: 'e7', to: 'e8', promotion: 'q' })).toBe('e7e8q')
    const state = replayChessState(['e2e4', 'e7e5'])
    expect(() => replayChessState(['e2e4', 'e7e5', 'e2e5'])).toThrow()
    expect(state.history[1].san).toBe('e5')
  })
})
