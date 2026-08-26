import { useEffect, useState } from 'react'
import type { ActionEligibility } from '../games/xiangqi'

export type NegotiationKind = 'draw' | 'undo'

export interface NegotiationPending {
  kind: NegotiationKind
  title: string
  message: string
  awaitingOpponent: boolean
}

interface MatchNegotiationPanelProps {
  resign: ActionEligibility
  draw: ActionEligibility
  undo: ActionEligibility
  pending: NegotiationPending | null
  notice: string | null
  onResign: () => void
  onOfferDraw: () => void
  onRequestUndo: () => void
  onAccept?: () => void
  onReject?: () => void
}

export function MatchNegotiationPanel({
  resign,
  draw,
  undo,
  pending,
  notice,
  onResign,
  onOfferDraw,
  onRequestUndo,
  onAccept,
  onReject,
}: MatchNegotiationPanelProps) {
  const [confirming, setConfirming] = useState<'resign' | 'draw' | 'undo' | null>(null)
  const actions = {
    resign: { title: '确认认输？', message: '确认后本局立即判负，不能撤销。', run: onResign },
    draw: { title: '确认提和？', message: '提和发出后不可撤回；对方拒绝或继续行棋即为拒绝。', run: onOfferDraw },
    undo: { title: '申请友谊悔棋？', message: '这不是正式竞赛规则。接受后将撤销最近一个完整回合。', run: onRequestUndo },
  } as const
  const confirm = confirming ? actions[confirming] : null

  useEffect(() => {
    if (!confirming) return
    const eligibility = confirming === 'resign' ? resign : confirming === 'draw' ? draw : undo
    if (!eligibility.enabled || pending) setConfirming(null)
  }, [confirming, draw, pending, resign, undo])

  const submitConfirmation = () => {
    if (!confirm) return
    setConfirming(null)
    confirm.run()
  }

  return (
    <section className="negotiation-panel" aria-labelledby="negotiation-title">
      <div className="section-heading">
        <div><p className="eyebrow">MATCH AGREEMENT</p><h3 id="negotiation-title">对局协商</h3></div>
      </div>
      <div className="negotiation-actions">
        <ActionButton label="认输" eligibility={resign} onClick={() => setConfirming('resign')} danger />
        <ActionButton label="提和" eligibility={draw} onClick={() => setConfirming('draw')} />
        <ActionButton label="悔棋" eligibility={undo} onClick={() => setConfirming('undo')} />
      </div>
      <p className="negotiation-help">提和遵循回合与次数限制；悔棋属于双方同意的友谊赛扩展。</p>
      {notice && <p className="negotiation-notice" role="status">{notice}</p>}

      {confirm && (
        <div className="negotiation-dialog-backdrop">
          <section className="negotiation-dialog" role="dialog" aria-modal="true" aria-labelledby="negotiation-confirm-title">
            <h4 id="negotiation-confirm-title">{confirm.title}</h4>
            <p>{confirm.message}</p>
            <div>
              <button type="button" className="negotiation-primary" onClick={submitConfirmation}>确认</button>
              <button type="button" onClick={() => setConfirming(null)}>取消</button>
            </div>
          </section>
        </div>
      )}

      {pending && (
        <div className="negotiation-dialog-backdrop">
          <section className="negotiation-dialog" role="dialog" aria-modal="true" aria-labelledby="negotiation-pending-title">
            <h4 id="negotiation-pending-title">{pending.title}</h4>
            <p>{pending.message}</p>
            {pending.awaitingOpponent ? (
              <div>
                <button type="button" className="negotiation-primary" onClick={onAccept}>同意</button>
                <button type="button" onClick={onReject}>拒绝</button>
              </div>
            ) : <span className="negotiation-waiting" role="status">AI 正在评估当前局面…</span>}
          </section>
        </div>
      )}
    </section>
  )
}

function ActionButton({
  label,
  eligibility,
  onClick,
  danger = false,
}: {
  label: string
  eligibility: ActionEligibility
  onClick: () => void
  danger?: boolean
}) {
  return (
    <div>
      <button
        type="button"
        className={danger ? 'is-danger' : ''}
        disabled={!eligibility.enabled}
        onClick={onClick}
        aria-describedby={`negotiation-${label}`}
      >{label}</button>
      <small id={`negotiation-${label}`}>{eligibility.reason}</small>
    </div>
  )
}
