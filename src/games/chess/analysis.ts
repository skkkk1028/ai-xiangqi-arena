import { Chess } from 'chess.js'
import type { SearchInfo, Wdl } from '../../game/types'
import { parseChessUci } from './rules'
import type { ChessColor } from './types'

export function formatWhiteScore(info: SearchInfo | undefined, color: ChessColor): string {
  if (!info?.score) return '—'
  const value = info.score.value * (color === 'w' ? 1 : -1)
  if (info.score.kind === 'mate') return `M${value}`
  return `${value > 0 ? '+' : ''}${(value / 100).toFixed(2)}`
}

export function evaluationCpForWhite(info: SearchInfo | undefined, color: ChessColor): number {
  if (!info?.score) return 0
  const value = info.score.kind === 'mate' ? Math.sign(info.score.value || 1) * 100_000 : info.score.value
  return value * (color === 'w' ? 1 : -1)
}

export function materialAdvantageCpForWhite(fen: string): number {
  const values: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
  return new Chess(fen).board().flat().reduce((score, piece) => {
    if (!piece) return score
    const value = values[piece.type] ?? 0
    return score + (piece.color === 'w' ? value : -value)
  }, 0)
}

export function formatAdvantageScore(cp: number): string {
  if (Math.abs(cp) >= 100_000) return cp > 0 ? '+M' : '−M'
  if (cp === 0) return '0.00'
  return `${cp > 0 ? '+' : '−'}${(Math.abs(cp) / 100).toFixed(2)}`
}

export function wdlForWhite(wdl: Wdl | null | undefined, color: ChessColor): Wdl | null {
  if (!wdl) return null
  return color === 'w' ? { ...wdl } : { win: wdl.loss, draw: wdl.draw, loss: wdl.win }
}

export function pvToSan(rootFen: string, pv: readonly string[]): string {
  const chess = new Chess(rootFen)
  const san: string[] = []
  for (const uci of pv) {
    const action = parseChessUci(uci)
    if (!action) {
      san.push(uci)
      continue
    }
    try {
      san.push(chess.move({ from: action.from, to: action.to, ...(action.promotion ? { promotion: action.promotion } : {}) }).san)
    } catch {
      san.push(uci)
    }
  }
  return san.join(' ')
}
