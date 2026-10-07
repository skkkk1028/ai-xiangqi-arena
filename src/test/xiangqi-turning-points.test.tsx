import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MoveRecord } from '../game/types'
import { reviewPositions } from '../games/xiangqi/review'
import { DEFAULT_TURNING_THRESHOLDS, findTurningPoints, historyEvaluations, topTurningPoints, turningPointReport } from '../games/xiangqi/turning-points'
import { XiangqiReviewScreen } from '../components/XiangqiReviewScreen'
import { XiangqiTurningPoints } from '../components/XiangqiTurningPoints'
import { engineRegistry } from '../engine/default-registry'
import fixture from './fixtures/xiangqi-rook-blunder.json'

const history: MoveRecord[] = reviewPositions(fixture.moves).at(-1)!.history.map((move, index) => ({ ...move, ...fixture.evaluations[index], score: { kind: 'cp', value: fixture.evaluations[index].score.value } }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const detect = (records = history, cp = 150, winRate = 15) => findTurningPoints(records, historyEvaluations(records), { cp, winRate })

it('真实 NNUE 记录：车走入马口是最大转折，归因第7步，下一步确实丢车', () => {
  const snapshot = JSON.stringify(history)
  const points = detect()
  expect(topTurningPoints(points)[0]).toMatchObject({ index: fixture.expectedBlunderIndex, color: 'red', kind: 'mistake', deltaCp: -1848, deltaWin: -100 })
  expect(history[7].captured?.type).toBe('chariot')
  expect(points.some((point) => point.index === 3 && point.color === 'black' && point.kind === 'mistake')).toBe(true)
  expect(points.some((point) => point.index === 6 && point.kind === 'brilliant')).toBe(false)
  expect(JSON.stringify(history)).toBe(snapshot)
  expect(turningPointReport(history, points, DEFAULT_TURNING_THRESHOLDS)).toContain('第 7 步：红方失误 −1848 分')
})

it('阈值独立生效、提高不增加标注、降低不减少标注', () => {
  const low = detect(history, 50, 5)
  const normal = detect()
  const high = detect(history, 2000, 50)
  expect(low.length).toBeGreaterThan(normal.length)
  expect(high.length).toBeLessThan(normal.length)
  for (let cp = 50; cp <= 2000; cp += 50) expect(detect(history, cp + 50, 5).length).toBeLessThanOrEqual(detect(history, cp, 5).length)
  for (let rate = 5; rate < 50; rate++) expect(detect(history, 50, rate + 1).length).toBeLessThanOrEqual(detect(history, 50, rate).length)
})

it('缺失/将杀不跨步拼接，最后一手没有落子后评价不判定', () => {
  for (const replacement of [{ score: null }, { wdl: null }, { score: { kind: 'mate' as const, value: 3 } }, { score: { kind: 'cp' as const, value: NaN } }]) {
    const records = history.map((move, i) => i === 6 ? { ...move, ...replacement } : move)
    expect(detect(records).some((point) => point.index === 5 || point.index === 6)).toBe(false)
  }
  expect(detect().every((point) => point.index < history.length - 1)).toBe(true)
  expect(detect([])).toEqual([])
})

it('正向同号变化标为待复核妙手，零变化不标；稳定对局不因交替视角误判', () => {
  const records = history.slice(0, 3).map((move) => ({ ...move, score: { kind: 'cp' as const, value: move.piece.color === 'red' ? 100 : -100 }, wdl: move.piece.color === 'red' ? { win: 400, draw: 300, loss: 300 } : { win: 300, draw: 300, loss: 400 } }))
  expect(detect(records)).toEqual([])
  records[1] = { ...records[1], score: { kind: 'cp', value: -300 }, wdl: { win: 100, draw: 200, loss: 700 } }
  expect(detect(records)[0]).toMatchObject({ index: 0, color: 'red', kind: 'brilliant', deltaCp: 200, deltaWin: 30 })
})

it('图点悬停、键盘和 Top3 点击定位落子后棋盘；不创建分析引擎', () => {
  const create = vi.spyOn(engineRegistry, 'createEngine')
  render(<XiangqiReviewScreen history={history} onClose={() => undefined} />)
  const marker = screen.getByRole('button', { name: /评分标记：第 7 步/ })
  fireEvent.mouseEnter(marker)
  expect(screen.getByRole('tooltip')).toHaveTextContent('红方失误 −1848 分')
  fireEvent.click(marker)
  expect(screen.getByText('原棋谱 · 已走 7 / 9 手')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '初始局面' }))
  fireEvent.keyDown(marker, { key: 'Enter' })
  expect(screen.getByText('原棋谱 · 已走 7 / 9 手')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^第 4 步：/ }))
  expect(screen.getByText('原棋谱 · 已走 4 / 9 手')).toBeInTheDocument()
  expect(create).not.toHaveBeenCalled()
})

it('滑杆实时更新标注与战报，支持复制和失败回退', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  render(<XiangqiTurningPoints history={history} index={0} onNavigate={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '一键生成文字战报' }))
  fireEvent.click(screen.getByRole('button', { name: '复制战报' }))
  expect(await screen.findByText('战报已复制。')).toBeInTheDocument()
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('红方失误 −1848 分'))
  fireEvent.change(screen.getByLabelText('掉分阈值'), { target: { value: '2000' } })
  expect(screen.getByText('共 0 个转折点')).toBeInTheDocument()
  expect((screen.getByLabelText('文字战报') as HTMLTextAreaElement).value).toContain('未发现可标注转折')
  fireEvent.change(screen.getByLabelText('掉分阈值'), { target: { value: '50' } })
  fireEvent.change(screen.getByLabelText('胜率阈值'), { target: { value: '5' } })
  expect(screen.getByText(`共 ${detect(history, 50, 5).length} 个转折点`)).toBeInTheDocument()
  writeText.mockRejectedValueOnce(new Error('denied'))
  fireEvent.click(screen.getByRole('button', { name: '复制战报' }))
  expect(await screen.findByText('复制失败，请选中下方战报手动复制。')).toBeInTheDocument()
  vi.unstubAllGlobals()
})
