import { useEffect, useMemo, useState } from 'react'
import type { GoWinRateAnalysisStatus } from './useGoWinRateAnalysis'
import { GO_WIN_RATE_ANALYSIS, type GoWinRatePoint } from './win-rate-analysis'

interface WinRateChartProps {
  points: readonly GoWinRatePoint[]
  status: GoWinRateAnalysisStatus
  error: string | null
  selectedMove?: number
  onSelectMove?: (moveNumber: number) => void
}

const WIDTH = 620
const HEIGHT = 220
const PLOT = { left: 46, right: 18, top: 16, bottom: 32 }
const PLOT_WIDTH = WIDTH - PLOT.left - PLOT.right
const PLOT_HEIGHT = HEIGHT - PLOT.top - PLOT.bottom

export function WinRateChart({ points, status, error, selectedMove, onSelectMove }: WinRateChartProps) {
  const [hoveredMove, setHoveredMove] = useState<number | null>(null)
  const latest = points.at(-1) ?? null
  const current = points.find((point) => point.moveNumber === selectedMove) ?? latest
  const hovered = points.find((point) => point.moveNumber === hoveredMove) ?? null
  const maxMove = Math.max(1, latest?.moveNumber ?? 1)
  const blackPath = useMemo(() => curvePath(points, maxMove, (point) => point.blackWinRate), [maxMove, points])
  const whitePath = useMemo(() => curvePath(points, maxMove, (point) => point.whiteWinRate), [maxMove, points])

  useEffect(() => {
    if (hoveredMove !== null && !points.some((point) => point.moveNumber === hoveredMove)) setHoveredMove(null)
  }, [hoveredMove, points])

  return (
    <section className="go-winrate-panel" aria-label="胜率走势">
      <header className="go-winrate-panel__header">
        <div>
          <span>胜率走势</span>
          <small>WIN RATE · MOVE</small>
        </div>
        <b className={`go-winrate-panel__status go-winrate-panel__status--${status}`}>
          <i />{statusLabel(status)}
        </b>
      </header>

      <div className="go-winrate-panel__current" aria-live="polite">
        {current ? (
          <>
            <strong>黑 {percent(current.blackWinRate)}</strong>
            <i />
            <strong>白 {percent(current.whiteWinRate)}</strong>
            <small>第 {current.moveNumber} 手</small>
          </>
        ) : (
          <span>{status === 'error' ? '当前无法取得可信胜率' : '落子后由 KataGo 分析当前局面'}</span>
        )}
      </div>

      <div className="go-winrate-chart">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chartLabel(current)}>
          {[1, 0.5, 0].map((rate) => {
            const y = yPosition(rate)
            return (
              <g key={rate} className={rate === 0.5 ? 'go-winrate-chart__balance' : 'go-winrate-chart__grid'}>
                <line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y} y2={y} />
                <text x={PLOT.left - 8} y={y + 4} textAnchor="end">{Math.round(rate * 100)}%</text>
              </g>
            )
          })}
          <line className="go-winrate-chart__axis" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={HEIGHT - PLOT.bottom} y2={HEIGHT - PLOT.bottom} />
          <text className="go-winrate-chart__axis-label" x={PLOT.left} y={HEIGHT - 8}>1</text>
          <text className="go-winrate-chart__axis-label" x={WIDTH - PLOT.right} y={HEIGHT - 8} textAnchor="end">MOVE {maxMove}</text>

          {points.length > 0 && (
            <>
              <path className="go-winrate-chart__line go-winrate-chart__line--black" d={blackPath} />
              <path className="go-winrate-chart__line go-winrate-chart__line--white" d={whitePath} />
              {points.map((point, index) => {
                const x = xPosition(point.moveNumber, maxMove)
                const targetWidth = Math.max(18, PLOT_WIDTH / Math.max(points.length, 1))
                return (
                  <g key={point.moveNumber}>
                    <circle className="go-winrate-chart__point go-winrate-chart__point--black" cx={x} cy={yPosition(point.blackWinRate)} r="3.4" />
                    <circle className="go-winrate-chart__point go-winrate-chart__point--white" cx={x} cy={yPosition(point.whiteWinRate)} r="3.4" />
                    <rect
                      className="go-winrate-chart__target"
                      x={Math.max(PLOT.left, x - targetWidth / 2)}
                      y={PLOT.top}
                      width={Math.min(targetWidth, WIDTH - PLOT.right - Math.max(PLOT.left, x - targetWidth / 2))}
                      height={PLOT_HEIGHT}
                      tabIndex={0}
                      role={onSelectMove ? 'button' : undefined}
                      aria-pressed={onSelectMove ? selectedMove === point.moveNumber : undefined}
                      onClick={() => onSelectMove?.(point.moveNumber)}
                      onKeyDown={(event) => {
                        if (onSelectMove && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectMove(point.moveNumber) }
                      }}
                      aria-label={`第 ${point.moveNumber} 手，黑方 ${percent(point.blackWinRate)}，白方 ${percent(point.whiteWinRate)}`}
                      onMouseEnter={() => setHoveredMove(point.moveNumber)}
                      onMouseLeave={() => setHoveredMove(null)}
                      onFocus={() => setHoveredMove(point.moveNumber)}
                      onBlur={() => setHoveredMove(null)}
                    />
                    {(hovered?.moveNumber === point.moveNumber || selectedMove === point.moveNumber) && (
                      <line className="go-winrate-chart__cursor" x1={x} x2={x} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} />
                    )}
                    {index === points.length - 1 && <circle className="go-winrate-chart__pulse" cx={x} cy={yPosition(point.blackWinRate)} r="7" />}
                  </g>
                )
              })}
            </>
          )}
        </svg>

        {hovered && (
          <div className="go-winrate-tooltip" role="tooltip">
            <b>第 {hovered.moveNumber} 手</b>
            <span>黑方 {percent(hovered.blackWinRate)}</span>
            <span>白方 {percent(hovered.whiteWinRate)}</span>
          </div>
        )}
        {points.length === 0 && status !== 'error' && <div className="go-winrate-chart__empty">WAITING FOR MOVE</div>}
      </div>

      <footer className="go-winrate-panel__footer">
        <span><i className="go-winrate-legend go-winrate-legend--black" />黑方</span>
        <span><i className="go-winrate-legend go-winrate-legend--white" />白方</span>
        <small>KataGo · {current?.requestedVisits ?? GO_WIN_RATE_ANALYSIS.requestedVisits} visits · 中国规则</small>
      </footer>
      {error && <p className="go-winrate-panel__error">{error}</p>}
    </section>
  )
}

function curvePath(
  points: readonly GoWinRatePoint[],
  maxMove: number,
  value: (point: GoWinRatePoint) => number,
): string {
  return points.map((point, index) => {
    const x = xPosition(point.moveNumber, maxMove)
    const y = yPosition(value(point))
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

function xPosition(moveNumber: number, maxMove: number): number {
  if (maxMove <= 1) return PLOT.left
  return PLOT.left + ((moveNumber - 1) / (maxMove - 1)) * PLOT_WIDTH
}

function yPosition(rate: number): number {
  return PLOT.top + (1 - rate) * PLOT_HEIGHT
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function statusLabel(status: GoWinRateAnalysisStatus): string {
  if (status === 'loading') return '引擎加载'
  if (status === 'analyzing') return '分析中'
  if (status === 'ready') return '实时'
  if (status === 'error') return '不可用'
  return '待分析'
}

function chartLabel(current: GoWinRatePoint | null): string {
  return current
    ? `胜率走势图，当前第 ${current.moveNumber} 手，黑方 ${percent(current.blackWinRate)}，白方 ${percent(current.whiteWinRate)}`
    : '胜率走势图，等待第一手落子'
}
