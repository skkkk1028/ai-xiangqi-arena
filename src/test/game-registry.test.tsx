import { describe, expect, it } from 'vitest'
import {
  GameRegistry,
  getGame,
  listGames,
  type RegisteredGame,
} from '../games/GameRegistry'
import '../games/registry'

function game(id: string, route: string): RegisteredGame {
  return {
    id,
    route,
    Page: () => null,
    lobby: {
      theme: id,
      code: id.toUpperCase(),
      title: id,
      status: '已开放',
      availability: 'ready',
      description: `${id} 测试模块`,
      highlights: [],
      actionLabel: '进入',
      Visual: () => null,
    },
  }
}

describe('GameRegistry', () => {
  it('已注册象棋和围棋，并保留原有入口路由', () => {
    expect(listGames().map((registered) => registered.id)).toEqual(['xiangqi', 'go'])
    expect(getGame('xiangqi')?.route).toBe('#/games/xiangqi')
    expect(getGame('go')?.route).toBe('#/games/go')
    expect(getGame('go')?.lobby.availability).toBe('ready')
  })

  it('支持注册、查询与按注册顺序列出独立棋类', () => {
    const registry = new GameRegistry()
    const chess = game('chess', '#/games/chess')
    const shogi = game('shogi', '#/games/shogi')

    registry.registerGame(chess)
    registry.registerGame(shogi)

    expect(registry.getGame('chess')).toMatchObject({ id: 'chess', route: '#/games/chess' })
    expect(registry.getGameByRoute('#/games/shogi')).toMatchObject({ id: 'shogi' })
    expect(registry.listGames().map((registered) => registered.id)).toEqual(['chess', 'shogi'])
  })

  it('拒绝重复 ID、重复路由和无效游戏路由', () => {
    const registry = new GameRegistry()
    registry.registerGame(game('chess', '#/games/chess'))

    expect(() => registry.registerGame(game('chess', '#/games/chess-960'))).toThrow('棋类 ID 已注册')
    expect(() => registry.registerGame(game('chess-960', '#/games/chess'))).toThrow('棋类路由已注册')
    expect(() => registry.registerGame(game('invalid', '#/invalid'))).toThrow('路由必须以 #/games/ 开头')
  })
})
