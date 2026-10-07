import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserKataGoTransport } from '../games/go/ai/BrowserKataGoTransport'
import { KATAGO_CHINESE_PSK_RULES, type KataGoAnalyzeRequest } from '../games/go/ai/types'

const client = vi.hoisted(() => ({
  init: vi.fn(async () => undefined), getEngineInfo: vi.fn(() => ({ backend: 'wasm', modelName: 'test' })),
  cancelAnalysis: vi.fn(), analyze: vi.fn(async (_input: unknown) => ({ rootWinRate: 0.5, rootScoreLead: 0, rootVisits: 256,
    moves: [{ x: 4, y: 4, visits: 256, prior: 0.5, winRate: 0.5, scoreLead: 0, pv: ['E15'] }] })),
}))
vi.mock('../vendor/web-katago/engine/katago/client', () => ({ getKataGoEngineClient: () => client, resetKataGoEngineClientForTests: vi.fn() }))
afterEach(() => vi.clearAllMocks())
const request = (moves: KataGoAnalyzeRequest['moves']): KataGoAnalyzeRequest => ({ requestId: 'replay', gameId: 'go',
  player: moves.length % 2 ? 'white' : 'black', profile: 'winrate', boardSize: 19, komi: 7.5, rules: KATAGO_CHINESE_PSK_RULES, moves })

describe('浏览器 KataGo 续弈重放', () => {
  it('重放双虚着后的落子，传递完整历史而非只重建棋盘', async () => {
    const transport = new BrowserKataGoTransport()
    await transport.analyze(request([['B', 'D16'], ['W', 'pass'], ['B', 'pass'], ['W', 'Q4']]))
    const input = client.analyze.mock.calls[0][0] as { board: (string | null)[][]; moveHistory: unknown[]; positionKey: string }
    expect(input.board[3][3]).toBe('black'); expect(input.board[15][15]).toBe('white')
    expect(input.moveHistory).toHaveLength(4); expect(input.positionKey).toContain('W:PASS|B:PASS')
    transport.dispose()
  })
  it('双虚着后尚未落子可以分析；不同虚着历史不能共享树键', async () => {
    const transport = new BrowserKataGoTransport()
    await transport.analyze(request([]))
    await transport.analyze(request([['B', 'pass'], ['W', 'pass']]))
    const inputs = client.analyze.mock.calls.map(([input]) => input as { board: unknown; positionKey: string })
    expect(inputs[0].board).toEqual(inputs[1].board)
    expect(inputs[0].positionKey).not.toEqual(inputs[1].positionKey)
    transport.dispose()
  })
})
