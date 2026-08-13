export const GAME_ROUTES = {
  lobby: '#/',
  xiangqi: '#/games/xiangqi',
  go: '#/games/go',
  chess: '#/games/chess',
  chessTheatre: '#/games/chess/theatre',
  chessArena: '#/games/chess/arena',
} as const

export type GameRoute = keyof typeof GAME_ROUTES

export function readGameRoute(hash = window.location.hash): GameRoute {
  if (hash === GAME_ROUTES.xiangqi) return 'xiangqi'
  if (hash === GAME_ROUTES.go) return 'go'
  if (hash === GAME_ROUTES.chess) return 'chess'
  if (hash === GAME_ROUTES.chessTheatre) return 'chessTheatre'
  if (hash === GAME_ROUTES.chessArena) return 'chessArena'
  return 'lobby'
}
