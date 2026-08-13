import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GamePortal } from '../games/GamePortal'

vi.mock('../App', () => ({
  default: () => <main aria-label="现有中国象棋页面">象棋现有功能</main>,
}))

describe('AI 棋类大厅', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '#/')
  })

  afterEach(() => {
    cleanup()
  })

  it('首页提供三种独立棋类入口', () => {
    render(<GamePortal />)

    expect(screen.getByRole('heading', { name: /一方棋盘\s*三种智慧/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /中国象棋/ })).toHaveAttribute('href', '#/games/xiangqi')
    expect(screen.getByRole('link', { name: /围棋/ })).toHaveAttribute('href', '#/games/go')
    expect(screen.getByRole('link', { name: /国际象棋/ })).toHaveAttribute('href', '#/games/chess')
  })

  it('中国象棋路由只挂载原有应用并提供大厅返回入口', async () => {
    window.history.replaceState(null, '', '#/games/xiangqi')
    render(<GamePortal />)

    expect(await screen.findByLabelText('现有中国象棋页面')).toHaveTextContent('象棋现有功能')
    expect(screen.getByRole('link', { name: '返回 AI 棋类大厅' })).toHaveAttribute('href', '#/')
  })

  it('围棋入口进入可交互的十九路棋院页面', async () => {
    window.history.replaceState(null, '', '#/games/go')
    render(<GamePortal />)

    expect(await screen.findByRole('heading', { name: '静室手谈' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: '十九路围棋棋盘' })).toBeInTheDocument()
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('KataGo 引擎待命')
  })

  it('国际象棋入口按需加载，默认只显示已就绪状态', async () => {
    window.history.replaceState(null, '', '#/games/chess')
    render(<GamePortal />)

    expect(await screen.findByRole('heading', { name: '双人格观战剧场' })).toBeInTheDocument()
    expect(screen.getByText(/不会自动开赛/)).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: '国际象棋棋盘' })).toBeInTheDocument()
  })

  it('hash 变化时在大厅与棋类模块之间切换', async () => {
    render(<GamePortal />)
    window.history.replaceState(null, '', '#/games/go')
    fireEvent(window, new HashChangeEvent('hashchange'))

    expect(await screen.findByRole('heading', { name: '静室手谈' })).toBeInTheDocument()
  })
})
