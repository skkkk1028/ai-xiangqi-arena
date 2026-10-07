import { describe, expect, it } from 'vitest'
import { createChessArchive, restoreChessArchive } from '../games/chess/archive'
import { importChessPgn, parseChessLibraryJson, type ChessSavedAnalysis } from '../games/chess/library'
import { exportLibraryPgn } from '../games/chess/ChessLibraryPage'
import { createChessState, replayChessState } from '../games/chess/rules'
import { explainChessMove, scoreForColor } from '../games/chess/study-analysis'
import { studyAnalysisKey } from '../games/chess/study-engine'
import { CHESS_INITIAL_FEN, CHESS_LEGACY_RULESET, CHESS_RULESET } from '../games/chess/types'

const players = [{ seat: 'w', kind: 'human' as const, name: '白方' }, { seat: 'b', kind: 'human' as const, name: '黑方' }]
const engine = { name: 'Stockfish', version: '18', backend: 'worker', threads: 1, hashMb: 64 }
const info = (value: number, kind: 'cp' | 'mate' = 'cp') => ({ depth: 12, nodes: 1000, nps: 100, elapsedMs: 3000, score: { kind, value }, wdl: null, pv: ['e2e4'] })
const analysis = (prefix: string[], candidates: { uci: string; value: number; kind?: 'cp' | 'mate' }[]): ChessSavedAnalysis => ({
  key: String(prefix.length), gameId: 'game', prefix, initialFen: CHESS_INITIAL_FEN, ruleset: CHESS_RULESET,
  tier: 'quick', engine, elapsedMs: 3000, timedOut: false, createdAt: '2026-09-22T00:00:00.000Z',
  response: { bestmove: candidates[0].uci, info: info(candidates[0].value, candidates[0].kind), candidates: candidates.map((item, index) => ({ ...info(item.value, item.kind), pv: [item.uci], multipv: index + 1 })) },
})

describe('国际象棋棋谱库与复盘证据', () => {
  it('本地双人开局与稳定创建时间可以往返，伪造非标准开局被拒绝', () => {
    const state = { ...createChessState(0), openingId: 'local-standard', openingName: '标准初始局面' }
    const archive = createChessArchive({ state, players, now: new Date('2026-09-22T00:00:00Z'), createdAt: '2026-09-21T00:00:00Z' })
    expect(archive.createdAt).toBe('2026-09-21T00:00:00Z')
    expect(restoreChessArchive(archive).openingId).toBe('local-standard')
    expect(() => restoreChessArchive({ ...archive, initialPosition: '8/8/8/8/8/8/8/8 w - - 0 1' })).toThrow()
  })

  it('PGN 导入保留合法主线和外部结果声明，拒绝变例与非法着', () => {
    const game = importChessPgn('[Event "测试"]\n[White "甲"]\n[Black "乙"]\n[Result "1-0"]\n\n1. e4 {说明} e5 2. Nf3 1-0')
    expect(game.archive.moves).toEqual(['e2e4', 'e7e5', 'g1f3'])
    expect(game.declaredResult?.token).toBe('1-0')
    expect(restoreChessArchive(game.archive).result).toBeNull()
    expect(() => importChessPgn('1. e4 (1. d4 d5) e5 *')).toThrow('分支')
    expect(() => importChessPgn('[Result "1-0"]\n\n1. e4 *')).toThrow('结果')
    expect(() => importChessPgn('1. e4 e5 1-0\n\n1. d4 d5 0-1')).toThrow()
    expect(() => importChessPgn('1. e5 *')).toThrow()
    const custom = importChessPgn('[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n\n1... e5 $1 2. Nf3 *')
    expect(custom.archive.initialPosition).toContain(' b KQkq ')
    expect(custom.archive.moves).toEqual(['e7e5', 'g1f3'])
  })

  it('JSON 接受纯档案并拒绝损坏局面', () => {
    const archive = createChessArchive({ state: replayChessState(['e2e4']), players })
    expect(parseChessLibraryJson(JSON.stringify(archive)).game.archive.moves).toEqual(['e2e4'])
    expect(() => parseChessLibraryJson(JSON.stringify({ ...archive, moves: ['e2e5'] }))).toThrow()
    const legacy = { ...archive, ruleset: CHESS_LEGACY_RULESET }
    expect(parseChessLibraryJson(JSON.stringify(legacy)).game.archive.ruleset).toBe(CHESS_RULESET)
  })

  it('双人超时作为外部裁决写入 PGN，不伪造棋盘结果', () => {
    const archive = createChessArchive({ state: replayChessState(['e2e4']), players })
    const game = { id: 'clock-game', title: '计时局', favorite: false, mode: 'local' as const, configuration: {}, archive,
      clock: { controlId: 'standard' as const, totals: { w: 1000, b: 0 }, moveRemainingMs: 0, runState: 'finished' as const,
        result: { reason: 'total-timeout' as const, winner: 'w' as const, loser: 'b' as const } } }
    const pgn = exportLibraryPgn(game)
    expect(pgn).toContain('[Termination "time forfeit"]')
    expect(pgn).toContain('[Result "1-0"]')
    expect(pgn.trim().endsWith('1-0')).toBe(true)
    expect(restoreChessArchive(archive).result).toBeNull()
  })

  it('缓存区分棋谱前缀、档位与引擎后端', () => {
    const key = studyAnalysisKey('game', CHESS_INITIAL_FEN, ['g1f3'], 'quick', engine)
    expect(key).not.toBe(studyAnalysisKey('game', CHESS_INITIAL_FEN, ['g1f3', 'g8f6', 'f3g1'], 'quick', engine))
    expect(key).not.toBe(studyAnalysisKey('game', CHESS_INITIAL_FEN, ['g1f3'], 'deep', engine))
    expect(key).not.toBe(studyAnalysisKey('game', CHESS_INITIAL_FEN, ['g1f3'], 'quick', { ...engine, backend: 'native' }))
  })

  it('按行棋方换算评价；100cp 与漏杀只由同档证据触发', () => {
    const record = replayChessState(['e2e4']).lastMove!
    expect(explainChessMove(record, analysis([], [{ uci: 'd2d4', value: 120 }, { uci: 'e2e4', value: 20 }])).review).toBe(true)
    expect(explainChessMove(record, analysis([], [{ uci: 'd2d4', value: 119 }, { uci: 'e2e4', value: 20 }])).review).toBe(false)
    expect(explainChessMove(record, analysis([], [{ uci: 'd2d4', value: 3, kind: 'mate' }, { uci: 'e2e4', value: 30 }])).lines.join('')).toContain('漏掉将杀')
    expect(explainChessMove(record, analysis([], [{ uci: 'd2d4', value: 120 }]), { ...analysis(['e2e4'], [{ uci: 'e7e5', value: -50 }]), engine: { ...engine, backend: 'native' } }).review).toBe(false)
    expect(scoreForColor(info(80), 'b', 'w')?.value).toBe(-80)
  })

  it('只从合法候选变化描述下一手直接交换', () => {
    const record = replayChessState(['e2e4', 'd7d5', 'e4d5']).lastMove!
    const before = analysis(['e2e4', 'd7d5'], [{ uci: 'e4d5', value: 10 }])
    before.response.candidates[0].pv = ['e4d5', 'd8d5']
    expect(explainChessMove(record, before).lines.join('')).toContain('形成直接交换')
    before.response.candidates[0].pv = ['e4d5', 'g8f6']
    expect(explainChessMove(record, before).lines.join('')).not.toContain('形成直接交换')
  })
})
