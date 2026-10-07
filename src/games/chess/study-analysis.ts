import { Chess } from 'chess.js'
import type { SearchInfo } from '../../game/types'
import type { ChessSavedAnalysis } from './library'
import type { ChessColor, ChessMoveRecord } from './types'
import { parseChessUci } from './rules'

export function scoreForColor(info: SearchInfo | undefined, rootTurn: ChessColor, color: ChessColor): { kind: 'cp' | 'mate'; value: number } | null {
  if (!info?.score) return null
  return { kind: info.score.kind, value: info.score.value * (rootTurn === color ? 1 : -1) }
}

export function whiteScore(analysis: ChessSavedAnalysis | undefined, rootTurn: ChessColor): number | null {
  const score = scoreForColor(analysis?.response.info, rootTurn, 'w')
  return score?.kind === 'cp' ? score.value : null
}

export function whiteWinRateEstimate(analysis: ChessSavedAnalysis | undefined, rootTurn: ChessColor): { percent: number; source: string } | null {
  const info = analysis?.response.info
  if (!info) return null
  if (info.wdl) {
    const total = info.wdl.win + info.wdl.draw + info.wdl.loss
    if (total > 0) {
      const expected = (rootTurn === 'w' ? info.wdl.win : info.wdl.loss) + info.wdl.draw / 2
      return { percent: 100 * expected / total, source: '引擎 WDL' }
    }
  }
  const score = scoreForColor(info, rootTurn, 'w')
  if (!score) return null
  if (score.kind === 'mate') return { percent: score.value > 0 ? 100 : 0, source: '搜索到将杀' }
  return { percent: 100 / (1 + Math.exp(-score.value / 180)), source: '由兵值粗略估算' }
}

export function explainChessMove(record: ChessMoveRecord, before?: ChessSavedAnalysis, after?: ChessSavedAnalysis, choice?: ChessSavedAnalysis, next?: ChessMoveRecord): { lines: string[]; review: boolean } {
  const lines: string[] = []
  const mover = record.color
  if (record.captured) lines.push(`实战着 ${record.san} 吃掉${pieceName(record.captured)}；吃子本身不代表好棋。`)
  if (next?.captured && next.to === record.to) lines.push(`对手下一手吃掉了刚走到 ${record.to} 的棋子；这是棋谱中的实际丢子。`)
  if (record.check) lines.push(record.mate ? '实战着完成将杀。' : '实战着形成将军。')
  if (record.promotion) lines.push(`本手升变为${pieceName(record.promotion)}。`)
  if (!before) return { lines, review: false }
  const best = before.response.candidates.find((candidate) => candidate.multipv === 1) ?? before.response.candidates[0]
  if (!best?.pv[0]) return { lines: [...lines, '当前搜索没有可核验的推荐着。'], review: false }
  lines.push(best.pv[0] === record.uci ? '实战着与推荐着一致。' : `推荐着 ${best.pv[0]}，实战着 ${record.uci}。`)
  const same = (other?: ChessSavedAnalysis) => other && other.tier === before.tier && JSON.stringify(other.engine) === JSON.stringify(before.engine) && !other.timedOut && !before.timedOut && !other.engine.fallback && !before.engine.fallback && other.response.info.depth > 0
  const candidate = before.response.candidates.find((item) => item.pv[0] === record.uci)
  const pvExchange = candidate && describeImmediatePvCapture(before, candidate.pv, record)
  if (pvExchange) lines.push(pvExchange)
  const actual = candidate ? scoreForColor(candidate, mover, mover) : same(choice) ? scoreForColor(choice?.response.info, mover === 'w' ? 'b' : 'w', mover) : same(after) ? scoreForColor(after?.response.info, mover === 'w' ? 'b' : 'w', mover) : null
  const recommended = scoreForColor(best, mover, mover)
  if (!recommended || !actual || before.timedOut || before.engine.fallback || best.depth < 1) {
    lines.push('候选评价尚不足以可靠比较；可分析落子后局面或加深搜索。')
    return { lines, review: false }
  }
  if (recommended.kind === 'cp' && actual.kind === 'cp') {
    const loss = recommended.value - actual.value
    lines.push(`同档评价：推荐着 ${(recommended.value / 100).toFixed(2)}，实战着 ${(actual.value / 100).toFixed(2)}，差 ${(loss / 100).toFixed(2)} 兵。${candidate ? '' : '实战着采用落子后补搜估计。'}`)
    return { lines, review: loss >= 100 }
  }
  const missedMate = recommended.kind === 'mate' && recommended.value > 0 && (actual.kind !== 'mate' || actual.value <= 0)
  const allowedMate = actual.kind === 'mate' && actual.value < 0 && (recommended.kind !== 'mate' || recommended.value >= 0)
  if (missedMate) lines.push('推荐着存在搜索到的强制将杀，实战着未保留该将杀：漏掉将杀。')
  if (allowedMate) lines.push('实战着允许对方形成搜索到的强制将杀；推荐着可以避免。')
  if (!missedMate && !allowedMate) lines.push('包含将杀评价，不能换算为兵值差。')
  return { lines, review: missedMate }
}

function describeImmediatePvCapture(before: ChessSavedAnalysis, pv: readonly string[], record: ChessMoveRecord): string | null {
  if (pv.length < 2) return null
  try {
    const board = new Chess(before.initialFen)
    for (const uci of before.prefix) {
      const move = parseChessUci(uci)
      if (!move) return null
      board.move(move)
    }
    const first = parseChessUci(pv[0])
    const reply = parseChessUci(pv[1])
    if (!first || !reply) return null
    const moved = board.move(first)
    const captured = board.move(reply)
    if (!captured.captured || captured.to !== record.to) return null
    return moved.captured
      ? `同次搜索的合法变化中，对手下一手在 ${record.to} 吃回${pieceName(moved.piece)}，形成直接交换；这仍是搜索变化。`
      : `同次搜索的合法变化中，对手下一手在 ${record.to} 吃掉刚走出的${pieceName(moved.piece)}；这仍是搜索变化。`
  } catch { return null }
}

function pieceName(piece: string): string {
  return ({ p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' } as Record<string, string>)[piece] ?? piece
}
