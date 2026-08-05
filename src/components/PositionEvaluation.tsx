import { normalizePositionEvaluation } from '../engine/evaluation'
import type { Color, SearchInfo } from '../game/types'

interface PositionEvaluationProps {
  info: SearchInfo
  perspective: Color
}

export function PositionEvaluation({ info, perspective }: PositionEvaluationProps) {
  const evaluation = normalizePositionEvaluation(info.score, info.wdl, perspective)
  const wdl = evaluation.wdlFromRed
  return (
    <section className={`position-evaluation position-evaluation--${evaluation.leader ?? 'equal'}`}>
      <span>当前优势评分</span>
      <strong>{evaluation.label}</strong>
      {wdl && (
        <small>
          红方视角 W/D/L：{(wdl.win / 10).toFixed(1)}% / {(wdl.draw / 10).toFixed(1)}% /{' '}
          {(wdl.loss / 10).toFixed(1)}%
        </small>
      )}
    </section>
  )
}
