import type { RegisteredGame } from '../GameRegistry'

function ChessLobbyVisual() {
  return (
    <div className="game-entry__visual game-entry__visual--chess" aria-hidden="true">
      <div className="lobby-chess-board">
        <span className="lobby-chess-piece lobby-chess-piece--king">♔</span>
        <span className="lobby-chess-piece lobby-chess-piece--queen">♛</span>
        <span className="lobby-chess-piece lobby-chess-piece--rook">♜</span>
        <span className="lobby-chess-piece lobby-chess-piece--pawn">♙</span>
      </div>
      <span className="chess-coordinate">STOCKFISH 18 · UCI · NNUE</span>
    </div>
  )
}

export const chessGameRegistration: RegisteredGame = {
  id: 'chess',
  route: '#/games/chess',
  loadPage: () => import('./ChessGamePage').then(({ ChessGamePage }) => ({ default: ChessGamePage })),
  lobby: {
    theme: 'chess',
    code: 'CHESS · STANDARD',
    title: '国际象棋',
    status: 'AI 观战开放',
    availability: 'ready',
    description: 'Stockfish 18 专业 PV1 与 Fairy‑Stockfish 个性观赏双模式，采用标准 FIDE 规则。',
    highlights: ['Stockfish 18 · 专业 PV1', '个性模式 · 优先变招', 'PGN / JSON 棋谱恢复'],
    actionLabel: '进入国际象棋剧场',
    Visual: ChessLobbyVisual,
  },
}
