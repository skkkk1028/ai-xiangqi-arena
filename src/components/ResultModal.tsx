import type { GameResult } from '../game/types'
import { RefreshIcon } from './Icons'

interface ResultModalProps {
  result: GameResult
  plies: number
  onNewGame: () => void
  onHome: () => void
}

const reasonLabels: Record<GameResult['reason'], string> = {
  checkmate: '将死',
  stalemate: '困毙',
  timeout: '超时',
  resignation: '认输',
  repetition: '三次重复',
  'no-capture': '自然限着',
  technical: '技术中止',
}

export function ResultModal({ result, plies, onNewGame, onHome }: ResultModalProps) {
  const isDraw = !result.winner
  const winnerName = result.winner === 'red' ? '红方' : '黑方'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <div className={`result-seal ${isDraw ? 'result-seal--draw' : `result-seal--${result.winner}`}`}>
          {isDraw ? '和' : '胜'}
        </div>
        <p className="eyebrow">MATCH COMPLETE</p>
        <h2 id="result-title">{isDraw ? '此局言和' : `${winnerName}获胜`}</h2>
        <p className="result-summary">
          本局经过 <strong>{Math.ceil(plies / 2)}</strong> 个回合，
          因“{reasonLabels[result.reason]}”结束。
        </p>
        {result.detail && <p className="result-detail">{result.detail}</p>}
        <div className="result-rule">
          <span>终局裁定</span>
          <strong>{reasonLabels[result.reason]}</strong>
        </div>
        <div className="modal-actions">
          <button className="primary-action" onClick={onNewGame}>
            <RefreshIcon />
            再弈一局
          </button>
          <button className="text-action" onClick={onHome}>
            返回首页
          </button>
        </div>
      </section>
    </div>
  )
}
