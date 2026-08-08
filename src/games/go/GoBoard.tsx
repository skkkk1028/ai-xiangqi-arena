import { formatGoPoint } from './move-history'
import { pointKey, pointsEqual } from './board'
import type {
  GoBoard as GoBoardState,
  GoMoveRecord,
  GoPlacementMove,
  GoPlayer,
} from './types'

const STAR_POINTS = [
  [3, 3], [3, 9], [3, 15],
  [9, 3], [9, 9], [9, 15],
  [15, 3], [15, 9], [15, 15],
] as const

interface GoBoardProps {
  board: GoBoardState
  turn: GoPlayer
  lastMove: GoMoveRecord | null
  legalMoveKeys: ReadonlySet<string>
  deadStoneKeys: ReadonlySet<string>
  interactive: boolean
  scoring: boolean
  onPlay: (move: GoPlacementMove) => void
  onToggleDead: (point: GoPlacementMove) => void
}

export function GoBoard({
  board,
  turn,
  lastMove,
  legalMoveKeys,
  deadStoneKeys,
  interactive,
  scoring,
  onPlay,
  onToggleDead,
}: GoBoardProps) {
  return (
    <div className="go-board" role="grid" aria-label="十九路围棋棋盘" aria-rowcount={19} aria-colcount={19}>
      <div className="go-board__grid" aria-hidden="true" />
      <div className="go-board__stars" aria-hidden="true">
        {STAR_POINTS.map(([row, col]) => (
          <i
            key={`${row}-${col}`}
            style={{ left: `${(col / 18) * 100}%`, top: `${(row / 18) * 100}%` }}
          />
        ))}
      </div>
      <div className="go-board__intersections">
        {board.flatMap((row, rowIndex) => row.map((stone, colIndex) => {
          const point = { row: rowIndex, col: colIndex }
          const key = pointKey(point)
          const legal = interactive && legalMoveKeys.has(key)
          const scorable = scoring && stone !== null
          const dead = deadStoneKeys.has(key)
          const isLastMove = lastMove?.kind === 'play' && lastMove.point
            ? pointsEqual(lastMove.point, point)
            : false
          const label = createPointLabel(point, stone, isLastMove, dead)

          return (
            <button
              key={key}
              className={`go-board__point${legal ? ' go-board__point--legal' : ''}${scorable ? ' go-board__point--scoring' : ''}${dead ? ' go-board__point--dead' : ''}`}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={isLastMove}
              aria-pressed={scorable ? dead : undefined}
              disabled={!legal && !scorable}
              onClick={() => scorable ? onToggleDead(point) : onPlay(point)}
            >
              {stone && (
                <span className={`go-board__stone go-board__stone--${stone}`}>
                  {isLastMove && <i className="go-board__last-marker" aria-hidden="true" />}
                </span>
              )}
            </button>
          )
        }))}
      </div>
      <span className="go-board__turn" aria-hidden="true">
        {scoring ? 'SCORING REVIEW' : `${turn === 'black' ? 'BLACK' : 'WHITE'} TO PLAY`}
      </span>
    </div>
  )
}

function createPointLabel(
  point: GoPlacementMove,
  stone: GoPlayer | null,
  isLastMove: boolean,
  dead: boolean,
): string {
  const position = formatGoPoint(point)
  if (!stone) return `${position}，空点`
  const stoneLabel = stone === 'black' ? '黑子' : '白子'
  return `${position}，${stoneLabel}${isLastMove ? '，最近一步' : ''}${dead ? '，已标记死子' : ''}`
}
