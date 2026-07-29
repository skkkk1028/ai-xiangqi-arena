import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: { type: string }) {
    if (message.type === 'init') {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: 'ready',
            profile: {
              name: 'Fairy-Stockfish NNUE · UCCI',
              version: 'test',
              commit: 'test',
              network: 'test.nnue',
              networkSha256: 'abc',
              threads: 1,
              hashMb: 64,
            },
          },
        } as MessageEvent),
      )
    }
  }

  terminate() {}
}

describe('观战界面', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('仅在专业引擎就绪后允许开始并显示双方20分钟棋钟', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    const startButton = await screen.findByRole('button', { name: '开始对弈' })
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)

    await waitFor(() => expect(screen.getByLabelText('中国象棋棋盘')).toBeInTheDocument())
    expect(screen.getByLabelText('红方剩余时间')).toHaveTextContent('20:00')
    expect(screen.getByLabelText('黑方剩余时间')).toHaveTextContent('20:00')
    expect(screen.getByText('对局记录')).toBeInTheDocument()
    view.unmount()
  })
})
