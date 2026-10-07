export const GAME_ROUTES = {
  lobby: '#/',
  xiangqi: '#/games/xiangqi',
  go: '#/games/go',
  chess: '#/games/chess',
  chessTheatre: '#/games/chess/theatre',
  chessArena: '#/games/chess/arena',
  chessHuman: '#/games/chess/human',
  chessLocal: '#/games/chess/local',
  chessLibrary: '#/games/chess/library',
  chessStudy: '#/games/chess/study',
} as const

export type GameRoute = keyof typeof GAME_ROUTES

export function readGameRoute(hash = window.location.hash): GameRoute {
  if (hash === GAME_ROUTES.xiangqi) return 'xiangqi'
  if (hash === GAME_ROUTES.go) return 'go'
  if (hash === GAME_ROUTES.chess) return 'chess'
  if (hash === GAME_ROUTES.chessTheatre) return 'chessTheatre'
  if (hash === GAME_ROUTES.chessArena) return 'chessArena'
  if (hash === GAME_ROUTES.chessHuman) return 'chessHuman'
  if (hash === GAME_ROUTES.chessLocal) return 'chessLocal'
  if (hash === GAME_ROUTES.chessLibrary) return 'chessLibrary'
  if (hash === GAME_ROUTES.chessStudy || hash.startsWith(`${GAME_ROUTES.chessStudy}/`)) return 'chessStudy'
  return 'lobby'
}
