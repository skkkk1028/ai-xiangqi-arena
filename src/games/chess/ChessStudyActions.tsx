import { useEffect, useRef, useState } from 'react'
import type { useChessMatch } from './useChessMatch'
import type { ChessStudyEntry } from './ChessTemporaryStudy'
import { NotebookSave } from './NotebookSave'
import { chessNotebookDraft } from './notebook'
export function ChessStudyActions({match, onOpen}: {match: ReturnType<typeof useChessMatch>; onOpen: (entry: ChessStudyEntry) => void}) {
  const pending = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return <section className="chess-study-actions"><button disabled={busy} onClick={async () => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { const state = await match.suspendForStudy(); if (mounted.current) onOpen({state, source: '观战当前局面'}) }
    catch (reason) { if (mounted.current) setError(String(reason)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }}>{busy ? '正在暂停并等待稳定局面…' : '从当前局面练习'}</button>
  <NotebookSave getDraft={async () => chessNotebookDraft(await match.suspendForStudy(), {kind: 'live', label: '观战当前局面'})} />
  {error && <p role="alert">{error}</p>}</section>
}
