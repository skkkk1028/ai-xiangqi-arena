import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { moveToUcci } from '../engine/ucci'
import { XiangqiGameEngine } from '../games/xiangqi'

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

class BattleRecoveryWorker extends MockWorker {
  static failNextSearch = true
  static completedReplies = 0

  override postMessage(message: {
    type: string
    searchId?: number
    moves?: string[]
    config?: { id: string; name: string; engineType: string; protocol: 'UCCI' | 'UCI' }
  }) {
    super.postMessage(message)
    if (message.type !== 'search' || message.searchId === undefined) return
    const searchId = message.searchId
    if (BattleRecoveryWorker.failNextSearch) {
      BattleRecoveryWorker.failNextSearch = false
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: 'search-started', searchId } } as MessageEvent)
        this.onmessage?.({ data: { type: 'fatal', message: '模拟引擎大战 Worker 崩溃' } } as MessageEvent)
      })
      return
    }
    if (BattleRecoveryWorker.completedReplies > 0) return
    BattleRecoveryWorker.completedReplies += 1
    const game = new XiangqiGameEngine()
    let state = game.initializeGame()
    for (const ucci of message.moves ?? []) {
      const move = game.findLegalActionByUcci(state, ucci)
      if (!move) throw new Error(`测试棋谱包含非法着法：${ucci}`)
      state = game.executeAction(state, move)
    }
    const bestmove = moveToUcci(game.getLegalActions(state)[0])
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: 'search-started', searchId } } as MessageEvent)
      this.onmessage?.({
        data: { type: 'line', searchId, line: `info depth 8 multipv 1 score cp 20 wdl 400 400 200 pv ${bestmove}` },
      } as MessageEvent)
      this.onmessage?.({ data: { type: 'line', searchId, line: `bestmove ${bestmove}` } } as MessageEvent)
    })
  }
}

