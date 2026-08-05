import App from '../../App'
import { GAME_ROUTES } from '../routes'

export function XiangqiGamePage() {
  return (
    <div className="xiangqi-game-shell">
      <a className="game-lobby-return" href={GAME_ROUTES.lobby} aria-label="返回 AI 棋类大厅">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 12H6m5-6-6 6 6 6" />
        </svg>
        <span>棋类大厅</span>
      </a>
      <App />
    </div>
  )
}
