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
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('KataGo 本地引擎待命')
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

  it('双虚着进入计分确认，并允许恢复落子或完成结算', () => {
    render(<GoGamePage />)

    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: '虚着' }))

    expect(screen.getAllByText('计分确认').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /继续对局/ })).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: 'D16，空点' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /继续对局/ }))
    expect(screen.getByRole('gridcell', { name: 'D16，空点' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: '虚着' }))
    fireEvent.click(screen.getByRole('button', { name: /确认计分/ }))

    expect(screen.getAllByText('对局结束')).toHaveLength(2)
    expect(screen.getByText(/白方胜 · 7.5 目/)).toBeInTheDocument()
  })

  it('连接 KataGo 后可由 GameController 单步执行 AI 着法并展示分析', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/session')) return new Response('{"ok":true}', { status: 201 })
      if (url.endsWith('/capabilities')) {
        return Response.json({
          ready: true,
          engineVersion: '1.16-test',
          modelName: 'kata-test.bin.gz',
          profiles: {
            fast: { maxVisits: 200, timeoutMs: 8_000 },
            strong: { maxVisits: 800, timeoutMs: 30_000 },
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
          truncated: false,
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
    await screen.findByText('浏览器 KataGo 已就绪，可以开始自对弈。')
    expect(screen.getByRole('gridcell', { name: 'D16，空点' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /单步/ }))
    await waitFor(() => expect(screen.getByRole('gridcell', { name: 'D16，黑子，最近一步' })).toBeInTheDocument())
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('56.0%')
    expect(screen.getByLabelText('KataGo 候选着')).toHaveTextContent('D16')
    expect(fetchMock).toHaveBeenCalledWith('/api/go/katago/analyze', expect.objectContaining({ method: 'POST' }))
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
})
