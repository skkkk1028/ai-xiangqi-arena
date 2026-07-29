import { ClockIcon } from './Icons'
import type { Color } from '../game/types'

interface PlayerCardProps {
  color: Color
  remainingMs: number
  turnElapsedMs: number
  active: boolean
  thinking: boolean
  depth: number
  nodes: number
}

export function formatClock(ms: number): string {
  const safeMs = Math.max(0, ms)
  const minutes = Math.floor(safeMs / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const tenths = Math.floor((safeMs % 1000) / 100)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export function PlayerCard({
  color,
  remainingMs,
  turnElapsedMs,
  active,
  thinking,
  depth,
  nodes,
}: PlayerCardProps) {
  const isRed = color === 'red'
  const turnRemaining = Math.max(0, 60_000 - turnElapsedMs)
  const turnProgress = Math.min(100, (turnElapsedMs / 60_000) * 100)

  return (
    <section className={`player-card player-card--${color} ${active ? 'is-active' : ''}`}>
      <div className="player-topline">
        <span className="side-seal">{isRed ? '红' : '黑'}</span>
        <div>
          <p className="eyebrow">{isRed ? 'RED AI · 先手' : 'BLACK AI · 后手'}</p>
          <h2>{isRed ? '赤焰' : '玄甲'}</h2>
        </div>
        <span className={`turn-indicator ${active ? 'is-live' : ''}`}>
          <i />
          {active ? (thinking ? '思考中' : '行棋方') : '等待'}
        </span>
      </div>

      <div className="main-clock" aria-label={`${isRed ? '红方' : '黑方'}剩余时间`}>
        <ClockIcon />
        <span>{formatClock(remainingMs)}</span>
      </div>

      <div className="turn-timer">
        <div className="timer-label">
          <span>本步用时</span>
          <strong>{active ? formatClock(turnRemaining).slice(3) : '60.0'}</strong>
        </div>
        <div className="timer-track">
          <span style={{ width: `${active ? turnProgress : 0}%` }} />
        </div>
      </div>

      <dl className="search-meta">
        <div>
          <dt>搜索深度</dt>
          <dd>{depth || '—'}</dd>
        </div>
        <div>
          <dt>已检节点</dt>
          <dd>{nodes ? compactNumber(nodes) : '—'}</dd>
        </div>
      </dl>
    </section>
  )
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
