import { useEffect, useRef, useState } from 'react'
import { GoStudyPage } from './GoStudyPage'
import { downloadNotebook, NOTEBOOK_CATEGORIES, goNotebook, type NotebookEntry } from './notebook'
import './notebook.css'

export function NotebookPage({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<NotebookEntry[]>([])
  const [selected, setSelected] = useState<NotebookEntry | null>(null)
  const [editing, setEditing] = useState<NotebookEntry | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const refresh = async () => setEntries(await goNotebook.list())
  useEffect(() => { let active = true; void goNotebook.list().then((items) => { if (active) setEntries(items) }, (reason) => { if (active) setError(String(reason)) }); return () => { active = false } }, [])
  const run = async (job: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await job(); await refresh() } catch (reason) { setError(String(reason)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  if (selected) {
    return <GoStudyPage key={selected.id} game={{ id: selected.id, title: selected.title, favorite: false, archive: selected.archive, mode: selected.source.label, configuration: {} }} entry={{initialIndex: selected.archive.moves.length, note: selected.note, reference: selected.reference}} onClose={() => setSelected(null)} onOpen={() => undefined} />
  }
  return <main className="go-notebook">
    <header><h1>个人练习本 · 围棋</h1><button disabled={busy} onClick={onClose}>返回围棋</button></header>
    <p>只在本机保存收藏局面、备注和参考着法。练习进度与分析不会长期保存；请用 JSON 导出备份。</p>
    <div className="go-notebook-tools"><label>搜索<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题或备注" /></label>
      <label>筛选分类<select value={category} onChange={(event) => setCategory(event.target.value)}>{['全部', ...NOTEBOOK_CATEGORIES].map((c) => <option key={c}>{c}</option>)}</select></label>
      <button onClick={() => { try { downloadNotebook(entries) } catch (reason) { setError(String(reason)) } }}>导出全部</button>
      <label>导入 JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void run(async () => { if (file.size > 10 * 1024 * 1024) throw new Error('导入文件最多 10 MB。'); const result = await goNotebook.import(await file.text()); setMessage(`已导入 ${result.added} 条，跳过重复 ${result.skipped} 条。`) })
      }} /></label><button disabled={busy} onClick={() => void run(async () => {})}>重新读取</button></div>
    {busy && <p role="status">正在保存或读取练习本…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}。已有收藏和编辑内容保留，可重试。</p>}
    {editing && <form aria-label="编辑收藏" onSubmit={(event) => { event.preventDefault(); void run(async () => { await goNotebook.update(editing); setEditing(null) }) }}>
      <label>标题<input required maxLength={120} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
      <label>备注<textarea maxLength={4000} value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} /></label>
      <label>分类<select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as NotebookEntry['category'] })}>{NOTEBOOK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button disabled={busy}>保存修改</button><button type="button" onClick={() => { try { downloadNotebook([editing]) } catch (reason) { setError(String(reason)) } }}>导出编辑内容</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>取消编辑</button>
    </form>}
    <div className="go-notebook-list">{entries.filter((e) => (category === '全部' || e.category === category) && `${e.title} ${e.note}`.toLowerCase().includes(query.toLowerCase())).map((entry) => <article key={entry.id}>
      <h2>{entry.title}</h2><p>{entry.category} · 已走 {entry.archive.moves.length} 手 · {entry.source.label}</p>
      <button disabled={busy} onClick={() => setSelected(entry)}>打开局面</button><button disabled={busy} onClick={() => setEditing(entry)}>编辑</button>
      <button onClick={() => downloadNotebook([entry])}>导出 JSON</button><button disabled={busy} onClick={() => { if (window.confirm(`删除收藏“${entry.title}”？`)) void run(() => goNotebook.remove(entry.id)) }}>删除</button>
    </article>)}</div>
    {!entries.length && <p>还没有收藏。可在观战、竞猜揭晓或复盘中收藏局面。</p>}
  </main>
}
