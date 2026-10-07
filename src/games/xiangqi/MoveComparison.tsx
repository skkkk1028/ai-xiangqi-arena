import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ENGINE_ID, engineRegistry } from '../../engine/default-registry'
import { detectEngineSupport } from '../../engine/support'
import type { EngineAdapter } from '../../engine/adapter'
import type { XiangqiGameState } from './game-engine'
import { compareReviewMoves, scoreText, type MoveComparisonResult, type MoveReview } from './review'

export function MoveComparison({ before, userUcci, referenceUcci, label = '分析这一手' }: {
  before: XiangqiGameState; userUcci: string; referenceUcci?: string; label?: string
}) {
  const key = JSON.stringify([before.history.map((move) => move.ucci), userUcci, referenceUcci])
  const [result, setResult] = useState<{ key: string; value: MoveComparisonResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const adapter = useRef<EngineAdapter | null>(null)
  const generation = useRef(0)
  const pending = useRef(false)
  const resultRef = useRef<typeof result>(null)
  const stop = () => {
    generation.current++; adapter.current?.dispose(); adapter.current = null; pending.current = false; setBusy(false)
  }
  useEffect(() => {
    setResult(null); resultRef.current = null; setError(''); setBusy(false)
    return () => { generation.current++; adapter.current?.dispose(); adapter.current = null; pending.current = false }
  }, [key])
  const analyze = async (refresh = false) => {
    if (pending.current || (!refresh && resultRef.current?.key === key)) return
    pending.current = true; setBusy(true); setError('')
    if (refresh) { setResult(null); resultRef.current = null }
    const token = ++generation.current
    const assertCurrent = () => { if (token !== generation.current) throw new DOMException('分析已取消。', 'AbortError') }
    try {
      const support = detectEngineSupport()
      if (!support.supported) throw new Error(support.reason ?? '当前浏览器不支持分析引擎。')
      const engine = engineRegistry.createEngine('xiangqi', DEFAULT_ENGINE_ID, { assetBase: document.baseURI, onProgress: () => undefined }, { threads: 1, hash: 64 })
      adapter.current = engine
      await engine.init(); assertCurrent()
      const value = await compareReviewMoves(engine, before, userUcci, referenceUcci, assertCurrent)
      assertCurrent(); const completed = { key, value }; resultRef.current = completed; setResult(completed)
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (token === generation.current) { adapter.current?.dispose(); adapter.current = null; pending.current = false; setBusy(false) } }
  }
  const completed = result?.key === key ? result.value : null
  return <section aria-label="按需着法比较">
    <button disabled={busy || Boolean(completed)} onClick={() => void analyze()}>{label}</button>
    {completed && <button disabled={busy} onClick={() => void analyze(true)}>重新分析</button>}
    {busy && <><button onClick={stop}>停止分析</button><p role="status">正在独立分析，最多搜索三个局面…</p></>}
    {error && <p role="alert">分析失败：{error}。局面与竞猜成绩保留，可以重试。</p>}
    {completed && <div className="review-evidence">
      <p>点评引擎：Fairy-Stockfish · 1 线程 / 64 MB · 每次搜索 1.5 秒。有限搜索估计，评价以本手行棋方为正。</p>
      <p>最佳候选：{completed.user.bestNotation}（{scoreText(completed.user.bestScore)}）· 深度 {completed.user.depth}</p>
      <Evidence title="你的走法" review={completed.user} />
      {completed.reference && <Evidence title="参考着法" review={completed.reference} />}
      <p>合法参考变化：{completed.user.variation.join(' → ') || '暂无可用变化'}。合法变化不等于已证明强制。</p>
    </div>}
  </section>
}
function Evidence({ title, review }: { title: string; review: MoveReview }) {
  return <div><strong>{title}：{review.playedNotation}（{scoreText(review.playedScore)}）· 深度 {review.playedDepth || '规则终局'}</strong>
    <p>{review.comparison === 'same-root' ? '同根同深度候选比较（直接终局按规则裁定）' : '落子后补搜估计，深度可能不同'}</p>
    {review.notes.map((note, i) => <p key={i}>{note}</p>)}
  </div>
}
