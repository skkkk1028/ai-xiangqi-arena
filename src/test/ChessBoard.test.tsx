import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('样式显式固定八行八列并采用明亮纸张背景', () => {
    expect(chessCss).toContain('grid-template-columns: repeat(8, minmax(0, 1fr))')
    expect(chessCss).toContain('grid-template-rows: repeat(8, minmax(0, 1fr))')
    expect(chessCss).toContain('#f4eee3')
    expect(chessCss).not.toContain('perspective(1100px) rotateX(2deg)')
  })
})
