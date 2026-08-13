import { Chess } from 'chess.js'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ChessGameState, ChessColor, ChessMoveAction, ChessSquare } from './types'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const PIECES: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
}

export function ChessBoard({ state, interactive = false, humanColor, disabled = false, onMove }: {
  state: ChessGameState
  interactive?: boolean
  humanColor?: ChessColor
  disabled?: boolean
  onMove?: (action: ChessMoveAction) => void
}) {
  const board = useMemo(() => boardFromFen(state.fen), [state.fen])
  const motion = useMemo(() => moveAnimation(state), [state])
  const [selected, setSelected] = useState<ChessSquare | null>(null)
  const legalMoves = useMemo(() => {
    if (!interactive || disabled || !humanColor || state.result || state.turn !== humanColor) return []
    return new Chess(state.fen).moves({ verbose: true }).map(moveToAction)
  }, [disabled, humanColor, interactive, state.fen, state.result, state.turn])
  useEffect(() => setSelected(null), [humanColor, state.fen])
  const last = state.lastMove
  const checkSquare = last?.check ? kingSquare(board, state.turn) : null
  const handleSquareClick = (square: ChessSquare) => {
    if (!interactive || disabled || !humanColor || state.result || state.turn !== humanColor) return
    const piece = pieceAt(board, square)
    if (selected) {
      const action = legalMoves.find((candidate) => candidate.from === selected && candidate.to === square && (!candidate.promotion || candidate.promotion === 'q'))
        ?? legalMoves.find((candidate) => candidate.from === selected && candidate.to === square)
      if (action) {
        setSelected(null)
        onMove?.(action)
        return
      }
      setSelected(piece?.color === humanColor ? square : null)
      return
    }
    if (piece?.color === humanColor) setSelected(square)
  }
  return (
    <div className="chess-board-shell">
      <div className="chess-board" role="grid" aria-label="国际象棋棋盘">
        {Array.from({ length: 64 }, (_, index) => {
          const row = Math.floor(index / 8)
          const col = index % 8
          const square = `${FILES[col]}${8 - row}` as ChessSquare
          const piece = board[row][col]
          const isLight = (row + col) % 2 === 0
          const recent = last && (last.from === square || last.to === square)
          const promotion = last?.promotion && last.to === square
          const check = checkSquare === square
          const isSelected = selected === square
          const isLegalTarget = legalMoves.some((move) => move.from === selected && move.to === square)
          return (
            <div
              key={square}
              className={`chess-square chess-square--${isLight ? 'light' : 'dark'}${recent ? ' chess-square--recent' : ''}${check ? ' chess-square--check' : ''}${promotion ? ' chess-square--promotion' : ''}${isSelected ? ' chess-square--selected' : ''}${isLegalTarget ? ' chess-square--legal-target' : ''}${interactive ? ' chess-square--interactive' : ''}`}
              role="gridcell"
              aria-label={`${square}${piece ? ` ${piece.color === 'w' ? '白' : '黑'}方${piece.type}` : ''}${isLegalTarget ? ' 可落子' : ''}`}
              aria-selected={isSelected}
              onClick={() => handleSquareClick(square)}
            >
              {row === 7 && <small className="chess-file-label">{FILES[col]}</small>}
              {col === 0 && <small className="chess-rank-label">{8 - row}</small>}
              {piece && <span className={`chess-piece chess-piece--${piece.color}${motion?.to === square ? ' chess-piece--arriving' : ''}`}>{PIECES[`${piece.color}${piece.type}`]}</span>}
            </div>
          )
        })}
        {motion && <span
          key={`move-${last?.ply ?? 0}`}
          className={`chess-piece chess-piece-motion chess-piece--${motion.moving.color}`}
          style={{
            '--chess-from-x': `${motion.from.col * 12.5}%`,
            '--chess-from-y': `${motion.from.row * 12.5}%`,
            '--chess-move-x': `${(motion.toPosition.col - motion.from.col) * 100}%`,
            '--chess-move-y': `${(motion.toPosition.row - motion.from.row) * 100}%`,
          } as CSSProperties}
          aria-hidden="true"
        >{PIECES[`${motion.moving.color}${motion.moving.type}`]}</span>}
        {motion?.captured && motion.capturePosition && <span
          key={`capture-${last?.ply ?? 0}`}
          className={`chess-piece chess-captured-ghost chess-piece--${motion.captured.color}`}
          style={{
            '--chess-capture-x': `${motion.capturePosition.col * 12.5}%`,
            '--chess-capture-y': `${motion.capturePosition.row * 12.5}%`,
          } as CSSProperties}
          aria-hidden="true"
        >{PIECES[`${motion.captured.color}${motion.captured.type}`]}</span>}
      </div>
      <div className="chess-board-caption"><span>WHITE VIEW · STANDARD 8×8</span><i /><span>{state.openingName}</span><i /><span>{state.history.length} PLY</span></div>
    </div>
  )
}

interface BoardPiece { color: 'w' | 'b'; type: string }

interface BoardPosition { row: number; col: number }

interface MoveAnimation {
  from: BoardPosition
  to: ChessSquare
  toPosition: BoardPosition
  moving: BoardPiece
  captured: BoardPiece | null
  capturePosition: BoardPosition | null
}

function boardFromFen(fen: string): (BoardPiece | null)[][] {
  const rows = fen.split(' ')[0].split('/')
  return rows.map((row) => {
    const result: (BoardPiece | null)[] = []
    for (const char of row) {
      if (/\d/.test(char)) result.push(...Array(Number(char)).fill(null))
      else result.push({ color: char === char.toUpperCase() ? 'w' : 'b', type: char.toLowerCase() })
    }
    return result
  })
}

function kingSquare(board: (BoardPiece | null)[][], color: 'w' | 'b'): string | null {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col]
      if (piece?.color === color && piece.type === 'k') return `${FILES[col]}${8 - row}`
    }
  }
  return null
}

function moveAnimation(state: ChessGameState): MoveAnimation | null {
  const last = state.lastMove
  if (!last || state.history.length === 0) return null
  const chess = new Chess(state.initialFen)
  for (const record of state.history.slice(0, -1)) {
    chess.move({ from: record.from, to: record.to, ...(record.promotion ? { promotion: record.promotion } : {}) })
  }
  const previous = boardFromFen(chess.fen())
  const from = squarePosition(last.from)
  const toPosition = squarePosition(last.to)
  const moving = previous[from.row]?.[from.col]
  if (!moving) return null

  let capturePosition: BoardPosition | null = last.captured ? toPosition : null
  let captured = capturePosition ? previous[capturePosition.row]?.[capturePosition.col] ?? null : null
  if (last.captured && !captured) {
    // En-passant removes the pawn behind the destination square.
    capturePosition = squarePosition(`${last.to[0]}${last.from[1]}` as ChessSquare)
    captured = previous[capturePosition.row]?.[capturePosition.col] ?? null
  }
  return { from, to: last.to, toPosition, moving, captured, capturePosition }
}

function squarePosition(square: ChessSquare): BoardPosition {
  return { row: 8 - Number(square[1]), col: FILES.indexOf(square[0] as typeof FILES[number]) }
}

function pieceAt(board: (BoardPiece | null)[][], square: ChessSquare): BoardPiece | null {
  const position = squarePosition(square)
  return board[position.row]?.[position.col] ?? null
}

function moveToAction(move: { from: string; to: string; promotion?: string }): ChessMoveAction {
  return {
    from: move.from as ChessSquare,
    to: move.to as ChessSquare,
    ...(move.promotion ? { promotion: move.promotion as ChessMoveAction['promotion'] } : {}),
  }
}
