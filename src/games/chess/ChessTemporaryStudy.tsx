import { useEffect, useRef, useState } from 'react'
import { ChessBoard } from './ChessBoard'
import { ChessStudyEngine } from './study-engine'
import { ChessGameEngine, replayChessState, parseChessUci, isChessMoveAction, actionToUci } from './rules'
import { chessGuessSan } from './guess'
import { NotebookSave } from './NotebookSave'
import { chessNotebookDraft, type NotebookReference } from './notebook'
import { ChessMoveComparison } from './ChessMoveComparison'
import type { ChessAction, ChessColor, ChessGameState } from './types'

export interface ChessStudyEntry { state: ChessGameState; title?: string; source: string; note?: string; reference?: NotebookReference }
const rules = new ChessGameEngine()
export function ChessTemporaryStudy({ entry, onClose }: { entry: ChessStudyEntry; onClose: () => void }) {
  const [base, setBase] = useState(entry.state)
  const [state, setState] = useState(entry.state)
  const stateRef = useRef(state); stateRef.current = state
  const [human, setHuman] = useState<ChessColor>(entry.state.turn)
  const [mode, setMode] = useState<'browse' | 'retry' | 'challenge'>('browse')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [aiRetry, setAiRetry] = useState(0)
  const task = useRef<{ abort: AbortController; engine: ChessStudyEngine } | null>(null)
  const stop = () => {
    const previous = task.current; task.current = null
    previous?.abort.abort(); previous?.engine.dispose(); setBusy(false)
  }
  useEffect(() => () => { task.current?.abort.abort(); task.current?.engine.dispose(); task.current = null }, [])
  useEffect(() => {
    if (mode !== 'challenge' || state.result || state.turn === human) return
    const current = { abort: new AbortController(), engine: new ChessStudyEngine(true) }
    task.current = current; setBusy(true); setError('')
    void current.engine.search(state.initialFen, state.history.map((m) => m.uci), 'quick', 1, current.abort.signal).then((result) => {
      if (task.current !== current || current.abort.signal.aborted) return
      const move = result.response.bestmove && parseChessUci(result.response.bestmove)
      const legal = move && rules.getLegalActions(state).filter(isChessMoveAction).find((a) => rules.actionsEqual(a, move))
      if (!legal) throw new Error('引擎返回非法着法。')
      const next = rules.executeAction(state, legal); stateRef.current = next; setState(next)
    }).catch((reason) => { if (task.current === current && !current.abort.signal.aborted) setError(String(reason)) })
      .finally(() => { current.engine.dispose(); if (task.current === current) { task.current = null; setBusy(false) } })
    return () => { current.abort.abort(); current.engine.dispose(); if (task.current === current) task.current = null }
  }, [state, mode, human, aiRetry])
  const answered = mode === 'retry' && state.history.length > base.history.length
  const play = (action: ChessAction) => {
    const at = stateRef.current
    if (task.current || at.result || mode === 'browse' || (mode === 'retry' && at.history.length > base.history.length) || (mode === 'challenge' && at.turn !== human)) return
    if (mode === 'retry' && !isChessMoveAction(action)) return
    const legal = rules.getLegalActions(at).find((a) => rules.actionsEqual(a, action))
    if (!legal) return
    const next = rules.executeAction(at, legal); stateRef.current = next; setState(next); setRevision((r) => r + 1)
  }
  const restart = () => { stop(); setBase(entry.state); setState(entry.state); stateRef.current = entry.state; setHuman(entry.state.turn); setMode('browse'); setRevision((r) => r + 1); setError(''); setReferenceOpen(false) }
  const ignoreClaim = () => {
    stop()
    const restored = replayChessState(base.history.map((m) => m.uci), {initialFen: base.initialFen, seed: base.seed, openingId: base.openingId, openingName: base.openingName})
    setBase(restored); setState(restored); stateRef.current = restored; setMode('browse'); setRevision((r) => r + 1)
  }
  const san = (uci?: string) => { const move = uci && parseChessUci(uci); return move ? `${chessGuessSan(entry.state, move)} · ${uci}` : '无' }
  return <main className="chess-page chess-study-page chess-temporary-study">
    <header className="chess-header"><h1>{entry.title ?? '临时局面练习'}</h1><button onClick={() => { stop(); onClose() }}>返回来源</button></header>
    <p>{entry.source} · 练习分支不会自动保存，可收藏当前局面。分析仅保留在本次页面。</p>
    <section className="chess-study-content"><div className="chess-study-board">
      <ChessBoard state={state} interactive={mode !== 'browse'} humanColor={mode === 'retry' ? base.turn : human} disabled={busy || answered || Boolean(state.result) || mode === 'challenge' && state.turn !== human} onMove={play} interactionKey={`${mode}-${revision}`} />
      <p>{state.turn === 'w' ? '白' : '黑'}方行棋 · 已走 {state.history.length} 手{state.result ? ` · 已结束：${state.result.reason}` : ''}</p>
      <NotebookSave key={state.fen + String(state.result?.reason)} draft={chessNotebookDraft(state, {kind: 'practice', label: entry.source})} beforeOpen={() => { stop(); setMode('browse') }} />
    </div><aside className="chess-study-panel">
      <label>执子<select disabled={mode !== 'browse' || busy} value={human} onChange={(e) => setHuman(e.target.value as ChessColor)}><option value="w">白方</option><option value="b">黑方</option></select></label>
      {mode === 'browse' && !state.result && <><button onClick={() => { setState(base); stateRef.current = base; setMode('retry'); setRevision((r) => r + 1) }}>重走一手</button><button onClick={() => setMode('challenge')}>开始练习</button></>}
      {state.result?.termination === 'claim' && mode === 'browse' && <button onClick={ignoreClaim}>忽略和棋声明并练习</button>}
      {state.result && state.result.termination !== 'claim' && <p>此局面只读，请返回更早的局面练习。</p>}
      {answered && <><p>本次作答：{state.lastMove?.san}。不会自动搜索。</p>
        <ChessMoveComparison key={revision} before={base} selected={state.lastMove!.uci} reference={entry.reference?.actual} label="分析这一手" />
        <button onClick={() => { setState(base); stateRef.current = base; setRevision((r) => r + 1) }}>重新作答</button>
        <button disabled={Boolean(state.result)} onClick={() => { setHuman(base.turn); setMode('challenge') }}>继续挑战</button></>}
      {mode === 'challenge' && !state.result && state.turn === human && rules.getLegalActions(state).filter((a) => !isChessMoveAction(a)).map((a, i) => <button key={i} onClick={() => play(a)}>申请{a.reason === 'threefold-repetition' ? '三次重复' : '五十回合'}和棋{a.intendedMove ? `（${actionToUci(a.intendedMove)}）` : ''}</button>)}
      {busy && <p role="status">Stockfish 18 思考中…</p>}
      {busy && <button onClick={() => { stop(); setMode('browse') }}>停止练习</button>}
      {error && <><p role="alert">{error}</p><button onClick={() => setAiRetry((r) => r + 1)}>重试 AI 应手</button></>}
      <button onClick={restart}>重新开始本局面</button>
      <button onClick={() => setReferenceOpen((v) => !v)}>{referenceOpen ? '收起参考' : '查看参考'}</button>
      {referenceOpen && <div><p>历史参考，不是唯一正确答案。</p><p>原猜招：{san(entry.reference?.guessed)}</p><p>实战着：{san(entry.reference?.actual)} · {entry.reference?.description}</p><p>{entry.note}</p></div>}
      <p>Stockfish 18 · PV1 · 每手最多 3 秒 · 64 MB Hash · 无棋钟。</p>
    </aside></section>
  </main>
}
