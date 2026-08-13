import type { ComponentType } from 'react'

export type GameAvailability = 'ready' | 'coming-soon'

export interface GameLobbyDefinition {
  theme: string
  code: string
  title: string
  status: string
  availability: GameAvailability
  description: string
  highlights: readonly string[]
  actionLabel: string
  Visual: ComponentType
}

export interface RegisteredGame {
  id: string
  route: string
  /** Additional routes owned by the same lazily loaded game module. */
  childRoutes?: readonly string[]
  /** Lazily loads the complete game module. Lobby metadata stays lightweight. */
  loadPage: () => Promise<{ default: ComponentType }>
  lobby: GameLobbyDefinition
}

/**
 * Registry for independently developed board-game modules.
 *
 * The registry owns navigation metadata only. Rules, engines and page
 * lifecycles remain inside each game module.
 */
export class GameRegistry {
  private readonly games = new Map<string, RegisteredGame>()

  registerGame(game: RegisteredGame): void {
    if (!game.id.trim()) throw new Error('棋类注册必须提供非空 ID。')
    if (!game.route.startsWith('#/games/')) {
      throw new Error(`棋类 ${game.id} 的路由必须以 #/games/ 开头。`)
    }
    if (this.games.has(game.id)) throw new Error(`棋类 ID 已注册：${game.id}`)
    if ([...this.games.values()].some((registered) => registered.route === game.route)) {
      throw new Error(`棋类路由已注册：${game.route}`)
    }
    const routes = [game.route, ...(game.childRoutes ?? [])]
    if (new Set(routes).size !== routes.length || routes.some((route) => !route.startsWith(`${game.route}/` ) && route !== game.route)) {
      throw new Error(`棋类 ${game.id} 的子路由必须位于 ${game.route}/ 下且不能重复。`)
    }
    const occupied = new Set([...this.games.values()].flatMap((registered) => [registered.route, ...(registered.childRoutes ?? [])]))
    const duplicate = routes.find((route) => occupied.has(route))
    if (duplicate) throw new Error(`棋类路由已注册：${duplicate}`)
    this.games.set(game.id, Object.freeze({
      ...game,
      childRoutes: game.childRoutes ? Object.freeze([...game.childRoutes]) : undefined,
      lobby: Object.freeze({ ...game.lobby }),
    }))
  }

  getGame(id: string): RegisteredGame | undefined {
    return this.games.get(id)
  }

  getGameByRoute(route: string): RegisteredGame | undefined {
    return [...this.games.values()].find((game) => game.route === route || game.childRoutes?.includes(route))
  }

  listGames(): readonly RegisteredGame[] {
    return [...this.games.values()]
  }
}

export const gameRegistry = new GameRegistry()

export const registerGame = gameRegistry.registerGame.bind(gameRegistry)
export const getGame = gameRegistry.getGame.bind(gameRegistry)
export const listGames = gameRegistry.listGames.bind(gameRegistry)
export const getGameByRoute = gameRegistry.getGameByRoute.bind(gameRegistry)
