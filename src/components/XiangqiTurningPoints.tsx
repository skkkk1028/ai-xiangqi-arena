import { useMemo, useState } from 'react'
import type { MoveRecord } from '../game/types'
import { DEFAULT_TURNING_THRESHOLDS, findTurningPoints, historyEvaluations, topTurningPoints, turningPointLabel, turningPointReport } from '../games/xiangqi/turning-points'

export function XiangqiTurningPoints({ history, index, onNavigate }: { history: readonly MoveRecord[]; index: number; onNavigate: (index: number) => void }) {
  const [thresholds, setThresholds] = useState(DEFAULT_TURNING_THRESHOLDS)
  const [reportOpen, setReportOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const evaluations = useMemo(() => historyEvaluations(history), [history])
  const points = useMemo(() => findTurningPoints(history, evaluations, thresholds), [history, evaluations, thresholds])
  const top = topTurningPoints(points)
  const report = turningPointReport(history, points, thresholds)
  const x = (position: number) => 38 + position / Math.max(1, history.length - 1) * 524
  const cpMax = Math.max(300, ...evaluations.map((point) => Math.abs(point.redCp ?? 0)))
  const cpY = (value: number) => 95 - value / cpMax * 65
  const winY = (value: number) => 270 - value * 0.9
  const path = (get: (point: typeof evaluations[number]) => number | null, y: (value: number) => number) => {
    let connected = false
    return evaluations.map((point) => {
      const value = get(point)
      if (value === null) { connected = false; return '' }
      const command = `${connected ? 'L' : 'M'}${x(point.index)},${y(value)}`
      connected = true
      return command
    }).join(' ')
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(report); setCopyStatus('战报已复制。') }
    catch { setCopyStatus('复制失败，请选中下方战报手动复制。') }
  }
  return <section className="turning-points">
    <h2>本局 Top3 转折点</h2>
    <p className="review-muted">红线：红方；蓝线：黑方。红点：失误；绿点：妙手（待复核）。每步指一个半回合，点击标记查看落子后局面。</p>
    <label className="review-slider">掉分阈值：{thresholds.cp} 分<input aria-label="掉分阈值" type="range" min="50" max="2000" step="10" value={thresholds.cp} onChange={(event) => { setThresholds({ ...thresholds, cp: Number(event.target.value) }); setCopyStatus(''); setHovered(null) }} /></label>
    <label className="review-slider">胜率阈值：{thresholds.winRate} 个百分点<input aria-label="胜率阈值" type="range" min="5" max="50" step="1" value={thresholds.winRate} onChange={(event) => { setThresholds({ ...thresholds, winRate: Number(event.target.value) }); setCopyStatus(''); setHovered(null) }} /></label>
    <svg viewBox="0 0 600 305" className="turning-chart" aria-label="双方历史评分和胜率曲线">
      <text x="10" y="18">双方评分（分） ±{cpMax}</text>
      <text x="10" y="175">胜率（WDL 胜局比例，0–100%）</text>
      <path d="M38 30V160H562 M38 95H562 M38 180V270H562 M38 225H562" className="turning-grid" />
      <path d={path((p) => p.redCp, cpY)} className="turning-red" />
      <path d={path((p) => p.redCp === null ? null : -p.redCp, cpY)} className="turning-black" />
      <path d={path((p) => p.redWin, winY)} className="turning-red" />
      <path d={path((p) => p.blackWin, winY)} className="turning-black" />
      {index < history.length && <path d={`M${x(index)} 28V275`} className="turning-cursor" />}
      {points.map((point) => {
        const label = turningPointLabel(point)
        const after = evaluations[point.index + 1]
        return <g key={point.index}>
          {[cpY(after.redCp! * (point.color === 'red' ? 1 : -1)), winY(point.color === 'red' ? after.redWin! : after.blackWin!)].map((y, chart) => <circle key={chart} cx={x(point.index + 1)} cy={y} r="7" className={`turning-marker turning-marker--${point.kind}`} role="button" tabIndex={0} aria-label={`${chart === 0 ? '评分' : '胜率'}标记：${label}`} onClick={() => onNavigate(point.index + 1)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate(point.index + 1) } }} onMouseEnter={() => setHovered(label)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(label)} onBlur={() => setHovered(null)}><title>{label}</title></circle>)}
        </g>
      })}
      <text x="38" y="294">初始</text><text x="462" y="294">第 {Math.max(0, history.length - 1)} 步后</text>
    </svg>
    {hovered && <p role="tooltip">{hovered}</p>}
    <p aria-live="polite">共 {points.length} 个转折点</p>
    <ol className="turning-top">{top.map((point) => <li key={point.index}><button onClick={() => onNavigate(point.index + 1)}>{turningPointLabel(point)}</button></li>)}</ol>
    {!points.length && <p>当前阈值下无可标注转折，或相邻评分 / WDL 不足。</p>}
    <p className="review-muted">仅只读原局记录，不启动分析。相邻搜索换算为走棋方视角后比较，两个阈值须同时满足。缺分处断线，将杀分与末手不判定。跨引擎、深度变化可能造成波动；对手失误不归为己方妙手，绿点仅表示本人落子后评价上升，需复核。</p>
    <button onClick={() => { setReportOpen(true); setCopyStatus('') }}>一键生成文字战报</button>
    {reportOpen && <div className="turning-report"><textarea aria-label="文字战报" readOnly value={report} rows={7} /><button onClick={() => void copy()}>复制战报</button><p role="status">{copyStatus}</p></div>}
  </section>
}
