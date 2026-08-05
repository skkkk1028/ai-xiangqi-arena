import { listGames, type RegisteredGame } from './GameRegistry'
import './registry'

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

function GameEntry({ game, index }: { game: RegisteredGame; index: number }) {
  const Visual = game.lobby.Visual
  const number = String(index + 1).padStart(2, '0')
  return (
    <a className={`game-entry game-entry--${game.lobby.theme}`} href={game.route}>
      <div className="game-entry__halo" aria-hidden="true" />
      <div className="game-entry__topline">
        <span className="game-entry__number">GAME {number}</span>
        <span className={`game-entry__status${game.lobby.availability === 'coming-soon' ? ' game-entry__status--soon' : ''}`}>
          {game.lobby.availability === 'ready' && <i />}
          {game.lobby.status}
        </span>
      </div>
      <Visual />
      <div className="game-entry__body">
        <p>{game.lobby.code}</p>
        <h2>{game.lobby.title}</h2>
        <span>{game.lobby.description}</span>
        <ul>{game.lobby.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
      </div>
      <div className="game-entry__action">
        <span>{game.lobby.actionLabel}</span>
        <ArrowIcon />
      </div>
    </a>
  )
}

export function GameLobby() {
  const games = listGames()
  return (
    <main className="game-lobby">
      <div className="lobby-ambient lobby-ambient--red" aria-hidden="true" />
      <div className="lobby-ambient lobby-ambient--jade" aria-hidden="true" />
      <div className="lobby-scanlines" aria-hidden="true" />

      <header className="lobby-header">
        <a className="lobby-brand" href="#/" aria-label="AI 棋类大厅首页">
          <span className="lobby-brand__seal">弈</span>
          <span>
            <strong>弈界</strong>
            <small>AI BOARD GAMES</small>
          </span>
        </a>
        <div className="lobby-runtime">
          <i />
          <span>LOCAL AI</span>
          <b>浏览器本地计算</b>
        </div>
      </header>

      <section className="lobby-hero" aria-labelledby="lobby-title">
        <div className="lobby-intro">
          <p className="lobby-eyebrow"><span /> AI 棋类大厅 · BOARD GAME ARENA</p>
          <h1 id="lobby-title">
            一方棋盘
            <em>两种智慧</em>
          </h1>
          <p className="lobby-lead">
            从楚河汉界到十九路纵横，让经典棋局与浏览器 AI 在同一个大厅相遇。
            选择你的棋盘，下一手由你决定。
          </p>
          <div className="lobby-stats" aria-label="大厅能力">
            <span><strong>03</strong>专业引擎配置</span>
            <span><strong>WASM</strong>本地运行</span>
            <span><strong>{String(games.length).padStart(2, '0')}</strong>独立棋类模块</span>
          </div>
        </div>

        <div className="lobby-games" aria-label="选择棋类">
          {games.map((game, index) => <GameEntry key={game.id} game={game} index={index} />)}
        </div>
      </section>

      <footer className="lobby-footer">
        <span>AI BOARD GAME LAB · 2026</span>
        <i />
        <span>棋局计算留在你的设备</span>
      </footer>
    </main>
  )
}
