import { pieceLabel } from '../game/notation'
import type { BoardState, Color, Move } from '../game/types'

interface ChessBoardProps {
  board: BoardState
  turn: Color
  lastMove: Move | null
  checkColor: Color | null
  paused: boolean
}

const points = Array.from({ length: 10 }, (_, row) =>
  Array.from({ length: 9 }, (_, col) => ({ row, col })),
).flat()

export function ChessBoard({ board, turn, lastMove, checkColor, paused }: ChessBoardProps) {
  return (
    <div
      className={`chess-board-shell ${paused ? 'is-paused' : ''}`}
      aria-label="中国象棋棋盘"
    >
      <div className="board-corner board-corner--tl" />
      <div className="board-corner board-corner--tr" />
      <div className="board-corner board-corner--bl" />
      <div className="board-corner board-corner--br" />
      <div className="chess-board">
        <svg className="board-lines" viewBox="0 0 900 1000" role="img" aria-label="楚河汉界">
          <g className="grid-lines">
            {Array.from({ length: 10 }, (_, index) => (
              <line key={`h-${index}`} x1="50" y1={50 + index * 100} x2="850" y2={50 + index * 100} />
            ))}
            <line x1="50" y1="50" x2="50" y2="950" />
            <line x1="850" y1="50" x2="850" y2="950" />
            {Array.from({ length: 7 }, (_, index) => {
              const x = 150 + index * 100
              return (
                <g key={`v-${index}`}>
                  <line x1={x} y1="50" x2={x} y2="450" />
                  <line x1={x} y1="550" x2={x} y2="950" />
                </g>
              )
            })}
            <line x1="350" y1="50" x2="550" y2="250" />
            <line x1="550" y1="50" x2="350" y2="250" />
            <line x1="350" y1="750" x2="550" y2="950" />
            <line x1="550" y1="750" x2="350" y2="950" />
          </g>
          <g className="river-labels" aria-hidden="true">
            <text x="245" y="520" textAnchor="middle">
              楚 河
            </text>
            <text x="655" y="520" textAnchor="middle">
              汉 界
            </text>
          </g>
          <g className="point-marks">
            {points
              .filter(
                ({ row, col }) =>
                  ((row === 2 || row === 7) && (col === 1 || col === 7)) ||
                  ((row === 3 || row === 6) && [0, 2, 4, 6, 8].includes(col)),
              )
              .map(({ row, col }) => {
                const x = 50 + col * 100
                const y = 50 + row * 100
                return <circle key={`${row}-${col}`} cx={x} cy={y} r="5" />
              })}
          </g>
        </svg>

        {lastMove && (
          <>
            <span
              className="move-marker move-marker--from"
              style={{
                left: `${((50 + lastMove.from.col * 100) / 900) * 100}%`,
                top: `${((50 + lastMove.from.row * 100) / 1000) * 100}%`,
              }}
            />
            <span
              className="move-marker move-marker--to"
              style={{
                left: `${((50 + lastMove.to.col * 100) / 900) * 100}%`,
                top: `${((50 + lastMove.to.row * 100) / 1000) * 100}%`,
              }}
            />
          </>
        )}

        {board.map((row, rowIndex) =>
          row.map((piece, colIndex) => {
            if (!piece) return null
            const isActiveGeneral =
              piece.type === 'general' && piece.color === checkColor
            return (
              <div
                key={piece.id}
                className={`piece piece--${piece.color} ${
                  isActiveGeneral ? 'piece--checked' : ''
                } ${piece.color === turn ? 'piece--active-side' : ''}`}
                style={{
                  left: `${((50 + colIndex * 100) / 900) * 100}%`,
                  top: `${((50 + rowIndex * 100) / 1000) * 100}%`,
                }}
                role="img"
                aria-label={`${piece.color === 'red' ? '红方' : '黑方'}${pieceLabel(piece)}`}
              >
                <span>{pieceLabel(piece)}</span>
              </div>
            )
          }),
        )}

        {paused && (
          <div className="board-paused">
            <PauseIconSmall />
            <strong>对局已暂停</strong>
            <span>棋钟与双方思考均已停止</span>
          </div>
        )}
      </div>
    </div>
  )
}

function PauseIconSmall() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
