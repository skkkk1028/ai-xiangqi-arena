import type { BoardState, Color, EngineScore, Move, SearchInfo, Wdl } from '../game/types'
import {
  parseBestmove,
  parseInfoLine,
  UCCI_MOVE_PATTERN,
} from './parsers/ucci-parser'

export { parseBestmove, parseInfoLine, UcciParser } from './parsers/ucci-parser'

export function positionToUcci(row: number, col: number): string {
  return `${String.fromCharCode(97 + col)}${9 - row}`
}

export function moveToUcci(move: Move): string {
  return `${positionToUcci(move.from.row, move.from.col)}${positionToUcci(move.to.row, move.to.col)}`
}

export function matchUcciMove(board: BoardState, legalMoves: Move[], text: string): Move | null {
  if (!UCCI_MOVE_PATTERN.test(text)) return null
  const fromCol = text.charCodeAt(0) - 97
  const fromRow = 9 - Number(text[1])
  const toCol = text.charCodeAt(2) - 97
  const toRow = 9 - Number(text[3])
  if (!board[fromRow]?.[fromCol]) return null
  return (
    legalMoves.find(
      (move) =>
        move.from.row === fromRow &&
        move.from.col === fromCol &&
        move.to.row === toRow &&
        move.to.col === toCol,
    ) ?? null
  )
}

export function normalizeWdlForSideToMove(wdl: Wdl | null): Wdl | null {
  return wdl ? { ...wdl } : null
}

export function scoreLabel(score: EngineScore | null): string {
  if (!score) return '—'
  if (score.kind === 'mate') return score.value > 0 ? `杀 ${score.value}` : `被杀 ${Math.abs(score.value)}`
  const pawns = score.value / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`
}

export function sideLabel(color: Color): string {
  return color === 'red' ? '红方' : '黑方'
}
