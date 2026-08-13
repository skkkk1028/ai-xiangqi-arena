import { useEffect, useState } from 'react'
import { GAME_ROUTES } from '../routes'
import { ChessArenaPage } from './ChessArenaPage'
import { ChessGamePage } from './ChessGamePage'
import './chess.css'

export function ChessModulePage() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const update = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  if (route === GAME_ROUTES.chessTheatre) return <ChessGamePage />
  if (route === GAME_ROUTES.chessArena) return <ChessArenaPage />
  return <ChessModePage />
}

function ChessModePage() {
  return (
    <main className="chess-mode-page">
      <header className="chess-mode-header">
        <a className="chess-back" href={GAME_ROUTES.lobby}>← <span>棋类大厅</span></a>
        <div>
          <span className="chess-kicker">CHESS · STANDARD</span>
          <h1>国际象棋演算厅</h1>
          <p>选择人格化观战，或让不同的独立 UCI 引擎在相同资源条件下交锋。</p>
        </div>
      </header>
      <section className="chess-mode-grid" aria-label="国际象棋模式">
        <a className="chess-mode-card" href={GAME_ROUTES.chessTheatre}>
          <span className="chess-mode-card__icon" aria-hidden="true">♞</span>
          <small>PERSONALITY THEATRE</small>
          <h2>双人格观战剧场</h2>
          <p>保留曜刃与玄垒的风格化候选选择，以及现有 Stockfish 18 专业观战档位。</p>
          <strong>进入观战剧场 →</strong>
        </a>
        <a className="chess-mode-card chess-mode-card--arena" href={GAME_ROUTES.chessArena}>
          <span className="chess-mode-card__icon" aria-hidden="true">♛</span>
          <small>MULTI-ENGINE ARENA</small>
          <h2>多引擎对战竞技场</h2>
          <p>白黑双方独立选择 Stockfish 18、Fairy-Stockfish 或 Obsidian 16，同资源、PV1 公平对战。</p>
          <strong>配置引擎对战 →</strong>
        </a>
      </section>
      <p className="chess-mode-footnote">Obsidian 16 当前为同级候选；只有项目内配对实测通过 ±50 Elo 等效门槛后才会标记为已认证。</p>
    </main>
  )
}
