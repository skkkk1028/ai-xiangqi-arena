import { useEffect, useState } from 'react'
import { GAME_ROUTES } from '../routes'
import { ChessArenaPage } from './ChessArenaPage'
import { ChessGamePage } from './ChessGamePage'
import { ChessHumanPage } from './ChessHumanPage'
import { ChessLocalPage } from './ChessLocalPage'
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
  if (route === GAME_ROUTES.chessHuman) return <ChessHumanPage />
  if (route === GAME_ROUTES.chessLocal) return <ChessLocalPage />
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
          <p>选择双人格观战、独立引擎交锋、人机挑战，或者与身边的对手同屏对弈。</p>
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
        <a className="chess-mode-card chess-mode-card--human" href={GAME_ROUTES.chessHuman}>
          <span className="chess-mode-card__icon" aria-hidden="true">♙</span>
          <small>HUMAN VS ENGINE</small>
          <h2>人机对战</h2>
          <p>选择白方或黑方，使用 Stockfish 18、Fairy‑Stockfish 或 Obsidian 16 作为对手，并自定义思考强度。</p>
          <strong>开始人机对战 →</strong>
        </a>
        <a className="chess-mode-card chess-mode-card--local" href={GAME_ROUTES.chessLocal}>
          <span className="chess-mode-card__icon" aria-hidden="true">♜</span>
          <small>LOCAL HUMAN MATCH</small>
          <h2>双人对战</h2>
          <p>两位玩家在同一设备轮流执子，使用双方总时与单步上限组成的三档公平计时。</p>
          <strong>开始双人对战 →</strong>
        </a>
      </section>
      <p className="chess-mode-footnote">Obsidian 16 当前为同级候选；只有项目内配对实测通过 ±50 Elo 等效门槛后才会标记为已认证。</p>
    </main>
  )
}
