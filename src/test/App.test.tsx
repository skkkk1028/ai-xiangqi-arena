import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

class MockWorker {
  static instances: MockWorker[] = []
  static initializedEngineIds: string[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  constructor() {
    MockWorker.instances.push(this)
  }

  postMessage(message: { type: string; config?: { id: string; name: string; engineType: string; protocol: 'UCCI' | 'UCI' } }) {
    if (message.type === 'init') {
      const config = message.config
      if (config) MockWorker.initializedEngineIds.push(config.id)
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: 'ready',
            profile: {
              id: config?.id,
              engineType: config?.engineType,
              protocol: config?.protocol,
              name: config?.name ?? 'Fairy-Stockfish NNUE · UCCI',
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

class HumanModeWorker extends MockWorker {
  static searchMessages: Array<{
    moves: string[]
    movetimeMs: number
    multiPv: number
    maxDepth?: number
  }> = []
  static initConfigs: Array<{ id: string; threads: number; hash: number }> = []
  static failNextSearch = false

  override postMessage(message: {
    type: string
    searchId?: number
    moves?: string[]
    movetimeMs?: number
    multiPv?: number
    maxDepth?: number
    config?: {
      id: string
      name: string
      engineType: string
      protocol: 'UCCI' | 'UCI'
      threads: number
      hash: number
    }
  }) {
    super.postMessage(message)
    if (message.type === 'init' && message.config) {
      HumanModeWorker.initConfigs.push(message.config)
    }
    if (message.type === 'search' && message.searchId !== undefined) {
      if (HumanModeWorker.failNextSearch) {
        HumanModeWorker.failNextSearch = false
        const searchId = message.searchId
        queueMicrotask(() => {
          this.onmessage?.({ data: { type: 'search-started', searchId } } as MessageEvent)
          this.onmessage?.({ data: { type: 'fatal', message: '模拟 Worker 崩溃' } } as MessageEvent)
        })
        return
      }
      const moves = message.moves ?? []
      const bestmove = moves.length === 0 ? 'b0c2' : 'a9a8'
      HumanModeWorker.searchMessages.push({
        moves,
        movetimeMs: message.movetimeMs ?? 0,
        multiPv: message.multiPv ?? 0,
        maxDepth: message.maxDepth,
      })
      const searchId = message.searchId
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: 'search-started', searchId } } as MessageEvent)
        this.onmessage?.({
          data: {
            type: 'line',
            searchId,
            line: `info depth 8 multipv 1 score cp 20 wdl 400 400 200 pv ${bestmove}`,
          },
        } as MessageEvent)
        this.onmessage?.({
          data: { type: 'line', searchId, line: `bestmove ${bestmove}` },
        } as MessageEvent)
      })
    }
  }
}

