import { useEffect, useRef, useState } from 'react'
import type { BoardState, Color } from '../game/types'
import { positionKey } from '../game/board'
import { formatMove } from '../game/notation'
import { moveToUcci } from '../engine/ucci'
import type { SearchResult } from '../ai/search'
import './search-comparison.css'

export function SearchComparison({ board, turn, paused }: { board: BoardState; turn: Color; paused: boolean }) {
  const identity = positionKey(board, turn)
  const [enabled, setEnabled] = useState(true)
  const [depth, setDepth] = useState(3)
  const [results, setResults] = useState<Partial<Record<'on' | 'off', SearchResult>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const stop = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false) }
  useEffect(() => {
    generation.current++; worker.current?.terminate(); worker.current = null
    setBusy(false); setResults({}); setError('')
    return () => { generation.current++; worker.current?.terminate(); worker.current = null }
  }, [identity, depth, paused])
  const run = () => {
    if (!paused || worker.current) return
    const token = ++generation.current
    const mode = enabled ? 'on' : 'off'
    setError(''); setBusy(true)
    setResults((old) => ({ ...old, [mode]: undefined }))
    try {
      const next = new Worker(new URL('../ai/comparison.worker.ts', import.meta.url), { type: 'module' })
      worker.current = next
      next.onmessage = ({ data }: MessageEvent<{ result?: SearchResult; error?: string }>) => {
        if (token !== generation.current) return
        if (data.result) setResults((old) => ({ ...old, [mode]: data.result }))
        else setError(data.error ?? '搜索失败。')
        stop()
      }
      next.onerror = () => { if (token === generation.current) { setError('搜索 Worker 失败，请重试。'); stop() } }
      next.postMessage({ board, turn, depth, enabled })
    } catch (reason) { setError(String(reason)); stop() }
  }
  const complete = results.on?.depth === depth && results.off?.depth === depth
  const sameMove = results.on?.move && results.off?.move ? moveToUcci(results.on.move) === moveToUcci(results.off.move) : results.on?.move === results.off?.move
  return <section className="search-comparison" aria-label="当前局面搜索对比">
    <h3>当前局面搜索对比</h3>
    <p>自研 alpha-beta 实验；此开关不控制正式对战引擎。请先暂停对局。</p>
    <div className="search-comparison-controls">
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />置换表 {enabled ? '开' : '关'}</label>
      <label>固定深度 <select aria-label="对比搜索深度" value={depth} disabled={busy} onChange={(event) => setDepth(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
      <button disabled={!paused || busy} onClick={run}>{busy ? '搜索中…' : '搜索当前局面'}</button>
      {busy && <button onClick={stop}>停止搜索</button>}
    </div>
    <div className="search-comparison-table"><table><thead><tr><th>置换表</th><th>深度</th><th>节点数</th><th>耗时</th><th>最佳走法 / 分数</th></tr></thead><tbody>
      {(['on', 'off'] as const).map((mode) => { const value = results[mode]; return <tr key={mode}><th>{mode === 'on' ? '开' : '关'}</th><td>{value ? `${value.depth}/${depth}` : '—'}</td><td>{value?.nodes.toLocaleString() ?? '—'}</td><td>{value ? `${value.elapsedMs.toFixed(1)} ms` : '—'}</td><td>{value ? `${value.move ? formatMove(value.move) : '无合法走法'} / ${value.score}` : '—'}</td></tr> })}
    </tbody></table></div>
    {complete && <p role="status">{results.off!.nodes > 0 ? `节点减少 ${((1 - results.on!.nodes / results.off!.nodes) * 100).toFixed(1)}%` : '无搜索节点'} · 最佳走法{sameMove ? '一致' : '不一致'} · 分数{results.on!.score === results.off!.score ? '一致' : '不一致'}</p>}
    {Object.values(results).some((value) => value?.move && value.depth < depth) && <p role="status">搜索未完成目标深度（每次最多 15 秒），不能据此比较收益。可降低深度后重试。</p>}
    {error && <p role="alert">{error}</p>}
    <small>切换开关后再次搜索即可对比；局面、深度或暂停状态变化会清空结果。固定种子、独立空表，节点包含静态搜索与重搜；耗时随设备负载变化。实验关闭减深、将军延伸和路径重复启发式，不用于正式对局裁定。</small>
  </section>
}
