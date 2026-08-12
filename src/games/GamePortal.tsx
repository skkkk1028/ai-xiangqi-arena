import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
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
    return <LazyGamePage game={game} />
  }
  return <GameLobby />
}

function LazyGamePage({ game }: { game: NonNullable<ReturnType<typeof getGameByRoute>> }) {
  const Page = useMemo(() => lazy(game.loadPage), [game])
  return (
    <Suspense fallback={<GameLoading title={game.lobby.title} />}>
      <Page />
    </Suspense>
  )
}

function GameLoading({ title }: { title: string }) {
  return (
    <main className="game-module-loading" aria-live="polite" aria-busy="true">
      <span className="game-module-loading__seal">弈</span>
      <strong>正在进入{title}</strong>
      <small>仅加载本棋类所需的规则与引擎模块</small>
    </main>
  )
}
