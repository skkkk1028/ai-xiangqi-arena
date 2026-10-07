import { normalizePositionEvaluation } from '../../engine/evaluation'
import type { Color, MoveRecord } from '../../game/types'

export interface TurningThresholds { cp: number; winRate: number }
export interface HistoryEvaluation { index: number; redCp: number | null; redWin: number | null; blackWin: number | null }
export interface TurningPoint {
  index: number
  color: Color
  kind: 'mistake' | 'brilliant'
  deltaCp: number
  deltaWin: number
}
export const DEFAULT_TURNING_THRESHOLDS: TurningThresholds = { cp: 150, winRate: 15 }

/** Existing records contain the root search evaluation BEFORE their move. No searches or score estimates. */
export function historyEvaluations(history: readonly MoveRecord[]): HistoryEvaluation[] {
  return history.map((move, index) => {
    const evaluation = normalizePositionEvaluation(move.score, move.wdl, move.piece.color)
    const wdl = evaluation.wdlFromRed
    const validWdl = wdl && [wdl.win, wdl.draw, wdl.loss].every((v) => Number.isFinite(v) && v >= 0) && wdl.win + wdl.draw + wdl.loss === 1000
    return {
      index,
      redCp: evaluation.cpFromRed !== null && Number.isFinite(evaluation.cpFromRed) ? evaluation.cpFromRed : null,
      redWin: validWdl ? wdl.win / 10 : null,
      blackWin: validWdl ? wdl.loss / 10 : null,
    }
  })
}

export function findTurningPoints(history: readonly MoveRecord[], evaluations: readonly HistoryEvaluation[], thresholds: TurningThresholds): TurningPoint[] {
  const points: TurningPoint[] = []
  for (let index = 0; index + 1 < history.length; index += 1) {
    const before = evaluations[index]
    const after = evaluations[index + 1]
    const color = history[index].piece.color
    const beforeWin = color === 'red' ? before?.redWin : before?.blackWin
    const afterWin = color === 'red' ? after?.redWin : after?.blackWin
    if (before?.redCp == null || after?.redCp == null || beforeWin == null || afterWin == null) continue
    const deltaCp = (after.redCp - before.redCp) * (color === 'red' ? 1 : -1)
    const deltaWin = afterWin - beforeWin
    if (deltaCp < 0 && deltaWin < 0 && -deltaCp >= thresholds.cp && -deltaWin >= thresholds.winRate) {
      points.push({ index, color, kind: 'mistake', deltaCp, deltaWin })
    } else if (deltaCp > 0 && deltaWin > 0 && deltaCp >= thresholds.cp && deltaWin >= thresholds.winRate) {
      points.push({ index, color, kind: 'brilliant', deltaCp, deltaWin })
    }
  }
  return points
}

export function turningPointLabel(point: TurningPoint): string {
  return `第 ${point.index + 1} 步：${point.color === 'red' ? '红方' : '黑方'}${point.kind === 'mistake' ? '失误' : '妙手（待复核）'} ${point.deltaCp > 0 ? '+' : '−'}${Math.abs(point.deltaCp)} 分 · 胜率${point.deltaWin > 0 ? '+' : '−'}${Math.abs(point.deltaWin).toFixed(1)} 个百分点`
}

export function topTurningPoints(points: readonly TurningPoint[]): TurningPoint[] {
  return [...points].sort((a, b) => Math.abs(b.deltaCp) - Math.abs(a.deltaCp) || Math.abs(b.deltaWin) - Math.abs(a.deltaWin) || a.index - b.index).slice(0, 3)
}

export function turningPointReport(history: readonly MoveRecord[], points: readonly TurningPoint[], thresholds: TurningThresholds): string {
  const top = topTurningPoints(points)
  return [
    `中国象棋战报 · 共 ${history.length} 步（按半回合计数）`,
    `筛选阈值：评分变化 ≥ ${thresholds.cp} 分且胜率变化 ≥ ${thresholds.winRate} 个百分点。`,
    top.length ? `本局最大已记录转折：${turningPointLabel(top[0])}。` : '当前阈值下未发现可标注转折；不代表全局没有失误。',
    ...top.slice(1).map((point) => turningPointLabel(point)),
    '仅依据原局相邻搜索记录估计；跨引擎、深度差异可能造成波动。妙手为待复核信号；缺失评分/WDL、将杀分及末手未纳入。',
  ].join('\n')
}
