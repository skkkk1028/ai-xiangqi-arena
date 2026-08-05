import type { Color, Move, PieceType } from './types'

const pieceNames: Record<Color, Record<PieceType, string>> = {
  red: {
    general: '帅',
    advisor: '仕',
    elephant: '相',
    horse: '马',
    chariot: '车',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '将',
    advisor: '士',
    elephant: '象',
    horse: '马',
    chariot: '车',
    cannon: '炮',
    soldier: '卒',
  },
}

const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

function fileNumber(color: Color, col: number): number {
  // The board is rendered from Red's side: Red counts files from right to
  // left, while Black counts the same visible files from left to right.
  return color === 'red' ? 9 - col : col + 1
}

export function pieceLabel(piece: { color: Color; type: PieceType }): string {
  return pieceNames[piece.color][piece.type]
}

export function formatMove(move: Move): string {
  const { piece, from, to } = move
  const fromFile = numerals[fileNumber(piece.color, from.col) - 1]
  const toFile = numerals[fileNumber(piece.color, to.col) - 1]
  const name = pieceLabel(piece)

  if (from.row === to.row) return `${name}${fromFile}平${toFile}`

  const forward = piece.color === 'red' ? to.row < from.row : to.row > from.row
  const direction = forward ? '进' : '退'
  const usesDestinationFile = ['horse', 'elephant', 'advisor'].includes(piece.type)
  const suffix = usesDestinationFile ? toFile : numerals[Math.abs(to.row - from.row) - 1]
  return `${name}${fromFile}${direction}${suffix}`
}
