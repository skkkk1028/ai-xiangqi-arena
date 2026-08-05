import { scoreLabel } from '../engine/ucci'
import type { AiPersonality } from '../engine/personality'
import type { Color, SearchInfo } from '../game/types'
import { ClockIcon } from './Icons'

interface PlayerCardProps {
  color: Color
  remainingMs: number
  turnElapsedMs: number
  active: boolean
  thinking: boolean
  info: SearchInfo | null
  personality?: AiPersonality
  engineName: string
  protocol: 'UCCI' | 'UCI'
  skillLevel: number | null
  styleDescription?: string
  openingName: string
  openingBranch: string
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
  info,
  personality,
  engineName,
  protocol,
  skillLevel,
  styleDescription,
  openingName,
  openingBranch,
}: PlayerCardProps) {
  const isRed = color === 'red'
  const turnRemaining = Math.max(0, 60_000 - turnElapsedMs)
  const turnProgress = Math.min(100, (turnElapsedMs / 60_000) * 100)
  const wdl = info?.wdl

  return (
    <section className={`player-card player-card--${color} ${active ? 'is-active' : ''}`}>
      <div className="player-topline">
        <span className="side-seal">{isRed ? '红' : '黑'}</span>
        <div>
          <p className="eyebrow">{isRed ? 'RED · 先手' : 'BLACK · 后手'}</p>
          <h2>{personality ? `${personality.name} · Fairy-Stockfish` : engineName}</h2>
          <small className="engine-subtitle">
            NNUE · {protocol} · {skillLevel === null ? '满强度' : `Skill ${skillLevel}`}
          </small>
        </div>
        <span className={`turn-indicator ${active ? 'is-live' : ''}`}>
          <i />
          {active ? (thinking ? '搜索中' : '行棋方') : '等待'}
        </span>
      </div>

      <div className="personality-details">
        <strong>{personality?.summary ?? styleDescription ?? '独立高水平象棋引擎'}</strong>
        <span>{isRed ? `红方开局：${openingBranch}` : `黑方应手：${openingBranch}`}</span>
        <small>当前棋谱：{openingName}</small>
      </div>

      <div className="main-clock" aria-label={`${isRed ? '红方' : '黑方'}剩余时间`}>
        <ClockIcon />
        <span>{formatClock(remainingMs)}</span>
      </div>

      <div className="turn-timer">
        <div className="timer-label">
          <span>本步剩余</span>
          <strong>{active ? formatClock(turnRemaining).slice(3) : '60.0'}</strong>
        </div>
        <div className="timer-track"><span style={{ width: `${active ? turnProgress : 0}%` }} /></div>
      </div>

      <dl className="search-meta search-meta--engine">
        <div><dt>深度</dt><dd>{info?.depth || '—'}</dd></div>
        <div><dt>节点</dt><dd>{info?.nodes ? compactNumber(info.nodes) : '—'}</dd></div>
        <div><dt>NPS</dt><dd>{info?.nps ? compactNumber(info.nps) : '—'}</dd></div>
        <div><dt>评估</dt><dd>{scoreLabel(info?.score ?? null)}</dd></div>
      </dl>

      <div className="wdl-row">
        <span>胜 {wdl ? `${(wdl.win / 10).toFixed(1)}%` : '—'}</span>
        <span>和 {wdl ? `${(wdl.draw / 10).toFixed(1)}%` : '—'}</span>
        <span>负 {wdl ? `${(wdl.loss / 10).toFixed(1)}%` : '—'}</span>
      </div>
      <div className="pv-line" title={info?.pv.join(' ')}>
        <strong>PV</strong>
        <span>{info?.pv.slice(0, 6).join(' ') || '等待主变化'}</span>
      </div>
    </section>
  )
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
