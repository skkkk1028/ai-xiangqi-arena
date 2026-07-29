import { useEffect, useRef } from 'react'
import type { MoveRecord } from '../game/types'

interface MoveHistoryProps {
  history: MoveRecord[]
}

export function MoveHistory({ history }: MoveHistoryProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    if (typeof list.scrollTo === 'function') {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
    } else {
      list.scrollTop = list.scrollHeight
    }
  }, [history.length])

  const rounds: Array<{ number: number; red?: MoveRecord; black?: MoveRecord }> = []
  for (let index = 0; index < history.length; index += 2) {
    rounds.push({
      number: Math.floor(index / 2) + 1,
      red: history[index],
      black: history[index + 1],
    })
  }

  return (
    <section className="history-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MATCH RECORD</p>
          <h3>对局记录</h3>
        </div>
        <span>{history.length} 步</span>
      </div>
      <div className="history-columns" aria-hidden="true">
        <span>回合</span>
        <span>红方</span>
        <span>黑方</span>
      </div>
      <div className="history-list" ref={listRef}>
        {rounds.length === 0 ? (
          <div className="empty-history">
            <span>弈</span>
            <p>落子后将在此记录着法</p>
          </div>
        ) : (
          rounds.map((round) => (
            <div className="history-row" key={round.number}>
              <span className="round-number">{String(round.number).padStart(2, '0')}</span>
              <span className="move-red">{round.red?.notation ?? '—'}</span>
              <span className="move-black">{round.black?.notation ?? '…'}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
