import type { RegisteredGame } from '../GameRegistry'
import { GoGamePage } from './GoGamePage'

function GoLobbyVisual() {
  return (
    <div className="game-entry__visual game-entry__visual--go" aria-hidden="true">
      <div className="lobby-go-board">
        <b className="go-stone go-stone--black go-stone--one" />
        <b className="go-stone go-stone--white go-stone--two" />
        <b className="go-stone go-stone--black go-stone--three" />
        <b className="go-stone go-stone--white go-stone--four" />
      </div>
      <span className="go-coordinate">19 × 19</span>
    </div>
  )
}

export const goGameRegistration: RegisteredGame = {
  id: 'go',
  route: '#/games/go',
  Page: GoGamePage,
  lobby: {
    theme: 'go',
    code: 'GO · WEIQI',
    title: '围棋',
    status: '本地对局开放',
    availability: 'ready',
    description: '进入十九路高级棋院，在浏览器中体验中国规则本地双人对局。',
    highlights: ['19 路棋盘', '中国规则', 'AI 接口预留'],
    actionLabel: '进入围棋棋院',
    Visual: GoLobbyVisual,
  },
}
