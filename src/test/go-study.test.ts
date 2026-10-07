import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoArchive, importGoSgf, restoreGoArchive } from '../games/go/sgf'
import { analysisKey, downloadGoFile, goLibrary, parseGoLibraryFile, type GoLibraryGame, type GoSavedAnalysis } from '../games/go/library'
import { compareGoMove, encodedPrefix, GoStudyAnalyzer, goStudyPositions, legalCandidates, studyGame } from '../games/go/study-analysis'
import { gtpToGoMove } from '../games/go/ai/coordinates'
import type { KataGoCapabilities, KataGoWireAnalysisEvent } from '../games/go/ai/types'
import type { KataGoTransport } from '../games/go/ai/KataGoTransport'

function event(overrides: Partial<KataGoWireAnalysisEvent> = {}): KataGoWireAnalysisEvent {
  return { type: 'analysis', stage: 'final', requestId: 'test', engineVersion: 'test', modelName: 'model', profile: 'winrate',
    elapsedMs: 100, requestedVisits: 256, runtimeBackend: 'browser-wasm', requestedBackend: 'browser-webgpu',
    backendFallback: true, backendFallbackReason: 'test', modelFallback: false, modelFallbackReason: null,
    timedOut: false, truncated: false, stopReason: 'visit-limit', root: { winrate: 0.6, scoreLead: 3, visits: 256 },
    candidates: [{ move: 'D16', order: 0, visits: 220, prior: 0.4, winrate: 0.7, scoreLead: 5, pv: ['D16', 'Q4', 'D16'] },
      { move: 'Q16', order: 1, visits: 36, prior: 0.2, winrate: 0.5, scoreLead: 1, pv: ['Q16'] }], ...overrides }
}
function gameRecord(state = studyGame.init()): GoLibraryGame {
  return { id: 'original', title: 'test', favorite: false, mode: 'local', configuration: {}, archive: createGoArchive(state) }
}
afterEach(() => vi.restoreAllMocks())

