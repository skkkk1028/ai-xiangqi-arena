import type { Color, EngineScore, Wdl } from '../game/types'
import { opposite } from '../game/board'

export interface PositionEvaluation {
  kind: 'cp' | 'mate' | 'unknown'
  perspective: Color
  leader: Color | null
  cpFromRed: number | null
  mateIn: number | null
  wdlFromRed: Wdl | null
  label: string
}

export function normalizePositionEvaluation(
  score: EngineScore | null,
  wdl: Wdl | null,
  perspective: Color,
): PositionEvaluation {
  const wdlFromRed = normalizeWdlForRed(wdl, perspective)
  if (!score) {
    return {
      kind: 'unknown',
      perspective,
      leader: null,
      cpFromRed: null,
      mateIn: null,
      wdlFromRed,
      label: '等待引擎评价',
    }
  }
  if (score.kind === 'mate') {
    const leader = score.value >= 0 ? perspective : opposite(perspective)
    const mateIn = Math.abs(score.value)
    return {
      kind: 'mate',
      perspective,
      leader,
      cpFromRed: null,
      mateIn,
      wdlFromRed,
      label: `${leader === 'red' ? '红方' : '黑方'}将杀${mateIn ? `（${mateIn} 步）` : ''}`,
    }
  }
  const cpFromRed = perspective === 'red' ? score.value : -score.value
  const leader = cpFromRed === 0 ? null : cpFromRed > 0 ? 'red' : 'black'
  return {
    kind: 'cp',
    perspective,
    leader,
    cpFromRed,
    mateIn: null,
    wdlFromRed,
    label: leader
      ? `${leader === 'red' ? '红方' : '黑方'}优势 +${(Math.abs(cpFromRed) / 100).toFixed(2)}`
      : '当前形势：均衡 0.00',
  }
}

export function normalizeWdlForRed(wdl: Wdl | null, perspective: Color): Wdl | null {
  if (!wdl) return null
  return perspective === 'red'
    ? { ...wdl }
    : { win: wdl.loss, draw: wdl.draw, loss: wdl.win }
}
