import { describe, expect, it, vi } from 'vitest'
import type { EngineAdapter } from '../engine/adapter'
import type { AIEngineConfig } from '../engine/types'
import type { EngineProfile, EngineSearchResponse, Move } from '../game/types'
import { positionKey } from '../game/board'
import { GameController, type AIEngine } from '../games/core'
import {
  XiangqiAIEngineAdapter,
  XiangqiGameEngine,
  type XiangqiGameState,
  type XiangqiRecordEntry,
} from '../games/xiangqi'
import {
  createLegacyXiangqiTransitionState,
  executeLegacyXiangqiTransition,
} from '../games/xiangqi/legacy-transition'

function findAction(actions: readonly Move[], from: [number, number], to: [number, number]): Move {
  const action = actions.find(
    (move) =>
      move.from.row === from[0] &&
      move.from.col === from[1] &&
      move.to.row === to[0] &&
      move.to.col === to[1],
  )
  if (!action) throw new Error('测试着法不存在。')
  return action
}

class FirstLegalMoveAI
  implements AIEngine<XiangqiGameState, Move, 'red' | 'black', XiangqiRecordEntry>
{
  readonly id: string
  readonly name: string
  readonly initialized = vi.fn(async () => undefined)
  readonly newGame = vi.fn()
  readonly stop = vi.fn()
  readonly dispose = vi.fn()

  constructor(id: string) {
    this.id = id
    this.name = id
  }

  initialize = this.initialized

  async think(request: { legalActions: readonly Move[] }) {
    const action = request.legalActions[0]
    if (!action) throw new Error('没有合法着法。')
    return { action }
  }
}

describe('通用棋类平台契约', () => {
  it('XiangqiGameEngine 复用现有规则并生成不可变棋谱', async () => {
    const game = new XiangqiGameEngine()
    const controller = new GameController(game, [
      { id: 'red', name: '红方玩家', kind: 'human' },
      { id: 'black', name: '黑方玩家', kind: 'human' },
    ])
    const initial = await controller.start()
    const action = findAction(controller.getLegalActions(), [6, 0], [5, 0])
    const next = controller.play(action)

    expect(initial.state.turn).toBe('red')
    expect(initial.state.board[6][0]?.type).toBe('soldier')
    expect(next.state.turn).toBe('black')
    expect(next.state.board[6][0]).toBeNull()
    expect(next.state.board[5][0]?.type).toBe('soldier')
    expect(game.getRecord(next.state)).toMatchObject([
      { ucci: 'a3a4', notation: '兵九进一', ply: 1 },
    ])
    expect(() => controller.play(action)).toThrow('当前回合不能执行该动作。')
  })

  it('GameController 可以连续编排两个通用 AI 玩家', async () => {
    const redAI = new FirstLegalMoveAI('red-ai')
    const blackAI = new FirstLegalMoveAI('black-ai')
    const controller = new GameController(new XiangqiGameEngine(), [
      { id: 'red', name: '红方 AI', kind: 'ai', engine: redAI },
      { id: 'black', name: '黑方 AI', kind: 'ai', engine: blackAI },
    ])
    await controller.start()
    const result = await controller.runAIBattle({ maxTurns: 4 })

    expect(result.turnsPlayed).toBe(4)
    expect(result.stoppedBecause).toBe('turn-limit')
    expect(result.snapshot.state.history).toHaveLength(4)
    expect(redAI.initialized).toHaveBeenCalledWith({ gameId: 'xiangqi', player: 'red' })
    expect(blackAI.initialized).toHaveBeenCalledWith({ gameId: 'xiangqi', player: 'black' })
  })

  it('同一 AI 实例用于红黑双方时只发送一次生命周期命令', async () => {
    const sharedAI = new FirstLegalMoveAI('shared-ai')
    const controller = new GameController(new XiangqiGameEngine(), [
      { id: 'red', name: '红方 AI', kind: 'ai', engine: sharedAI },
      { id: 'black', name: '黑方 AI', kind: 'ai', engine: sharedAI },
    ])

    await controller.start()
    expect(sharedAI.initialized).toHaveBeenCalledTimes(2)
    expect(sharedAI.newGame).toHaveBeenCalledTimes(1)

    await controller.cancelPendingTurn('暂停')
    expect(sharedAI.stop).toHaveBeenCalledTimes(1)

    await controller.dispose()
    expect(sharedAI.stop).toHaveBeenCalledTimes(2)
    expect(sharedAI.dispose).toHaveBeenCalledTimes(1)
  })

  it('XiangqiGameEngine 与迁移前落子兼容层保持规则和棋谱一致', () => {
    const game = new XiangqiGameEngine()
    let current = game.initializeGame()
    let legacy = createLegacyXiangqiTransitionState()
    const line = ['a3a4', 'a6a5', 'b0c2', 'b9c7']

    for (const ucci of line) {
      const action = game.findLegalActionByUcci(current, ucci)
      expect(action, `兼容测试着法 ${ucci} 应合法`).not.toBeNull()
      current = game.executeAction(current, action!)
      legacy = executeLegacyXiangqiTransition(legacy, action!)

      expect(positionKey(current.board, current.turn)).toBe(positionKey(legacy.board, legacy.turn))
      expect(current.turn).toBe(legacy.turn)
      expect(current.checkColor).toBe(legacy.checkColor)
      expect(current.result).toEqual(legacy.result)
      expect(current.noCapturePlies).toBe(legacy.noCapturePlies)
      expect(current.history).toEqual(legacy.history)
      expect(current.repetitions).toEqual(legacy.repetitions)
    }
  })

  it('XiangqiAIEngineAdapter 将通用思考请求映射到现有 EngineAdapter', async () => {
    const game = new XiangqiGameEngine()
    const response: EngineSearchResponse = {
      bestmove: 'a3a4',
      info: {
        depth: 8,
        nodes: 100,
        nps: 1_000,
        elapsedMs: 100,
        score: { kind: 'cp', value: 12 },
        wdl: null,
        pv: ['a3a4'],
      },
      candidates: [],
    }
    const profile: EngineProfile = {
      name: 'Mock UCCI',
      version: 'test',
      threads: 1,
      hashMb: 16,
    }
    const search = vi.fn(async () => response)
    const adapter: EngineAdapter = {
      config: { id: 'mock-ucci', name: 'Mock UCCI' } as AIEngineConfig,
      init: vi.fn(async () => profile),
      sendCommand: vi.fn(),
      setPosition: vi.fn(),
      search,
      stop: vi.fn(),
      newGame: vi.fn(),
      dispose: vi.fn(),
    }
    const ai = new XiangqiAIEngineAdapter(adapter, {
      movetimeMs: 1_500,
      search: { multiPv: 2, maxDepth: 10 },
    })
    const controller = new GameController(game, [
      { id: 'red', name: '红方 AI', kind: 'ai', engine: ai },
      { id: 'black', name: '黑方玩家', kind: 'human' },
    ])
    await controller.start()
    const turn = await controller.playAITurn()

    expect(search).toHaveBeenCalledWith([], 1_500, { multiPv: 2, maxDepth: 10 })
    expect(turn.snapshot.state.history[0].ucci).toBe('a3a4')
    expect(turn.decision.analysis).toBe(response)
    expect(ai.engineProfile).toBe(profile)
  })
})
