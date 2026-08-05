import { useEffect, useState } from 'react'
import { GameLobby } from './GameLobby'
import { getGameByRoute } from './GameRegistry'
import './registry'
import './games.css'

export function GamePortal() {
  const [gameId, setGameId] = useState(() => getGameByRoute(window.location.hash)?.id ?? null)

  useEffect(() => {
    const handleRouteChange = () => setGameId(getGameByRoute(window.location.hash)?.id ?? null)
    window.addEventListener('hashchange', handleRouteChange)
    return () => window.removeEventListener('hashchange', handleRouteChange)
  }, [])

  const game = gameId ? getGameByRoute(window.location.hash) : undefined
  if (game) {
    const Page = game.Page
    return <Page />
  }
  return <GameLobby />
}
