import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage() {}
  terminate() {}
}

describe('观战界面', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('从首页开始对弈并显示棋盘与双方棋钟', () => {
    vi.stubGlobal('Worker', MockWorker)
    const view = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '开始对弈' }))

    expect(screen.getByLabelText('中国象棋棋盘')).toBeInTheDocument()
    expect(screen.getByLabelText('红方剩余时间')).toBeInTheDocument()
    expect(screen.getByLabelText('黑方剩余时间')).toBeInTheDocument()
    expect(screen.getByText('对局记录')).toBeInTheDocument()
    view.unmount()
  })
})
