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

  it('首页提供中国象棋与围棋两个独立入口', () => {
    render(<GamePortal />)

    expect(screen.getByRole('heading', { name: /一方棋盘\s*两种智慧/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /中国象棋/ })).toHaveAttribute('href', '#/games/xiangqi')
    expect(screen.getByRole('link', { name: /围棋/ })).toHaveAttribute('href', '#/games/go')
  })

  it('中国象棋路由只挂载原有应用并提供大厅返回入口', () => {
    window.history.replaceState(null, '', '#/games/xiangqi')
    render(<GamePortal />)

    expect(screen.getByLabelText('现有中国象棋页面')).toHaveTextContent('象棋现有功能')
    expect(screen.getByRole('link', { name: '返回 AI 棋类大厅' })).toHaveAttribute('href', '#/')
  })

  it('围棋入口进入可交互的十九路棋院页面', () => {
    window.history.replaceState(null, '', '#/games/go')
    render(<GamePortal />)

    expect(screen.getByRole('heading', { name: '静室手谈' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: '十九路围棋棋盘' })).toBeInTheDocument()
    expect(screen.getByLabelText('KataGo AI 信息面板')).toHaveTextContent('KataGo 本地引擎待命')
  })

  it('hash 变化时在大厅与棋类模块之间切换', () => {
    render(<GamePortal />)
    window.history.replaceState(null, '', '#/games/go')
    fireEvent(window, new HashChangeEvent('hashchange'))

    expect(screen.getByRole('heading', { name: '静室手谈' })).toBeInTheDocument()
  })
})