describe('观战界面', () => {
  afterEach(() => {
    cleanup()
    MockWorker.instances = []
    MockWorker.initializedEngineIds = []
    HumanModeWorker.searchMessages = []
    HumanModeWorker.initConfigs = []
    HumanModeWorker.failNextSearch = false
    vi.unstubAllGlobals()
  })

  it('首页保留两个 AI 入口并新增独立真人入口', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    expect(await screen.findByText('AI 人格对战')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI 引擎对战/ })).toHaveTextContent('AI 引擎大战')
    expect(screen.getByRole('button', { name: '真人 vs AI' })).toBeEnabled()
    view.unmount()
  })

  it.each([
    'fairy-stockfish-nnue',
    'pikafish-2026-nnue',
    'pikafish-2025-nnue',
  ])('已注册引擎 %s 可启动人机模式', async (engineId) => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('button', { name: '真人 vs AI' })
    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    expect(await screen.findByRole('heading', { name: '真人挑战 AI' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Engine Registry'), { target: { value: engineId } })
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))
    await screen.findByText('真人玩家 · 红方')
    expect(MockWorker.initializedEngineIds.at(-1)).toBe(engineId)
    view.unmount()
  })

  it('真人执黑时 AI 先手自动落子，入门难度映射深度、Hash 与思考时间', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('button', { name: '真人 vs AI' })
    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    fireEvent.click(await screen.findByLabelText('黑方 · 后手'))
    fireEvent.click(screen.getByText('入门').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))

    await waitFor(() => expect(HumanModeWorker.searchMessages).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0))
    expect(HumanModeWorker.searchMessages[0]).toMatchObject({
      moves: [],
      multiPv: 4,
      maxDepth: 6,
    })
    expect(HumanModeWorker.searchMessages[0].movetimeMs).toBeGreaterThanOrEqual(1_000)
    expect(HumanModeWorker.searchMessages[0].movetimeMs).toBeLessThanOrEqual(2_000)
    expect(HumanModeWorker.initConfigs.at(-1)).toMatchObject({ hash: 16, threads: 1 })
    expect(screen.getByText('真人玩家 · 黑方')).toBeInTheDocument()
    view.unmount()
  })

  it('真人执红可点击合法着法，随后 AI 接收完整 position 并自动落子', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('button', { name: '真人 vs AI' })
    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))
    await screen.findByText('真人玩家 · 红方')
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '红方兵 7行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '6行1列空位' }))

    await waitFor(() => expect(HumanModeWorker.searchMessages).toHaveLength(1))
    expect(HumanModeWorker.searchMessages[0].moves).toEqual(['a3a4'])
    await waitFor(() => expect(screen.getByRole('button', { name: '红方兵 6行1列' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0))
    expect(screen.getByText('兵九进一')).toBeInTheDocument()
    expect(screen.getByText('2 步')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开始新对局' }))
    await waitFor(() => expect(screen.getByText('0 步')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '红方兵 7行1列' })).toBeInTheDocument()
    view.unmount()
  })

  it('人机模式暂停和恢复后保持当前棋局', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('button', { name: '真人 vs AI' })
    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))
    await screen.findByText('真人玩家 · 红方')

    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getAllByText('对局暂停').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled()
    expect(screen.getByText('0 步')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
    expect(screen.getByText('0 步')).toBeInTheDocument()
    view.unmount()
  })

  it('AI Worker 搜索中崩溃后只重建当前人机引擎并恢复局面', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    HumanModeWorker.failNextSearch = true
    const view = render(<App />)

    await screen.findByRole('button', { name: '真人 vs AI' })
    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    fireEvent.click(screen.getByLabelText('黑方 · 后手'))
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))

    await waitFor(() => expect(MockWorker.initializedEngineIds.length).toBeGreaterThanOrEqual(3))
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0))
    expect(MockWorker.initializedEngineIds.slice(-2)).toEqual([
      'fairy-stockfish-nnue',
      'fairy-stockfish-nnue',
    ])
    expect(screen.queryByText('AI Worker 恢复失败。')).not.toBeInTheDocument()
    view.unmount()
  })

  it('从独立选择页启动 Fairy 与 Pikafish 两个 Worker 实例', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('button', { name: '开始对弈' })
    fireEvent.click(screen.getByRole('button', { name: /AI 引擎对战/ }))
    expect(await screen.findByRole('heading', { name: 'AI 引擎对战' })).toBeInTheDocument()
    expect(screen.getByLabelText('红方 AI')).toHaveValue('fairy-stockfish-nnue')
    expect(screen.getByLabelText('黑方 AI')).toHaveValue('pikafish-2026-nnue')

    fireEvent.click(screen.getByRole('button', { name: '开始引擎对战' }))
    await waitFor(() => expect(screen.getByLabelText('中国象棋棋盘')).toBeInTheDocument())
    expect(screen.getAllByText('Fairy-Stockfish NNUE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pikafish 2026 NNUE').length).toBeGreaterThan(0)
    expect(screen.getByText('等待引擎评价')).toBeInTheDocument()
    expect(MockWorker.initializedEngineIds.slice(-2).sort()).toEqual([
      'fairy-stockfish-nnue',
      'pikafish-2026-nnue',
    ])
    expect(new Set(MockWorker.instances.slice(-2)).size).toBe(2)
    view.unmount()
  })

  it.each([
    ['fairy-stockfish-nnue', 'pikafish-2025-nnue'],
    ['pikafish-2026-nnue', 'pikafish-2025-nnue'],
  ])('可独立启动 %s 对 %s', async (redId, blackId) => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('button', { name: '开始对弈' })
    fireEvent.click(screen.getByRole('button', { name: /AI 引擎对战/ }))
    await screen.findByRole('heading', { name: 'AI 引擎对战' })
    fireEvent.change(screen.getByLabelText('红方 AI'), { target: { value: redId } })
    fireEvent.change(screen.getByLabelText('黑方 AI'), { target: { value: blackId } })
    expect(screen.getByText('Pikafish-2025-06-23')).toBeInTheDocument()
    expect(screen.getByText('pikafish-2025.nnue')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开始引擎对战' }))
    await waitFor(() => expect(screen.getByLabelText('中国象棋棋盘')).toBeInTheDocument())
    expect(MockWorker.initializedEngineIds.slice(-2)).toEqual([redId, blackId])
    expect(new Set(MockWorker.instances.slice(-2)).size).toBe(2)
    view.unmount()
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
    expect(screen.getByText('进攻型 · Fairy-Stockfish')).toBeInTheDocument()
    expect(screen.getByText('稳健型 · Fairy-Stockfish')).toBeInTheDocument()
    expect(screen.getByText(/^红方开局：/)).toBeInTheDocument()
    expect(screen.getByText(/^黑方应手：/)).toBeInTheDocument()
    expect(screen.getAllByText(/^当前棋谱：/)).toHaveLength(2)
    view.unmount()
  })

  it('AI 对战暂停和恢复后保持棋钟与棋谱', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '开始对弈' }))
    await waitFor(() => expect(screen.getByLabelText('中国象棋棋盘')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getAllByText('对局暂停').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled()
    expect(screen.getByLabelText('红方剩余时间')).toHaveTextContent('20:00')
    expect(screen.getByText('0 步')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
    expect(screen.getByText('0 步')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('1 步')).toBeInTheDocument(), { timeout: 2_000 })
    view.unmount()
  })

  it.each([
    ['移动端', 390, 844],
    ['桌面端', 1440, 900],
  ])('%s视口保持原有启动与对局流程', async (_label, width, height) => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    vi.stubGlobal('innerWidth', width)
    vi.stubGlobal('innerHeight', height)
    const view = render(<App />)

    const startButton = await screen.findByRole('button', { name: '开始对弈' })
    expect(startButton).toBeEnabled()
    fireEvent.click(startButton)
    await waitFor(() => expect(screen.getByLabelText('中国象棋棋盘')).toBeInTheDocument())
    expect(screen.getByLabelText('红方剩余时间')).toHaveTextContent('20:00')
    expect(screen.getByLabelText('黑方剩余时间')).toHaveTextContent('20:00')
    view.unmount()
  })
})
