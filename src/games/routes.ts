export const GAME_ROUTES = {
  lobby: '#/',
  xiangqi: '#/games/xiangqi',
  go: '#/games/go',
} as const

export type GameRoute = keyof typeof GAME_ROUTES

export function readGameRoute(hash = window.location.hash): GameRoute {
  if (hash === GAME_ROUTES.xiangqi) return 'xiangqi'
  if (hash === GAME_ROUTES.go) return 'go'
  return 'lobby'
}
