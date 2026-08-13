import { describe, expect, it, vi } from 'vitest'
import type { AIEngine } from '../games/core'
import { GameController } from '../games/core/GameController'
import { ChessGameEngine } from '../games/chess/rules'
import type { ChessColor, ChessGameState, ChessMoveAction, ChessMoveRecord } from '../games/chess/types'

type TestEngine = AIEngine<ChessGameState, ChessMoveAction, ChessColor, ChessMoveRecord>

function createEngine(id: string): TestEngine {
  return {
    id,
    name: id,
    initialize: vi.fn(async () => undefined),
    newGame: vi.fn(),
    think: vi.fn(async (request) => ({ action: request.legalActions[0] })),
    stop: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('国际象棋故障席位恢复', () => {
  it('只替换故障 AI，保留局面与另一个席位', async () => {
    const oldWhite = createEngine('white-old')
    const black = createEngine('black-healthy')
    const replacement = createEngine('white-new')
    const controller = new GameController(new ChessGameEngine(), [
      { id: 'w', name: '曜刃', kind: 'ai', engine: oldWhite },
      { id: 'b', name: '玄垒', kind: 'ai', engine: black },
    ])
    await controller.start()
    await controller.playAITurn()
    const before = controller.getSnapshot()

    await controller.replaceAIPlayer({ id: 'w', name: '曜刃', kind: 'ai', engine: replacement })

    expect(controller.getSnapshot().state).toBe(before.state)
    const recoveredWhite = controller.getPlayers().find((player) => player.id === 'w')
    expect(recoveredWhite?.kind).toBe('ai')
    expect(recoveredWhite?.kind === 'ai' ? recoveredWhite.engine : null).toBe(replacement)
    expect(oldWhite.stop).toHaveBeenCalled()
    expect(oldWhite.dispose).toHaveBeenCalledOnce()
    expect(black.dispose).not.toHaveBeenCalled()
    expect(replacement.initialize).toHaveBeenCalledWith({ gameId: 'chess', player: 'w' })
    expect(replacement.newGame).toHaveBeenCalledOnce()

    await controller.playAITurn()
    expect(controller.getSnapshot().state.history).toHaveLength(2)
  })
})
