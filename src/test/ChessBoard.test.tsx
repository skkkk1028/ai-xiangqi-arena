import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChessBoard } from '../games/chess/ChessBoard'
import { replayChessState } from '../games/chess/rules'
import chessCss from '../games/chess/chess.css?raw'

describe('国际象棋棋盘动画', () => {
  afterEach(cleanup)

  it('为最近一步建立源格到目标格的移动层', () => {
    const { container } = render(<ChessBoard state={replayChessState(['e2e4'])} />)
    const motion = container.querySelector<HTMLElement>('.chess-piece-motion')
    expect(motion).not.toBeNull()
    expect(motion?.style.getPropertyValue('--chess-from-x')).toBe('50%')
    expect(motion?.style.getPropertyValue('--chess-move-y')).toBe('-200%')
    expect(container.querySelector('.chess-piece--arriving')).not.toBeNull()
  })

  it('普通吃子和吃过路兵均建立被吃棋子淡出层', () => {
    const normal = render(<ChessBoard state={replayChessState(['e2e4', 'd7d5', 'e4d5'])} />)
    expect(normal.container.querySelector('.chess-captured-ghost')).not.toBeNull()
    normal.unmount()

    const enPassant = render(<ChessBoard state={replayChessState(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])} />)
    const ghost = enPassant.container.querySelector<HTMLElement>('.chess-captured-ghost')
    expect(ghost).not.toBeNull()
    expect(ghost?.style.getPropertyValue('--chess-capture-x')).toBe('37.5%')
    expect(ghost?.style.getPropertyValue('--chess-capture-y')).toBe('37.5%')
  })

  it('包含完整空行的稀疏局面仍固定渲染 64 个方格', () => {
    const sparse = replayChessState([], { initialFen: '7k/8/8/8/8/8/8/K7 w - - 0 1' })
    const { container } = render(<ChessBoard state={sparse} />)
    expect(container.querySelectorAll('.chess-square')).toHaveLength(64)
    expect(container.querySelectorAll('.chess-piece:not(.chess-piece-motion):not(.chess-captured-ghost)')).toHaveLength(2)
  })

  it('重试升变时可选择马而不是自动升后', () => {
    const state = replayChessState([], { initialFen: '7k/P7/8/8/8/8/8/K7 w - - 0 1' })
    const onMove = vi.fn()
    render(<ChessBoard state={state} interactive humanColor="w" onMove={onMove} />)
    fireEvent.click(screen.getByRole('gridcell', { name: /a7 白方p/ }))
    fireEvent.click(screen.getByRole('gridcell', { name: /a8 可落子/ }))
    fireEvent.click(screen.getByRole('button', { name: '马' }))
    expect(onMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'n' })
  })

  it('方向键逐格移动焦点，空格选子和回车落子只提交一次', () => {
    const state = replayChessState([])
    const onMove = vi.fn()
    render(<ChessBoard state={state} interactive humanColor="w" onMove={onMove} />)
    const e2 = screen.getByRole('gridcell', { name: /e2 白方p/ })
    const e3 = screen.getByRole('gridcell', { name: /^e3/ })
    const e4 = screen.getByRole('gridcell', { name: /^e4/ })
    expect(screen.getByRole('grid').getAttribute('aria-description')).toContain('方向键选格')
    expect(screen.getAllByRole('gridcell').filter((cell) => cell.tabIndex === 0)).toEqual([e2])
    e2.focus()
    fireEvent.keyDown(e2, { key: ' ' })
    expect(e2).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(e2, { key: 'ArrowUp' })
    expect(e3).toHaveFocus()
    fireEvent.keyDown(e3, { key: 'ArrowUp' })
    expect(e4).toHaveFocus()
    expect(screen.getAllByRole('gridcell').filter((cell) => cell.tabIndex === 0)).toEqual([e4])
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.keyDown(e4, { key: 'Enter' })
    expect(onMove).toHaveBeenCalledOnce()
    expect(onMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' })
    expect(e2).toHaveTextContent('♙')
  })

  it('Esc 取消选子，方向键在边缘停住，禁用时不提供棋盘 Tab 入口', () => {
    const onMove = vi.fn()
    const state = replayChessState([])
    const view = render(<ChessBoard state={state} interactive humanColor="w" onMove={onMove} />)
    const a8 = screen.getByRole('gridcell', { name: /^a8/ })
    a8.focus()
    fireEvent.keyDown(a8, { key: 'ArrowUp' })
    fireEvent.keyDown(a8, { key: 'ArrowLeft' })
    expect(a8).toHaveFocus()
    expect(a8).toHaveAttribute('tabindex', '0')
    const e2 = screen.getByRole('gridcell', { name: /e2 白方p/ })
    e2.focus()
    fireEvent.keyDown(e2, { key: 'Enter' })
    fireEvent.keyDown(e2, { key: 'Escape' })
    expect(e2).toHaveAttribute('aria-selected', 'false')
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /^e4/ }), { key: 'Enter' })
    expect(onMove).not.toHaveBeenCalled()
    view.rerender(<ChessBoard state={state} interactive humanColor="w" disabled onMove={onMove} />)
    expect(screen.getAllByRole('gridcell').every((cell) => cell.tabIndex === -1)).toBe(true)
  })

  it('键盘触发升变后聚焦选项，Esc 可取消并返回目标格', () => {
    const state = replayChessState([], { initialFen: '7k/P7/8/8/8/8/8/K7 w - - 0 1' })
    const onMove = vi.fn()
    render(<ChessBoard state={state} interactive humanColor="w" onMove={onMove} />)
    const a7 = screen.getByRole('gridcell', { name: /a7 白方p/ })
    const a8 = screen.getByRole('gridcell', { name: /^a8/ })
    a7.focus()
    fireEvent.keyDown(a7, { key: 'Enter' })
    fireEvent.keyDown(a7, { key: 'ArrowUp' })
    expect(a8).toHaveFocus()
    fireEvent.keyDown(a8, { key: ' ' })
    const firstChoice = screen.getByRole('group', { name: '选择升变棋子' }).querySelector('button')
    expect(firstChoice).toHaveFocus()
    fireEvent.keyDown(firstChoice!, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '选择升变棋子' })).not.toBeInTheDocument()
    expect(a8).toHaveFocus()
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.keyDown(a8, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '马' }))
    expect(onMove).toHaveBeenCalledOnce()
    expect(onMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'n' })
  })

  it('样式显式固定八行八列并采用明亮纸张背景', () => {
    expect(chessCss).toContain('grid-template-columns: repeat(8, minmax(0, 1fr))')
    expect(chessCss).toContain('grid-template-rows: repeat(8, minmax(0, 1fr))')
    expect(chessCss).toContain('#f4eee3')
    expect(chessCss).not.toContain('perspective(1100px) rotateX(2deg)')
  })
})
