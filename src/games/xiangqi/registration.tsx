import type { RegisteredGame } from '../GameRegistry'
import { XiangqiGamePage } from './XiangqiGamePage'

function XiangqiLobbyVisual() {
  return (
    <div className="game-entry__visual game-entry__visual--xiangqi" aria-hidden="true">
      <div className="lobby-xiangqi-board">
        <span className="lobby-river">楚河&nbsp;&nbsp;&nbsp;&nbsp;汉界</span>
        <b className="lobby-piece lobby-piece--general">将</b>
        <b className="lobby-piece lobby-piece--marshal">帅</b>
        <b className="lobby-piece lobby-piece--cannon">炮</b>
      </div>
      <svg className="lobby-circuit-mark" viewBox="0 0 54 54" aria-hidden="true">
        <path d="M6 27h9l5-9h14l5 9h9M20 18V9m14 9V9M20 36v9m14-9v9M6 27v-8m42 8v8" />
        <circle cx="20" cy="18" r="2.5" />
        <circle cx="34" cy="18" r="2.5" />
        <circle cx="20" cy="36" r="2.5" />
        <circle cx="34" cy="36" r="2.5" />
      </svg>
    </div>
  )
}

export const xiangqiGameRegistration: RegisteredGame = {
  id: 'xiangqi',
  route: '#/games/xiangqi',
  Page: XiangqiGamePage,
  lobby: {
    theme: 'xiangqi',
    code: 'XIANGQI',
    title: '中国象棋',
    status: '已开放',
    availability: 'ready',
    description: '专业 NNUE 引擎驱动的观战、引擎竞技与真人挑战。',
    highlights: ['Fairy-Stockfish', 'Pikafish', '人机对战'],
    actionLabel: '进入楚河汉界',
    Visual: XiangqiLobbyVisual,
  },
}
