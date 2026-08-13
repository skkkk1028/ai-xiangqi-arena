import { evaluationCpForWhite, formatAdvantageScore, materialAdvantageCpForWhite } from './analysis'
import type { ChessColor, ChessGameState, ChessLiveAnalysis, ChessTurnAnalysis } from './types'

export function ChessMatchInfoPanel({
  state,
  analyses,
  liveInfo = {},
}: {
  state: ChessGameState
  analyses: Partial<Record<ChessColor, ChessTurnAnalysis>>
  liveInfo?: Partial<Record<ChessColor, ChessLiveAnalysis>>
}) {
  const live = liveInfo[state.turn]?.rootFen === state.fen ? liveInfo[state.turn] : undefined
  const completed = latestAnalysis(analyses)
  const engineAnalysis = live ?? completed
  const materialCp = materialAdvantageCpForWhite(state.fen)
  const engineCp = engineAnalysis ? evaluationCpForWhite(engineAnalysis.info, engineAnalysis.color) : null
  const advantageCp = engineCp ?? materialCp
  const source = engineCp === null ? '当前局面子力估算' : live ? '当前局面引擎评估' : '最近一次引擎评估'
  const whiteLead = Math.max(0, advantageCp)
  const blackLead = Math.max(0, -advantageCp)
  const scale = Math.max(100, whiteLead, blackLead)

  return (
    <section className="chess-match-info" aria-label="走子记录与双方优势分">
      <div className="chess-match-info__header">
        <div>
          <span className="chess-match-info__eyebrow">MOVE LOG · ADVANTAGE</span>
          <h3>走子记录与优势分</h3>
        </div>
        <small>{source} · 以白方为正</small>
      </div>
      <div className="chess-advantage">
        <div className="chess-advantage__summary">
          <span>当前评估</span>
          <strong>{formatAdvantageScore(advantageCp)}</strong>
          <small>{advantageCp > 0 ? '白方占优' : advantageCp < 0 ? '黑方占优' : '双方均势'}</small>
        </div>
        <div className="chess-advantage__sides">
          <AdvantageSide label="白方优势" value={whiteLead} scale={scale} color="white" />
          <AdvantageSide label="黑方优势" value={blackLead} scale={scale} color="black" />
        </div>
      </div>
      <div className="chess-match-info__moves" aria-label="每一步走子">
        <div className="chess-match-info__moves-header"><span>回合</span><span>白方</span><span>黑方</span></div>
        {state.history.length === 0 ? <p className="chess-match-info__empty">对局开始后，双方每一步会显示在这里。</p> : moveRows(state).map((row) => (
          <div className="chess-match-info__move-row" key={row.number}>
            <small>{row.number}.</small>
            <MoveCell move={row.white} color="w" />
            <MoveCell move={row.black} color="b" />
          </div>
        ))}
      </div>
    </section>
  )
}

function AdvantageSide({ label, value, scale, color }: { label: string; value: number; scale: number; color: 'white' | 'black' }) {
  return <div className={`chess-advantage__side chess-advantage__side--${color}`}>
    <div><span>{label}</span><strong>{formatAdvantageScore(value)}</strong></div>
    <i><b style={{ width: `${Math.min(100, Math.max(value / scale * 100, value ? 8 : 0))}%` }} /></i>
  </div>
}

function MoveCell({ move, color }: { move: ChessGameState['history'][number] | undefined; color: ChessColor }) {
  return <div className={`chess-match-info__move chess-match-info__move--${color}`}>
    {move ? <><strong>{move.san}</strong><small>{move.uci}</small></> : <span>—</span>}
  </div>
}

function moveRows(state: ChessGameState) {
  const rows: Array<{ number: number; white?: ChessGameState['history'][number]; black?: ChessGameState['history'][number] }> = []
  for (const move of state.history) {
    const number = Math.ceil(move.ply / 2)
    const row = rows[number - 1] ?? { number }
    if (move.color === 'w') row.white = move
    else row.black = move
    rows[number - 1] = row
  }
  return rows
}

function latestAnalysis(analyses: Partial<Record<ChessColor, ChessTurnAnalysis>>): ChessTurnAnalysis | undefined {
  return Object.values(analyses).filter(Boolean).sort((left, right) => right!.ply - left!.ply)[0]
}
