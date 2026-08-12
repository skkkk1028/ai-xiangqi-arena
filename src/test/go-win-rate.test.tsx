import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WinRateChart } from '../games/go/WinRateChart'
import { KATAGO_CHINESE_PSK_RULES, type KataGoAnalyzeOptions, type KataGoAnalyzeRequest, type KataGoTransport } from '../games/go/ai'
import { GoGameEngine } from '../games/go/game-engine'
import { GO_WIN_RATE_ANALYSIS, GoWinRateAnalyzer, type GoWinRatePoint } from '../games/go/win-rate-analysis'

describe('围棋统一胜率分析', () => {
  it('按固定参数把真实棋谱提交给 KataGo，并只采用根节点胜率', async () => {
    const game = new GoGameEngine()
    let state = game.init()
    state = game.applyMove(state, { row: 3, col: 3 })
    state = game.applyMove(state, { row: 15, col: 15 })
    const requests: Array<{ request: KataGoAnalyzeRequest; options?: KataGoAnalyzeOptions }> = []
    const transport: KataGoTransport = {
      initialize: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
      analyze: vi.fn(async (request, options) => {
        requests.push({ request, options })
        return {
          type: 'analysis' as const,
          stage: 'final' as const,
          requestId: request.requestId,
          engineVersion: '1.16-test',
          modelName: 'kata-test.bin.gz',
          profile: 'winrate' as const,
          elapsedMs: 420,
          requestedVisits: 256,
          runtimeBackend: 'native-katago' as const,
          requestedBackend: 'native-katago' as const,
          backendFallback: false,
          backendFallbackReason: null,
          modelFallback: false,
          modelFallbackReason: null,
          timedOut: false,
          truncated: false,
          stopReason: 'visit-limit' as const,
          root: { winrate: 0.634, scoreLead: 3.2, visits: 256 },
          candidates: [{ move: 'Q16', order: 0, visits: 220, prior: 0.2, winrate: 0.62, scoreLead: 2.8, pv: ['Q16'] }],
        }
      }),
    }

    const point = await new GoWinRateAnalyzer(transport).analyze(state)

    expect(requests[0].request).toMatchObject({
      profile: GO_WIN_RATE_ANALYSIS.profile,
      boardSize: 19,
      komi: 7.5,
      rules: KATAGO_CHINESE_PSK_RULES,
      moves: [['B', 'D16'], ['W', 'Q4']],
    })
    expect(requests[0].options?.analysisGroup).toBe('background')
    expect(point).toMatchObject({ moveNumber: 2, blackWinRate: 0.634, visits: 256, requestedVisits: 256 })
    expect(point.whiteWinRate).toBeCloseTo(0.366)
    expect(point.blackWinRate + point.whiteWinRate).toBe(1)
  })

  it('渲染黑白双曲线、当前值、50% 参考线和逐手悬停信息', () => {
    const points: GoWinRatePoint[] = [
      point(1, 0.52),
      point(2, 0.634),
    ]
    render(<WinRateChart points={points} status="ready" error={null} />)

    expect(screen.getByLabelText('胜率走势')).toHaveTextContent('黑 63.4%')
    expect(screen.getByLabelText('胜率走势')).toHaveTextContent('白 36.6%')
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(document.querySelectorAll('.go-winrate-chart__line')).toHaveLength(2)

    const target = screen.getByLabelText('第 2 手，黑方 63.4%，白方 36.6%')
    fireEvent.mouseEnter(target)
    expect(screen.getByRole('tooltip')).toHaveTextContent('第 2 手')
    expect(screen.getByRole('tooltip')).toHaveTextContent('黑方 63.4%')
    expect(screen.getByRole('tooltip')).toHaveTextContent('白方 36.6%')
  })
})

function point(moveNumber: number, blackWinRate: number): GoWinRatePoint {
  return {
    moveNumber,
    blackWinRate,
    whiteWinRate: 1 - blackWinRate,
    visits: 256,
    requestedVisits: 256,
    elapsedMs: 400,
    timedOut: false,
    runtimeLabel: 'Native KataGo · OpenCL',
    engineVersion: '1.16-test',
    modelName: 'kata-test.bin.gz',
  }
}
