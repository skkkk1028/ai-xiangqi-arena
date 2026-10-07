import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoGamePage } from '../games/go/GoGamePage'

describe('围棋 React 页面', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('渲染十九路棋盘、对局数据和 KataGo 待命面板', () => {
    render(<GoGamePage />)

    expect(screen.getByRole('grid', { name: '十九路围棋棋盘' })).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')).toHaveLength(361)
    expect(screen.getAllByText('黑方行棋')).toHaveLength(2)
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('STANDBY')
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('KataGo 引擎待命')
  })

  it('点击合法交叉点后更新棋盘、回合、手数和最近一步标记', () => {
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，空点' }))

    const blackMove = screen.getByRole('gridcell', { name: 'D16，黑子，最近一步' })
    expect(blackMove).toBeInTheDocument()
    expect(blackMove.querySelector('.go-board__stone--black')).not.toBeNull()
    expect(blackMove.querySelector('.go-board__last-marker')).not.toBeNull()
    expect(screen.getAllByText('白方行棋')).toHaveLength(2)
    expect(screen.getByText('1 手')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('gridcell', { name: 'E16，空点' }))
    const whiteMove = screen.getByRole('gridcell', { name: 'E16，白子，最近一步' })
    expect(whiteMove.querySelector('.go-board__stone--white')).not.toBeNull()
    expect(whiteMove.querySelector('.go-board__last-marker')).not.toBeNull()
    expect(screen.getByRole('gridcell', { name: 'D16，黑子' })).toBeInTheDocument()
    expect(screen.getByText('2 手')).toBeInTheDocument()
  })

  it('本地双人落子不自动加载 KataGo，仅在用户请求赛后分析后运行', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/session')) return new Response('{"ok":true}', { status: 201 })
      if (url.endsWith('/capabilities')) {
        return Response.json({
          ready: true,
          engineVersion: '1.16-test',
          modelName: 'kata-test.bin.gz',
          runtimeBackend: 'native-katago',
          requestedBackend: 'native-katago',
          backendFallback: false,
          backendFallbackReason: null,
          modelFallback: false,
          modelFallbackReason: null,
          profiles: {
            fast: { maxVisits: 2_000, timeoutMs: 30_000 },
            strong: { maxVisits: 20_000, timeoutMs: 180_000 },
            winrate: { maxVisits: 256, timeoutMs: 12_000 },
          },
        })
      }
      if (url.endsWith('/analyze')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string; profile: string }
        const event = {
          type: 'analysis', stage: 'final', requestId: request.requestId,
          engineVersion: '1.16-test', modelName: 'kata-test.bin.gz', profile: request.profile,
          elapsedMs: 90, requestedVisits: 256,
          runtimeBackend: 'native-katago', requestedBackend: 'native-katago',
          backendFallback: false, backendFallbackReason: null,
          modelFallback: false, modelFallbackReason: null,
          timedOut: false, truncated: false, stopReason: 'visit-limit',
          root: { winrate: 0.634, scoreLead: 2.4, visits: 256 },
          candidates: [{ move: 'Q16', order: 0, visits: 230, prior: 0.2, winrate: 0.62, scoreLead: 2.1, pv: ['Q16'] }],
        }
        return new Response(`${JSON.stringify(event)}\n`, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，空点' }))

    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: /分析/ }))
    fireEvent.click(screen.getByRole('button', { name: '启动赛后分析' }))

    await waitFor(() => expect(screen.getByLabelText('胜率走势')).toHaveTextContent('黑 63.4%'))
    expect(screen.getByLabelText('胜率走势')).toHaveTextContent('白 36.6%')
    const request = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/analyze'))
      .map(([, init]) => JSON.parse(String(init?.body)))
      .at(-1)
    expect(request).toMatchObject({ profile: 'winrate', moves: [['B', 'D16']] })

    fireEvent.click(screen.getByRole('gridcell', { name: 'E16，空点' }))
    expect(screen.getByLabelText('胜率走势')).toHaveTextContent('待分析')
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/analyze'))).toHaveLength(1)
  })

  it('双虚着进入计分确认，并允许恢复落子或完成结算', async () => {
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: '虚着' }))

    expect(screen.getAllByText('计分确认').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /继续对局/ })).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: 'D16，空点' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /继续对局/ }))
    await waitFor(() => expect(screen.getByRole('gridcell', { name: 'D16，空点' })).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: /黑方确认/ }))
    expect(screen.queryByText('对局结束')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /白方确认/ }))

    expect(screen.getAllByText('对局结束')).toHaveLength(2)
    expect(screen.getByText(/白方胜 · 7.5 目/)).toBeInTheDocument()
  })

  it('计分阶段可标记整块死子，修改方案会重置双方确认', () => {
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，空点' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'Q4，空点' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'E16，空点' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'Q3，空点' }))
    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: '虚着' }))

    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，黑子' }))
    expect(screen.getByRole('gridcell', { name: 'D16，黑子，已标记死子' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('gridcell', { name: 'E16，黑子，已标记死子' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('计分预览')).toHaveTextContent('已标记死子 2 枚')

    fireEvent.click(screen.getByRole('button', { name: /黑方确认/ }))
    expect(screen.getByLabelText('计分预览')).toHaveTextContent('黑方 已确认')
    fireEvent.click(screen.getByRole('gridcell', { name: 'Q4，白子' }))
    expect(screen.getByLabelText('计分预览')).toHaveTextContent('黑方 待确认')
    expect(screen.getByRole('button', { name: /白方确认/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，黑子，已标记死子' }))
    expect(screen.getByRole('gridcell', { name: 'D16，黑子' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('gridcell', { name: 'E16，黑子' })).toHaveAttribute('aria-pressed', 'false')
  }, 20000)

  it('连接 KataGo 后可由 GameController 单步执行 AI 着法并展示分析', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/session')) return new Response('{"ok":true}', { status: 201 })
      if (url.endsWith('/capabilities')) {
        return Response.json({
          ready: true,
          engineVersion: '1.16-test',
          modelName: 'kata-test.bin.gz',
          runtimeBackend: 'native-katago',
          requestedBackend: 'native-katago',
          backendFallback: false,
          backendFallbackReason: null,
          modelFallback: false,
          modelFallbackReason: null,
          profiles: {
            fast: { maxVisits: 2_000, timeoutMs: 30_000 },
            strong: { maxVisits: 20_000, timeoutMs: 180_000 },
            winrate: { maxVisits: 256, timeoutMs: 12_000 },
          },
        })
      }
      if (url.endsWith('/analyze')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string; profile: 'fast' | 'strong' }
        const event = {
          type: 'analysis',
          stage: 'final',
          requestId: request.requestId,
          engineVersion: '1.16-test',
          modelName: 'kata-test.bin.gz',
          profile: request.profile,
          elapsedMs: 110,
          requestedVisits: 2_000,
          runtimeBackend: 'native-katago',
          requestedBackend: 'native-katago',
          backendFallback: false,
          backendFallbackReason: null,
          modelFallback: false,
          modelFallbackReason: null,
          timedOut: false,
          truncated: false,
          stopReason: 'visit-limit',
          root: { winrate: 0.56, scoreLead: 2.1, visits: 200 },
          candidates: [{
            move: 'D16', order: 0, visits: 180, prior: 0.2,
            winrate: 0.56, scoreLead: 2.1, pv: ['D16', 'Q4'],
          }],
        }
        return new Response(`${JSON.stringify(event)}\n`, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: 'AI 自对弈' }))
    await screen.findByText(/KataGo 已就绪，可以开始自对弈。/)
    expect(screen.getByRole('gridcell', { name: 'D16，空点' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /单步/ }))
    await waitFor(() => expect(screen.getByRole('gridcell', { name: 'D16，黑子，最近一步' })).toBeInTheDocument())
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('56.0%')
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('Native KataGo · OpenCL')
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('kata-test.bin.gz')
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('200 / 2000')
    expect(screen.getByLabelText('KataGo 候选着')).toHaveTextContent('D16')
    fireEvent.click(screen.getByRole('tab', { name: /分析/ }))
    fireEvent.click(screen.getByRole('button', { name: '启动赛后分析' }))
    await waitFor(() => expect(screen.getByLabelText('胜率走势')).toHaveTextContent('黑 56.0%'))
    expect(screen.getByLabelText('胜率走势')).toHaveTextContent('白 44.0%')
    expect(fetchMock).toHaveBeenCalledWith('/api/go/katago/analyze', expect.objectContaining({ method: 'POST' }))
    const analyzeProfiles = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/analyze'))
      .map(([, init]) => JSON.parse(String(init?.body)).profile)
    expect(analyzeProfiles).toContain('strong')
    expect(analyzeProfiles).toContain('winrate')
  })

  it('KataGo 服务未配置时保留空棋盘并显示可恢复错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { code: 'KATAGO_NOT_CONFIGURED', message: 'KataGo AI 服务尚未配置。' },
      { status: 503 },
    )))
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: 'AI 自对弈' }))
    expect(await screen.findByText('KataGo AI 服务尚未配置。')).toBeInTheDocument()
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('SERVICE ERROR')
    expect(screen.getByRole('gridcell', { name: 'D16，空点' })).toBeDisabled()
    expect(screen.queryByText('1 手')).not.toBeInTheDocument()
  })

  it('真人对 AI 模式复用规则控制器并在真人落子后自动请求 KataGo', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/session')) return new Response('{"ok":true}', { status: 201 })
      if (url.endsWith('/capabilities')) return Response.json({
        ready: true,
        engineVersion: '1.16-test',
        modelName: 'kata-test.bin.gz',
        runtimeBackend: 'native-katago',
        requestedBackend: 'native-katago',
        backendFallback: false,
        backendFallbackReason: null,
        modelFallback: false,
        modelFallbackReason: null,
        profiles: {
          fast: { maxVisits: 2_000, timeoutMs: 30_000 },
          strong: { maxVisits: 20_000, timeoutMs: 180_000 },
          winrate: { maxVisits: 256, timeoutMs: 12_000 },
        },
      })
      if (url.endsWith('/analyze')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string; profile: string }
        const event = {
          type: 'analysis', stage: 'final', requestId: request.requestId,
          engineVersion: '1.16-test', modelName: 'kata-test.bin.gz', profile: request.profile,
          elapsedMs: 80, requestedVisits: 20_000,
          runtimeBackend: 'native-katago', requestedBackend: 'native-katago',
          backendFallback: false, backendFallbackReason: null,
          modelFallback: false, modelFallbackReason: null,
          timedOut: false, truncated: false, stopReason: 'visit-limit',
          root: { winrate: 0.48, scoreLead: -0.4, visits: 300 },
          candidates: [{ move: 'Q4', order: 0, visits: 280, prior: 0.2, winrate: 0.48, scoreLead: -0.4, pv: ['Q4'] }],
        }
        return new Response(`${JSON.stringify(event)}\n`, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    await screen.findByText('人机对局已就绪，你执黑。')
    fireEvent.click(screen.getByRole('gridcell', { name: 'D16，空点' }))

    await waitFor(() => expect(screen.getByRole('gridcell', { name: 'Q4，白子，最近一步' })).toBeInTheDocument())
    expect(screen.getByRole('gridcell', { name: 'D16，黑子' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/analyze'))).toHaveLength(1)
  })

  it('提供独立 AI 互对弈入口和黑白双方引擎选择', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { code: 'LOCAL_ENGINE_REQUIRED', message: '本测试未启动原生引擎。' },
      { status: 503 },
    )))
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: 'AI 互对弈' }))

    const black = await screen.findByRole('combobox', { name: '黑方 AI 引擎' })
    const white = screen.getByRole('combobox', { name: '白方 AI 引擎' })
    expect(black).toHaveValue('katago')
    expect(white).toHaveValue('leela-zero')
    expect(black.querySelectorAll('option')).toHaveLength(3)
    expect(white.querySelectorAll('option')).toHaveLength(3)
    expect(black).toHaveTextContent('Sayuri')
    expect(screen.getByText(/现有 AI 自对弈配置不变/)).toBeInTheDocument()
  })

  it('AI 互对弈默认不运行第三方胜率，暂停后才按请求赛后分析', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/katago/session')) return new Response('{"ok":true}', { status: 201 })
      if (url.endsWith('/katago/capabilities')) {
        return Response.json({
          ready: true,
          engineVersion: '1.16-test',
          modelName: 'kata-test.bin.gz',
          runtimeBackend: 'native-katago',
          requestedBackend: 'native-katago',
          backendFallback: false,
          backendFallbackReason: null,
          modelFallback: false,
          modelFallbackReason: null,
          profiles: {
            fast: { maxVisits: 2_000, timeoutMs: 30_000 },
            strong: { maxVisits: 20_000, timeoutMs: 180_000 },
            'battle-matched': { maxVisits: 250, timeoutMs: 30_000 },
            winrate: { maxVisits: 256, timeoutMs: 12_000 },
          },
        })
      }
      if (url.endsWith('/leela-zero/capabilities')) {
        return Response.json({
          ready: true,
          engineVersion: '0.17-test',
          modelName: 'lz-test.gz',
          runtimeBackend: 'native-leela-zero',
          playouts: 3_200,
          timeoutMs: 30_000,
        })
      }
      if (url.endsWith('/katago/analyze')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string; profile: string }
        const isChart = request.profile === 'winrate'
        const event = {
          type: 'analysis', stage: 'final', requestId: request.requestId,
          engineVersion: '1.16-test', modelName: 'kata-test.bin.gz', profile: request.profile,
          elapsedMs: 95, requestedVisits: isChart ? 256 : 250,
          runtimeBackend: 'native-katago', requestedBackend: 'native-katago',
          backendFallback: false, backendFallbackReason: null,
          modelFallback: false, modelFallbackReason: null,
          timedOut: false, truncated: false, stopReason: 'visit-limit',
          root: { winrate: isChart ? 0.612 : 0.55, scoreLead: 1.8, visits: isChart ? 256 : 250 },
          candidates: [{ move: isChart ? 'Q16' : 'D16', order: 0, visits: 220, prior: 0.2, winrate: 0.55, scoreLead: 1.5, pv: [isChart ? 'Q16' : 'D16'] }],
        }
        return new Response(`${JSON.stringify(event)}\n`, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: 'AI 互对弈' }))
    await screen.findByText('AI 互对弈引擎已就绪，可以开始对弈。')
    fireEvent.click(screen.getByRole('button', { name: /单步/ }))

    await waitFor(() => expect(screen.getByRole('gridcell', { name: 'D16，黑子，最近一步' })).toBeInTheDocument())
    let profiles = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/katago/analyze'))
      .map(([, init]) => JSON.parse(String(init?.body)).profile)
    expect(profiles).toEqual(['battle-matched'])
    fireEvent.click(screen.getByRole('tab', { name: /分析/ }))
    fireEvent.click(screen.getByRole('button', { name: '启动赛后分析' }))

    await waitFor(() => expect(screen.getByLabelText('胜率走势')).toHaveTextContent('黑 61.2%'))
    expect(screen.getByLabelText('胜率走势')).toHaveTextContent('白 38.8%')
    profiles = fetchMock.mock.calls
      .filter(([input]) => String(input).endsWith('/katago/analyze'))
      .map(([, init]) => JSON.parse(String(init?.body)).profile)
    expect(profiles).toContain('battle-matched')
    expect(profiles).toContain('winrate')
  })
})
