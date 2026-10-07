import { useEffect, useRef, useState } from 'react'
import { compareChessMoves, comparisonDifference, type ChessMoveComparisonResult, type MoveEvidence } from './move-comparison'
import { STUDY_BUDGET_MS, type StudyTier } from './study-engine'
import { pvToSan } from './analysis'
import type { ChessGameState } from './types'
export function ChessMoveComparison({before, selected, reference, label = '分析我的猜招'}: {before: ChessGameState; selected: string; reference?: string; label?: string}) {
  const identity = JSON.stringify([before.initialFen, before.history.map((m) => m.uci), selected, reference])
  return <ComparisonSession key={identity} before={before} selected={selected} reference={reference} label={label} />
}
function ComparisonSession({before, selected, reference, label}: {before: ChessGameState; selected: string; reference?: string; label: string}) {
  const [result, setResult] = useState<ChessMoveComparisonResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  const cache = useRef(new Map<StudyTier, ChessMoveComparisonResult>())
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  const run = async (tier: StudyTier, refresh = false) => {
    if (active.current) return
    const cached = cache.current.get(tier)
    if (cached && !refresh) { setResult(cached); return }
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(''); setResult(null)
    try {
      const value = await compareChessMoves(before, selected, reference, tier, controller.signal)
      if (active.current === controller && !controller.signal.aborted) { cache.current.set(tier, value); setResult(value) }
    } catch (reason) { if (active.current === controller && !controller.signal.aborted) setError(String(reason)) }
    finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  const stop = () => { active.current?.abort(); active.current = null; setBusy(false); setError('分析已停止，可重新分析。') }
  const evidence = (name: string, item: MoveEvidence) => {
    const difference = comparisonDifference(item, result?.best)
    return <div><strong>{name}：{item.san} · {item.uci}</strong><p>{item.method === 'root' ? '同根同深度候选比较' : item.method === 'after' ? '落子后补搜估计（深度可能不同）' : '规则终局'} · 深度 {item.depth}</p>
      <p>{item.terminal ?? (item.score ? item.score.kind === 'mate' ? `将杀 ${item.score.value}` : `${(item.score.value / 100).toFixed(2)} 兵` : '无有效评分')} · {difference === null ? '无法可靠比较损失' : `相对推荐 ${difference.toFixed(2)} 兵${item.method === 'after' ? '（估计）' : ''}`}</p>
      <p>合法变化：{pvToSan(before.fen, item.pv)}</p>
      {item.search && <p>耗时 {item.search.elapsedMs} ms · {item.search.timedOut ? '超出预算' : '已完成'}{item.search.engine.fallback ? ' · 后端回退' : ''}</p>}</div>
  }
  return <section aria-label="按需两招比较"><button disabled={busy} onClick={() => void run('quick')}>{label}</button>
    <button disabled={busy} onClick={() => void run(result?.tier ?? 'quick', true)}>重新分析</button><button disabled={busy} onClick={() => void run('deep', true)}>加深分析（每次 10 秒）</button>
    {busy && <><p role="status">独立分析中，最多三次搜索…</p><button onClick={stop}>停止分析</button></>}
    {error && <p role="status">{error}</p>}
    {result && <div><p>{result.root.engine.name} · {result.root.engine.version} · {result.root.engine.backend} · {result.root.engine.threads} 线程 · Hash {result.root.engine.hashMb} MB · 每次预算 {STUDY_BUDGET_MS[result.tier]} ms</p>
      <p>评价为出题方（{before.turn === 'w' ? '白' : '黑'}方）视角。分析不修改竞猜成绩。</p>
      {result.best && evidence('推荐', result.best)}{evidence('你的着法', result.selected)}{result.reference && evidence('历史参考', result.reference)}</div>}
  </section>
}
