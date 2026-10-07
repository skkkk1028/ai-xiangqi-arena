import { useEffect, useMemo, useRef, useState } from 'react'
import { ChessBoard } from '../../components/ChessBoard'
import { DEFAULT_ENGINE_ID, engineRegistry } from '../../engine/default-registry'
import type { EngineAdapter } from '../../engine/adapter'
import { detectEngineSupport } from '../../engine/support'
import { moveToUcci, sideLabel } from '../../engine/ucci'
import type { Color, Position } from '../../game/types'
import { XiangqiGameEngine } from './game-engine'
import { reviewPositions, REVIEW_TIME_MS } from './review'
import { NotebookSave } from './NotebookSave'
import { PRACTICE_OPENINGS, playOpening, retryOpening, startOpening, type OpeningSession } from './opening-practice'
import '../../components/xiangqi-review.css'
import './opening-practice.css'

const game = new XiangqiGameEngine()
export function OpeningPracticePage({ onClose }: { onClose: () => void }) {
  const [openingId, setOpeningId] = useState(PRACTICE_OPENINGS[0].id)
  const opening = PRACTICE_OPENINGS.find((item) => item.id === openingId)!
  const [branchId, setBranchId] = useState(opening.branches[0].id)
  const branch = opening.branches.find((item) => item.id === branchId)!
  const positions = useMemo(() => reviewPositions([...branch.moves]), [branch])
  const [cursor, setCursor] = useState(0)
  const [human, setHuman] = useState<Color>('red')
  const [session, setSession] = useState<OpeningSession | null>(null)
  const sessionRef = useRef(session)
  const [reference, setReference] = useState(false)
  const [selected, setSelected] = useState<Position | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const adapter = useRef<EngineAdapter | null>(null)
  const generation = useRef(0)
  const update = (next: OpeningSession | null) => { sessionRef.current = next; setSession(next); setSelected(null) }
  const cancel = () => {
    generation.current += 1
    adapter.current?.stop('开局练习已暂停。'); adapter.current?.dispose(); adapter.current = null
    busyRef.current = false; setBusy(false); setProgress('')
  }
  useEffect(() => () => { generation.current += 1; adapter.current?.dispose(); adapter.current = null }, [])

  const reply = async (current: OpeningSession) => {
    if (busyRef.current || current.phase !== 'live' || current.position.result || current.position.turn === current.human) return
    const token = ++generation.current
    busyRef.current = true; setBusy(true); setError(''); setProgress('练习对手正在思考…')
    try {
      if (!adapter.current) {
        const support = detectEngineSupport()
        if (!support.supported) throw new Error(support.reason ?? '浏览器不支持练习引擎。')
        adapter.current = engineRegistry.createEngine('xiangqi', DEFAULT_ENGINE_ID, {
          assetBase: document.baseURI,
          onProgress: (event) => { if (generation.current === token) setProgress(event.message) },
        }, { threads: 1, hash: 64 })
        await adapter.current.init()
      }
      if (generation.current !== token) return
      const result = await adapter.current!.search(current.position.history.map((move) => move.ucci), REVIEW_TIME_MS, { multiPv: 1 })
      if (generation.current !== token) return
      const action = result.bestmove && game.findLegalActionByUcci(current.position, result.bestmove)
      if (!action) throw new Error('练习引擎未返回合法着法，请重试。')
      const position = game.executeAction(current.position, action)
      update({ ...current, position, phase: position.result ? 'finished' : 'live' })
    } catch (reason) {
      if (generation.current === token) {
        setError(reason instanceof Error ? reason.message : '练习引擎搜索失败。')
        adapter.current?.dispose(); adapter.current = null
      }
    } finally {
      if (generation.current === token) { busyRef.current = false; setBusy(false); setProgress('') }
    }
  }
  const current = !session || reference ? positions[cursor] : session.position
  const canPlay = Boolean(session && !reference && !busy && ['book', 'live'].includes(session.phase) && current.turn === session.human && !current.result)
  const legal = canPlay ? game.getLegalActions(current) : []
  const targets = selected ? legal.filter((move) => move.from.row === selected.row && move.from.col === selected.col).map((move) => move.to) : []
  const click = (point: Position) => {
    const active = sessionRef.current
    if (!active || !canPlay || busyRef.current) return
    const action = selected && game.getLegalActions(active.position).find((move) => move.from.row === selected.row && move.from.col === selected.col && move.to.row === point.row && move.to.col === point.col)
    if (!action) { setSelected(current.board[point.row][point.col]?.color === active.human ? point : null); return }
    const next = playOpening(active, moveToUcci(action))
    update(next); void reply(next)
  }
  const showReference = () => {
    cancel(); setSelected(null); setError('')
    setCursor(session!.deviationPly ?? Math.min(session!.position.history.length, branch.moves.length)); setReference(true)
  }
  const navigate = (ply: number) => { setCursor(ply); setSelected(null) }
  const status = !session ? '选择分支和起点' : ({ book: '沿谱练习', deviated: '已偏离所选分支', 'book-end': '本分支已走完', live: 'AI 实战', finished: '练习已结束' })[session.phase]

  return <main className="xiangqi-review opening-practice">
    <header className="review-header"><div><p>中国象棋 · 示范变化</p><h1>开局练习</h1></div><button onClick={() => { cancel(); onClose() }}>返回首页</button></header>
    <div className="review-layout">
      <section className="review-board">
        <h2>{reference ? '原谱浏览' : status} · 已走 {current.history.length} 手</h2>
        <ChessBoard board={current.board} turn={current.turn} lastMove={current.lastMove} checkColor={current.checkColor} paused={false} interactive={canPlay} selected={selected} legalTargets={targets} onSquareClick={click} />
        {(!session || reference) && <>
          <nav className="review-controls" aria-label="原谱步进"><button disabled={cursor === 0} onClick={() => navigate(0)}>初始局面</button><button disabled={cursor === 0} onClick={() => navigate(cursor - 1)}>上一步</button><button disabled={cursor === branch.moves.length} onClick={() => navigate(cursor + 1)}>下一步</button><button disabled={cursor === branch.moves.length} onClick={() => navigate(branch.moves.length)}>最后局面</button></nav>
          <p>当前为第 {cursor} 手后的局面 · {sideLabel(current.turn)}行棋</p>
          <p>原谱下一手：{positions[cursor + 1]?.lastMove ? positions[cursor + 1].history.at(-1)!.notation : '已到原谱末尾'}</p>
        </>}
        {current.result && <p role="status">{current.result.winner ? `${sideLabel(current.result.winner)}获胜` : '和棋'} · {current.result.reason === 'checkmate' ? '将死' : current.result.reason === 'stalemate' ? '困毙' : '简化和棋裁定'}</p>}
        <NotebookSave key={`${opening.id}:${branch.id}:${session ? 'practice' : 'preview'}:${reference}`} draft={{ moves: current.history.map((move) => move.ucci), source: { kind: 'practice', label: `${opening.name} · ${branch.name}` } }} />
      </section>
      <aside className="review-sidebar">
        <section><h2>选择开局与分支</h2>
          <label>开局<select aria-label="开局" value={openingId} disabled={Boolean(session)} onChange={(event) => { const next = PRACTICE_OPENINGS.find((item) => item.id === event.target.value)!; setOpeningId(next.id); setBranchId(next.branches[0].id); navigate(0) }}>{PRACTICE_OPENINGS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>分支<select aria-label="分支" value={branchId} disabled={Boolean(session)} onChange={(event) => { setBranchId(event.target.value); navigate(0) }}>{opening.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <p>{branch.description}</p>
          <label>执子<select aria-label="练习执子" value={human} disabled={Boolean(session)} onChange={(event) => setHuman(event.target.value as Color)}><option value="red">红方</option><option value="black">黑方</option></select></label>
          {!session && <div className="review-controls"><button onClick={() => { update(startOpening(branch, cursor, human)); setError('') }}>从此局面开始</button></div>}
        </section>
        {session && <section><h2 role="status">{status}</h2><p>你执{sideLabel(session.human)} · 起点：第 {session.startPly} 手后</p>
          {session.phase === 'deviated' && <p>你的着法与所选分支不同；这不代表走错。当前着法已保留，对手暂停应手。</p>}
          <div className="review-controls">
            {reference ? <button onClick={() => { setReference(false); setError(''); void reply(sessionRef.current!) }}>返回练习</button> : <button onClick={showReference}>查看原谱</button>}
            {!reference && ['deviated', 'book-end'].includes(session.phase) && <button onClick={() => { const next = { ...sessionRef.current!, phase: 'live' as const }; update(next); void reply(next) }}>继续实战</button>}
            {session.deviationPly !== null && <button onClick={() => { cancel(); update(retryOpening(sessionRef.current!)); setReference(false); setError('') }}>回到偏离前重走</button>}
            <button onClick={() => { cancel(); update(null); setReference(false); navigate(session.startPly); setError('') }}>重新选择</button>
            {!reference && error && session.phase === 'live' && <button disabled={busy} onClick={() => void reply(sessionRef.current!)}>重试 AI 应手</button>}
          </div>
          {session.deviationPly !== null && <p className="review-muted">“回到偏离前重走”会撤销第 {session.deviationPly + 1} 手及其后的全部练习着法。</p>}
          {busy && <p role="status">{progress || '练习对手正在思考…'}</p>}{error && <p role="alert">{error}</p>}
          <p>练习记录：{session.position.history.slice(session.startPly).map((move) => move.notation).join(' → ') || '等待落子'}</p>
        </section>}
        {(!session || reference) && <section><h2>原谱 · {branch.moves.length} 手</h2><ol className="review-moves">{positions.slice(1).map((position, index) => <li key={index}><button aria-current={cursor === index + 1 ? 'step' : undefined} onClick={() => navigate(index + 1)}>{index + 1}. {sideLabel(position.history[index].piece.color)} {position.history[index].notation}</button></li>)}</ol></section>}
        <p className="review-muted">练习不计时。继续实战使用 Fairy-Stockfish · 1 线程 / 64 MB · 每手 1.5 秒。刷新或离开本页后进度不保留，可手动收藏局面。查看原谱不会清空练习；收藏只保存局面，不保存练习会话。</p>
      </aside>
    </div>
  </main>
}
