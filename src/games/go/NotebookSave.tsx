import { useEffect, useRef, useState } from 'react'
import { createNotebookEntry, downloadNotebook, NOTEBOOK_CATEGORIES, goNotebook, type NotebookDraft, type NotebookEntry } from './notebook'
import './notebook.css'

export function NotebookSave({ draft, getDraft, label = '收藏局面', beforeOpen }: {
  draft?: NotebookDraft; getDraft?: () => Promise<NotebookDraft>; label?: string; beforeOpen?: () => void
}) {
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [entry, setEntry] = useState<NotebookEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const open = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setMessage('')
    try { beforeOpen?.(); const source = getDraft ? await getDraft() : draft; if (source && mounted.current) setEntry(createNotebookEntry(source)) }
    catch (reason) { setError(String(reason)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <section className="go-notebook-save">
    <button disabled={busy} onClick={() => void open()}>{label}</button>
    {entry && <form aria-label="收藏局面信息" onSubmit={async (event) => {
      event.preventDefault(); if (busyRef.current) return
      busyRef.current = true; setBusy(true); setError('')
      try { const saved = await goNotebook.save(entry); setMessage(saved.id === entry.id ? '已收藏到个人练习本。' : '该局面已收藏，已有备注保留。'); setEntry(null) }
      catch (reason) { setError(`保存失败：${String(reason)}。可以重试或导出当前条目。`) }
      finally { busyRef.current = false; setBusy(false) }
    }}>
      <label>标题<input required maxLength={120} value={entry.title} onChange={(event) => setEntry({ ...entry, title: event.target.value })} /></label>
      <label>备注<textarea maxLength={4000} value={entry.note} onChange={(event) => setEntry({ ...entry, note: event.target.value })} /></label>
      <label>分类<select value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value as NotebookEntry['category'] })}>{NOTEBOOK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button disabled={busy}>保存收藏</button><button type="button" onClick={() => { try { downloadNotebook([entry]) } catch (reason) { setError(String(reason)) } }}>导出当前条目</button>
      <button type="button" disabled={busy} onClick={() => setEntry(null)}>关闭收藏表单</button>
    </form>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