describe('围棋持久复盘与严格导入', () => {
  it('文件备份生成正确 Blob 并触发命名下载', () => {
    vi.useFakeTimers()
    const create = vi.fn((_blob: Blob) => 'blob:go-backup')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(class {}, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('backup.json')
      expect(this.href).toBe('blob:go-backup')
      expect(this.isConnected).toBe(true)
    })
    try {
      downloadGoFile('backup.json', '{"version":1}')
      expect(click).toHaveBeenCalledOnce()
      expect(create.mock.calls[0][0]).toMatchObject({ type: 'application/json;charset=utf-8', size: 13 })
      expect(document.querySelector('a[download]')).toBeNull()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:go-backup')
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })
  it('稳定创建时间与真实玩家不被更新日期覆盖', () => {
    const archive = createGoArchive(studyGame.init(), new Date('2026-09-21'), { createdAt: '2026-01-01T00:00:00.000Z', players: [
      { seat: 'black', kind: 'human', name: '练习玩家' }, { seat: 'white', kind: 'ai', name: 'KataGo' },
    ] })
    expect(archive.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(archive.players[1]).toMatchObject({ kind: 'ai', name: 'KataGo' })
    expect(archive.updatedAt).not.toBe(archive.createdAt)
  })
  it.each(['SZ[13]RU[Chinese]KM[7.5]', 'SZ[19]RU[Japanese]KM[7.5]', 'SZ[19]RU[Chinese]KM[6.5]',
    'SZ[19]RU[Chinese]KM[7.5]HA[2]', 'SZ[19]RU[Chinese]KM[7.5]AB[dd]', 'SZ[19]RU[Chinese]KM[7.5]PL[W]'])('拒绝不支持的布局和规则 %s', (root) => {
    expect(() => importGoSgf(`(;GM[1]${root};B[dd])`)).toThrow()
  })
  it('拒绝分支，正确处理注释转义，RE 不伪造死子结算', () => {
    expect(() => importGoSgf('(;GM[1]SZ[19]RU[Chinese]KM[7.5];B[dd](;W[pp])(;W[qq]))')).toThrow()
    const state = importGoSgf('(;GM[1]SZ[19]RU[Chinese]KM[7.5]RE[B+8.5]C[test\\]text];B[dd];W[];B[])')
    expect(state.phase).toBe('scoring'); expect(state.result).toBeNull()
  })
  it('初始、双虚着、续弈以及恢复后未落子的最终局面正确定位', () => {
    let state = studyGame.applyMove(studyGame.init(), gtpToGoMove('D16'))
    state = studyGame.applyMove(state, { kind: 'pass' }); state = studyGame.applyMove(state, { kind: 'pass' })
    const resumed = studyGame.resumePlay(state)
    expect(goStudyPositions(restoreGoArchive(createGoArchive(resumed))).at(-1)?.phase).toBe('playing')
    const next = studyGame.applyMove(resumed, gtpToGoMove('Q4'))
    const positions = goStudyPositions(restoreGoArchive(createGoArchive(next)))
    expect(positions.map((p) => p.history.length)).toEqual([0, 1, 2, 3, 4])
    expect(positions[3].phase).toBe('scoring'); expect(positions[4].board).toEqual(next.board)
    expect(positions[0].board.flat().every((value) => value === null)).toBe(true)
  })
  it('JSON 兼容纯棋谱，带分析导入重新分配 ID，拒绝前缀和数据损坏', () => {
    const state = studyGame.applyMove(studyGame.init(), gtpToGoMove('D16'))
    const game = gameRecord(state)
    const e = event()
    const analysis: GoSavedAnalysis = { key: 'old', gameId: game.id, prefix: encodedPrefix(state), ruleset: game.archive.ruleset, profile: 'winrate', createdAt: new Date().toISOString(), event: e }
    const bundle = { format: 'project10-go-library', version: 1, game, analyses: [analysis] }
    const result = parseGoLibraryFile(JSON.stringify(bundle))
    expect(result.game.id).not.toBe(game.id); expect(result.analyses[0].gameId).toBe(result.game.id)
    expect(result.analyses[0].key).toBe(analysisKey(result.game.id, game.archive.ruleset, analysis.prefix, e))
    expect(parseGoLibraryFile(JSON.stringify(game.archive)).game.archive.moves).toEqual(['B:D16'])
    expect(() => parseGoLibraryFile(JSON.stringify({ ...bundle, analyses: [{ ...analysis, prefix: ['B:Q4'] }] }))).toThrow('不一致')
    expect(() => parseGoLibraryFile(JSON.stringify({ ...bundle, analyses: [{ ...analysis, event: { ...e, root: { winrate: 5 } } }] }))).toThrow()
  })
  it('黑白行棋方视角相反；优先候选，丢弃非法 PV；配置不同时不混算', () => {
    const initial = studyGame.init(), blackAfter = studyGame.applyMove(initial, gtpToGoMove('Q16'))
    const black = compareGoMove(initial, blackAfter, event(), event({ root: { winrate: 0.1, scoreLead: -9, visits: 256 } }))
    expect(black.lossPoints).toBe(4); expect(black.lossWinrate).toBeCloseTo(20); expect(black.reviewWorthy).toBe(true)
    expect(legalCandidates(initial, event())[0].pv).toEqual(['D16', 'Q4'])
    const whiteBefore = studyGame.applyMove(initial, gtpToGoMove('A1'))
    const whiteAfter = studyGame.applyMove(whiteBefore, gtpToGoMove('Q16'))
    const white = compareGoMove(whiteBefore, whiteAfter, event(), event())
    expect(white.lossPoints).toBe(-4); expect(white.lossWinrate).toBeCloseTo(-20); expect(white.reviewWorthy).toBe(false)
    const mixed = compareGoMove(initial, blackAfter, event(), event({ modelName: 'other' }))
    expect(mixed.lossPoints).toBeNull(); expect(mixed.lossWinrate).toBeNull(); expect(mixed.reviewWorthy).toBe(false)
  })
  it('缺失目差和超时明确标记；缺少访问量不生成虚假点评', () => {
    const initial = studyGame.init(), after = studyGame.applyMove(initial, gtpToGoMove('A1'))
    const incomplete = event({ timedOut: true, truncated: true, root: { winrate: 0.5, scoreLead: null, visits: 10 } })
    const result = compareGoMove(initial, after, event(), incomplete)
    expect(result.lossPoints).toBeNull(); expect(result.notes.join('')).toContain('超时')
    expect(result.notes.join('')).toContain('落子后相同档位')
    expect(compareGoMove(initial, after, event(), event({ root: { visits: 0, winrate: 0.5, scoreLead: null } })).reviewWorthy).toBe(false)
  })
  it('分析缓存包括完整历史和配置，停止后迟到结果不能保存', async () => {
    const save = vi.spyOn(goLibrary, 'saveAnalysis').mockResolvedValue()
    const capabilities: KataGoCapabilities = { ...event(), ready: true, profiles: { winrate: { maxVisits: 256, timeoutMs: 12000 }, fast: { maxVisits: 2000, timeoutMs: 30000 }, strong: { maxVisits: 20000, timeoutMs: 180000 } } }
    const transport: KataGoTransport = { initialize: vi.fn(async () => capabilities), analyze: vi.fn(async () => event()), cancel: vi.fn(), dispose: vi.fn() }
    const cache: GoSavedAnalysis[] = [], analyzer = new GoStudyAnalyzer(transport, cache, vi.fn()), game = gameRecord()
    await analyzer.position(game, studyGame.init(), 'winrate', new AbortController().signal)
    await analyzer.position(game, studyGame.init(), 'winrate', new AbortController().signal)
    expect(transport.analyze).toHaveBeenCalledTimes(1)
    const passes = studyGame.applyMove(studyGame.applyMove(studyGame.init(), { kind: 'pass' }), { kind: 'pass' })
    await analyzer.position(game, passes, 'winrate', new AbortController().signal)
    expect(transport.analyze).toHaveBeenCalledTimes(2)
    await analyzer.position(game, studyGame.applyMove(studyGame.init(), gtpToGoMove('D16')), 'winrate', new AbortController().signal)
    expect(transport.analyze).toHaveBeenLastCalledWith(expect.objectContaining({ moves: [['B', 'D16']] }), expect.anything())
    let finish!: (value: KataGoWireAnalysisEvent) => void
    vi.mocked(transport.analyze).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const abort = new AbortController()
    const pending = analyzer.position(game, studyGame.init(), 'fast', abort.signal)
    await vi.waitFor(() => expect(transport.analyze).toHaveBeenCalledTimes(4))
    abort.abort(); finish(event({ profile: 'fast', requestedVisits: 2000 }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cache).toHaveLength(3); expect(save).toHaveBeenCalledTimes(4)
  })
})