describe('观战界面', () => {
  it('首页开局练习可进入、沿谱不创建新引擎，返回恢复首页', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: '开始对弈' })).toBeEnabled())
    const count = MockWorker.instances.length
    fireEvent.click(screen.getByRole('button', { name: '开局练习' }))
    expect(screen.getByRole('heading', { name: '开局练习', level: 1 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '从此局面开始' }))
    expect(MockWorker.instances).toHaveLength(count)
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始对弈' })).toBeEnabled())
  })
  afterEach(() => {
    cleanup()
    MockWorker.instances = []
    MockWorker.initializedEngineIds = []
    HumanModeWorker.searchMessages = []
    HumanModeWorker.initConfigs = []
    HumanModeWorker.failNextSearch = false
    BattleRecoveryWorker.failNextSearch = true
    BattleRecoveryWorker.completedReplies = 0
    vi.unstubAllGlobals()
  })

  it('首页保留两个 AI 入口并新增独立真人和同屏双人入口', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    expect(await screen.findByText('AI 人格对战')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI 引擎对战/ })).toHaveTextContent('AI 引擎大战')
    expect(screen.getByRole('button', { name: '真人 vs AI' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '同屏双人对战' })).toBeEnabled()
    view.unmount()
  })

  it('竞猜开启后每手先停住，跳过揭晓并统计本局结果', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    await screen.findByRole('checkbox', { name: /猜下一手/ })
    fireEvent.click(screen.getByRole('checkbox', { name: /猜下一手/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始对弈' }))
    expect(await screen.findByText(/请猜/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交猜招' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '跳过并揭晓' }))
    expect(await screen.findByText(/AI 实战着/)).toBeInTheDocument()
    expect(screen.getByText(/本题跳过/)).toBeInTheDocument()
    expect(screen.getByText(/作答 0 · 命中 0/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一题' })).toBeEnabled()
    view.unmount()
  })

  it('竞猜作答只计本局，新对局重置成绩', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    fireEvent.click(await screen.findByRole('checkbox', { name: /猜下一手/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始对弈' }))
    await screen.findByText(/请猜/)
    fireEvent.click(screen.getByRole('button', { name: '红方兵 7行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '6行1列空位' }))
    expect(screen.getByRole('button', { name: '提交猜招' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '提交猜招' }))
    expect(await screen.findByText(/AI 实战着/, {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.getByText(/作答 1 · 命中/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '开始新对局' }))
    expect(await screen.findByText(/请猜/)).toBeInTheDocument()
    expect(screen.getByText(/作答 0 · 命中 0/)).toBeInTheDocument()
    view.unmount()
  })

  it('StrictMode 下揭晓只推进一手', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<StrictMode><App /></StrictMode>)

    fireEvent.click(await screen.findByRole('checkbox', { name: /猜下一手/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始对弈' }))
    await screen.findByText(/请猜/)
    fireEvent.click(screen.getByRole('button', { name: '跳过并揭晓' }))
    expect(await screen.findByText(/AI 实战着/, {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.getByText('1 步')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一题' })).toBeEnabled()
    view.unmount()
  })

  it('同屏双人入口进入独立主题，双方确认后启动红方棋钟并可合法落子', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '同屏双人对战' }))
    expect((await screen.findAllByText('双方就绪，等待开始')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '开始对局' })).toBeEnabled()
    expect(screen.getByLabelText('红方剩余时间')).toHaveTextContent('20:00')
    expect(screen.getByLabelText('黑方剩余时间')).toHaveTextContent('20:00')
    expect(screen.getByText('对局协商')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提和' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText(/红方视角 W\/D\/L/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))
    fireEvent.click(screen.getByRole('button', { name: '红方兵 7行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '6行1列空位' }))
    expect(await screen.findByText('兵九进一')).toBeInTheDocument()
    expect(screen.getByText('1 步')).toBeInTheDocument()
    await waitFor(() => expect(HumanModeWorker.searchMessages.at(-1)?.moves).toEqual(['a3a4']))
    view.unmount()
  })

  it('同屏双人友谊悔棋经对手同意后撤销完整一回合', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '同屏双人对战' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始对局' }))
    fireEvent.click(screen.getByRole('button', { name: '红方兵 7行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '6行1列空位' }))
    fireEvent.click(screen.getByRole('button', { name: '黑方卒 4行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '5行1列空位' }))
    expect(screen.getByText('2 步')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '悔棋' }))
    const confirmation = screen.getByRole('dialog', { name: '申请友谊悔棋？' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认' }))
    const opponentDialog = await screen.findByRole('dialog', { name: '对方申请友谊悔棋' })
    fireEvent.click(within(opponentDialog).getByRole('button', { name: '同意' }))

    await waitFor(() => expect(screen.getByText('0 步')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '红方兵 7行1列' })).toBeInTheDocument()
    expect(screen.getByText('本局礼让次数已使用')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0), { timeout: 4_000 })
    expect(HumanModeWorker.searchMessages[0]).toMatchObject({
      moves: [],
      multiPv: 4,
      maxDepth: 6,
    })
    expect(HumanModeWorker.searchMessages[0].movetimeMs).toBeGreaterThanOrEqual(1_500)
    expect(HumanModeWorker.searchMessages[0].movetimeMs).toBeLessThanOrEqual(3_000)
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
    fireEvent.click(screen.getByText('入门').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))
    await screen.findByText('真人玩家 · 红方')
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0), { timeout: 4_000 })

    fireEvent.click(screen.getByRole('button', { name: '红方兵 7行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '6行1列空位' }))

    await waitFor(() => expect(HumanModeWorker.searchMessages).toHaveLength(1))
    expect(HumanModeWorker.searchMessages[0].moves).toEqual(['a3a4'])
    await waitFor(() => expect(screen.getByRole('button', { name: '红方兵 6行1列' })).toBeInTheDocument(), { timeout: 4_000 })
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0), { timeout: 4_000 })
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
    fireEvent.click(screen.getByText('入门').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))

    await waitFor(() => expect(MockWorker.initializedEngineIds.length).toBeGreaterThanOrEqual(3))
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0), { timeout: 4_000 })
    expect(MockWorker.initializedEngineIds.slice(-2)).toEqual([
      'fairy-stockfish-nnue',
      'fairy-stockfish-nnue',
    ])
    expect(screen.queryByText('AI Worker 恢复失败。')).not.toBeInTheDocument()
    view.unmount()
  })

  it('真人可在 AI 搜索期间认输并立即判 AI 获胜', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '真人 vs AI' }))
    fireEvent.click(screen.getByText('入门').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))
    await screen.findByText('真人玩家 · 红方')
    fireEvent.click(screen.getByRole('button', { name: '红方兵 7行1列' }))
    fireEvent.click(screen.getByRole('button', { name: '6行1列空位' }))
    await waitFor(() => expect(screen.getAllByText('AI 正在计算…').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '认输' }))
    const confirmation = screen.getByRole('dialog', { name: '确认认输？' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('heading', { name: '黑方获胜' })).toBeInTheDocument()
    expect(screen.getByText(/因“认输”结束/)).toBeInTheDocument()
    view.unmount()
  })

  it('Pikafish 人机 Worker 异常后重建同一引擎并恢复到真人回合', async () => {
    vi.stubGlobal('Worker', HumanModeWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    HumanModeWorker.failNextSearch = true
    const view = render(<App />)

    await screen.findByRole('button', { name: '真人 vs AI' })
    fireEvent.click(screen.getByRole('button', { name: '真人 vs AI' }))
    fireEvent.change(screen.getByLabelText('Engine Registry'), { target: { value: 'pikafish-2026-nnue' } })
    fireEvent.click(screen.getByLabelText('黑方 · 后手'))
    fireEvent.click(screen.getByText('入门').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: '开始人机对战' }))

    await waitFor(() => expect(HumanModeWorker.initConfigs.filter((config) => config.id === 'pikafish-2026-nnue')).toHaveLength(2))
    await waitFor(() => expect(screen.getAllByText('等待你行棋').length).toBeGreaterThan(0), { timeout: 4_000 })
    expect(HumanModeWorker.initConfigs.slice(-2).map((config) => config.id)).toEqual([
      'pikafish-2026-nnue',
      'pikafish-2026-nnue',
    ])
    expect(screen.getByText('真人玩家 · 黑方')).toBeInTheDocument()
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

  it('Pikafish 引擎大战 Worker 异常后只重建故障席位并继续走子', async () => {
    vi.stubGlobal('Worker', BattleRecoveryWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /AI 引擎对战/ }))
    fireEvent.change(screen.getByLabelText('红方 AI'), { target: { value: 'pikafish-2026-nnue' } })
    fireEvent.change(screen.getByLabelText('黑方 AI'), { target: { value: 'fairy-stockfish-nnue' } })
    fireEvent.click(screen.getByRole('button', { name: '开始引擎对战' }))

    await waitFor(() => expect(screen.getByText('5 步')).toBeInTheDocument(), { timeout: 4_000 })
    expect(MockWorker.initializedEngineIds.filter((id) => id === 'pikafish-2026-nnue')).toHaveLength(2)
    expect(MockWorker.initializedEngineIds.filter((id) => id === 'fairy-stockfish-nnue')).toHaveLength(2)
    expect(screen.queryByText('引擎恢复失败。')).not.toBeInTheDocument()
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

  it('竞猜选择期间暂停遮罩不阻挡棋盘输入', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<StrictMode><App /></StrictMode>)
    fireEvent.click(screen.getByRole('checkbox', { name: /猜下一手/ }))
    fireEvent.click(await screen.findByRole('button', { name: '开始对弈' }))
    await screen.findByRole('button', { name: '红方马 10行2列' })
    expect(screen.queryByText('棋钟与双方思考均已停止')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '红方马 10行2列' }))
    fireEvent.click(screen.getByRole('button', { name: '8行3列空位' }))
    expect(screen.getByRole('button', { name: '提交猜招' })).toBeEnabled()
    expect(screen.getByText('0 步')).toBeInTheDocument()
    view.unmount()
  })

  it('观战从初始局面接管，双击只进入一次，返回后原局仍暂停', async () => {
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('crossOriginIsolated', true)
    const view = render(<StrictMode><App /></StrictMode>)
    fireEvent.click(await screen.findByRole('button', { name: '开始对弈' }))
    const button = await screen.findByRole('button', { name: '从当前局面练习' })
    fireEvent.click(button); fireEvent.click(button)
    await screen.findByRole('heading', { name: '局面练习' })
    expect(screen.getByText(/原棋谱 · 已走 0/)).toBeInTheDocument()
    expect(screen.getByLabelText('练习执子')).toHaveValue('red')
    fireEvent.click(screen.getByRole('button', { name: '返回来源' }))
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled()
    expect(screen.getByText('0 步')).toBeInTheDocument()
    expect(screen.getByLabelText('红方剩余时间')).toHaveTextContent('20:00')
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
