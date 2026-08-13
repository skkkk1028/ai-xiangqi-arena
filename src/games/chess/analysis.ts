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
  if (info?.score?.kind !== 'cp') return 0
  return info.score.value * (color === 'w' ? 1 : -1)
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
