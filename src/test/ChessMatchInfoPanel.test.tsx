import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChessMatchInfoPanel } from '../games/chess/ChessMatchInfoPanel'
import { replayChessState } from '../games/chess/rules'

describe('国际象棋走子与优势分面板', () => {
  afterEach(cleanup)

  it('按回合显示双方 SAN/UCI，并在没有引擎评估时标明子力估算', () => {
    render(<ChessMatchInfoPanel state={replayChessState(['e2e4', 'e7e5', 'g1f3'])} analyses={{}} />)
    expect(screen.getByText(/当前局面子力估算/)).toBeInTheDocument()
    expect(screen.getByText('e4')).toBeInTheDocument()
    expect(screen.getByText('e5')).toBeInTheDocument()
    expect(screen.getByText('Nf3')).toBeInTheDocument()
    expect(screen.getByText('e2e4')).toBeInTheDocument()
  })
})
