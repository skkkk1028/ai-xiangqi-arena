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

  it('国际象棋入口按需加载独立模式首页', async () => {
    window.history.replaceState(null, '', '#/games/chess')
    render(<GamePortal />)

    expect(await screen.findByRole('heading', { name: '国际象棋演算厅' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /双人格观战剧场/ })).toHaveAttribute('href', '#/games/chess/theatre')
    expect(screen.getByRole('link', { name: /多引擎对战竞技场/ })).toHaveAttribute('href', '#/games/chess/arena')
  })

  it('国际象棋三个子路由可以直接刷新访问', async () => {
    window.history.replaceState(null, '', '#/games/chess/theatre')
    const view = render(<GamePortal />)
    expect(await screen.findByRole('heading', { name: '双人格观战剧场' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: '国际象棋棋盘' })).toBeInTheDocument()
    view.unmount()
    window.history.replaceState(null, '', '#/games/chess/arena')
    render(<GamePortal />)
    expect(await screen.findByRole('heading', { name: '多引擎对战竞技场' })).toBeInTheDocument()
    expect(screen.getByLabelText('白方 AI 引擎')).toHaveValue('stockfish-18')
    expect(screen.getByLabelText('黑方 AI 引擎')).toHaveValue('obsidian-16')
    view.unmount()
    window.history.replaceState(null, '', '#/games/chess/human')
    render(<GamePortal />)
    expect(await screen.findByRole('heading', { name: '人机对战' })).toBeInTheDocument()
    expect(screen.getByLabelText('真人执子方')).toHaveValue('w')
    expect(screen.getByLabelText('AI 对手')).toHaveValue('stockfish-18')
  })

  it('hash 变化时在大厅与棋类模块之间切换', async () => {
    render(<GamePortal />)
    window.history.replaceState(null, '', '#/games/go')
    fireEvent(window, new HashChangeEvent('hashchange'))

    expect(await screen.findByRole('heading', { name: '静室手谈' })).toBeInTheDocument()
  })
})
