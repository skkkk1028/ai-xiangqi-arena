import { describe, expect, it, vi } from 'vitest'
import type { EngineAdapter } from '../engine/adapter'
import type { AIEngineConfig } from '../engine/types'
import type { EngineProfile, EngineSearchResponse } from '../game/types'
import { ChessAIEngineAdapter, CHESS_SEARCH_PROFILES, selectChessPersonalityMove } from '../games/chess/ai-engine'
import { ChessGameEngine, createChessState, replayChessState } from '../games/chess/rules'
import { UciParser } from '../engine/parsers/uci-parser'

function mockAdapter(response?: EngineSearchResponse): EngineAdapter {
  const profile: EngineProfile = { name: 'mock UCI', version: 'test', protocol: 'UCI', threads: 2, hashMb: 64 }
  return {
    config: { id: 'mock-chess', gameId: 'chess', name: 'mock', protocol: 'UCI' } as AIEngineConfig,
    init: vi.fn(async () => profile),
    sendCommand: vi.fn(), setPosition: vi.fn(),
    search: vi.fn(async () => response ?? { bestmove: 'e2e4', info: { depth: 1, nodes: 1, nps: 1, elapsedMs: 1, score: null, wdl: null, pv: ['e2e4'] }, candidates: [] }),
    stop: vi.fn(), newGame: vi.fn(), dispose: vi.fn(),
  }
}

describe('国际象棋 AI 双人格策略', () => {
  it('标准 UCI 解析器保留升变后缀和 MultiPV/WDL', () => {
    const parser = new UciParser()
    expect(parser.parseBestmove('bestmove e7e8q')).toBe('e7e8q')
    const info = parser.parseInfo('info depth 18 multipv 4 score cp 31 wdl 520 300 180 nodes 400 nps 1000 time 40 pv e7e8q')
    expect(info).toMatchObject({ depth: 18, multipv: 4, score: { kind: 'cp', value: 31 }, wdl: { win: 520, draw: 300, loss: 180 }, pv: ['e7e8q'] })
  })

  it('开局前缀优先于引擎，并完整传递 UCI 着法', async () => {
    const adapter = mockAdapter()
    const ai = new ChessAIEngineAdapter(adapter, { personality: 'attack', profile: CHESS_SEARCH_PROFILES.standard })
    const game = new ChessGameEngine()
    const state = { ...createChessState(0), openingId: 'italian', openingName: '意大利开局' }
    await ai.initialize()
    const decision = await ai.think({ state, player: 'w', legalActions: game.getLegalActions(state), record: state.history })
    expect(decision.analysis?.uci).toBe('e2e4')
    expect(adapter.search).not.toHaveBeenCalled()
  })

  it('缺少同深度稳定快照时强制采用第一选择', () => {
    const state = createChessState(3)
    const engine = new ChessGameEngine()
    const response: EngineSearchResponse = {
      bestmove: 'e2e4',
      info: { depth: 18, nodes: 100, nps: 100, elapsedMs: 100, score: { kind: 'cp', value: 20 }, wdl: { win: 500, draw: 300, loss: 200 }, pv: ['e2e4'] },
      candidates: [{ multipv: 1, depth: 18, nodes: 100, nps: 100, elapsedMs: 100, score: { kind: 'cp', value: 20 }, wdl: { win: 500, draw: 300, loss: 200 }, pv: ['e2e4'] }],
    }
    const decision = selectChessPersonalityMove({ state, legalActions: engine.getLegalActions(state), response, personality: 'solid', seed: 9 })
    expect(decision.uci).toBe('e2e4')
    expect(decision.reason).toBe('incomplete-candidate-data')
  })

  it('最佳着会造成三次重复时优先选择通过安全门槛的非重复候选', () => {
    const state = replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'])
    const engine = new ChessGameEngine()
    const principal = stableCandidate(1, 'f6g8', 20)
    const alternative = stableCandidate(2, 'f6h5', 5)
    const decision = selectChessPersonalityMove({
      state,
      legalActions: engine.getLegalActions(state),
      response: { bestmove: 'f6g8', info: principal, candidates: [principal, alternative] },
      personality: 'solid',
      seed: 7,
    })
    expect(decision.action).toMatchObject({ from: 'f6', to: 'h5' })
    expect(decision.reason).toBe('personality-safe-choice')
  })

  it('没有安全的非重复候选时声明着法并申请和棋', () => {
    const state = replayChessState(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'])
    const engine = new ChessGameEngine()
    const principal = stableCandidate(1, 'f6g8', 20)
    const decision = selectChessPersonalityMove({
      state,
      legalActions: engine.getLegalActions(state),
      response: { bestmove: 'f6g8', info: principal, candidates: [principal] },
      personality: 'attack',
      seed: 8,
    })
    expect(decision.action).toEqual({ kind: 'claim-draw', reason: 'threefold-repetition', intendedMove: { from: 'f6', to: 'g8' } })
    expect(decision.reason).toBe('threefold-repetition-claim')
  })
})

function stableCandidate(multipv: number, move: string, score: number) {
  const snapshot = { depth: 17, score: { kind: 'cp' as const, value: score }, wdl: { win: 500, draw: 350, loss: 150 } }
  return {
    multipv,
    depth: 18,
    nodes: 100,
    nps: 100,
    elapsedMs: 100,
    score: { kind: 'cp' as const, value: score },
    wdl: { win: 500, draw: 350, loss: 150 },
    pv: [move],
    previous: snapshot,
    ...(multipv === 1 ? { previousPrincipal: snapshot } : {}),
  }
}
