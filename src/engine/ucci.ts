import type { BoardState, Color, EngineScore, Move, SearchInfo, Wdl } from '../game/types'

const MOVE_PATTERN = /^[a-i][0-9][a-i][0-9]$/

export function positionToUcci(row: number, col: number): string {
  return `${String.fromCharCode(97 + col)}${9 - row}`
}

export function moveToUcci(move: Move): string {
  return `${positionToUcci(move.from.row, move.from.col)}${positionToUcci(move.to.row, move.to.col)}`
}

export function matchUcciMove(board: BoardState, legalMoves: Move[], text: string): Move | null {
  if (!MOVE_PATTERN.test(text)) return null
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

export function parseInfoLine(line: string, previous?: SearchInfo): SearchInfo | null {
  if (!line.startsWith('info ')) return null
  const next: SearchInfo = previous
    ? { ...previous, pv: [...previous.pv], wdl: previous.wdl && { ...previous.wdl } }
    : { depth: 0, nodes: 0, nps: 0, elapsedMs: 0, score: null, wdl: null, pv: [] }

  const tokens = line.trim().split(/\s+/)
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === 'depth') next.depth = readNumber(tokens[++index], next.depth)
    else if (token === 'seldepth') next.seldepth = readNumber(tokens[++index], next.seldepth ?? 0)
    else if (token === 'nodes') next.nodes = readNumber(tokens[++index], next.nodes)
    else if (token === 'nps') next.nps = readNumber(tokens[++index], next.nps)
    else if (token === 'time') next.elapsedMs = readNumber(tokens[++index], next.elapsedMs)
    else if (token === 'score') {
      const kind = tokens[++index]
      const value = Number(tokens[++index])
      if ((kind === 'cp' || kind === 'mate') && Number.isFinite(value)) {
        next.score = { kind, value } as EngineScore
      }
    } else if (token === 'wdl') {
      const win = Number(tokens[++index])
      const draw = Number(tokens[++index])
      const loss = Number(tokens[++index])
      if ([win, draw, loss].every(Number.isFinite)) next.wdl = { win, draw, loss }
    } else if (token === 'pv') {
      next.pv = tokens.slice(index + 1).filter((move) => MOVE_PATTERN.test(move))
      break
    }
  }
  return next
}

export function parseBestmove(line: string): string | null | undefined {
  if (line === 'nobestmove') return null
  const match = /^bestmove(?:\s+(\S+))?/.exec(line)
  if (!match) return undefined
  return match[1] && MOVE_PATTERN.test(match[1]) ? match[1] : null
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

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
