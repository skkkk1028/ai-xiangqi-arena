import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_ENGINE_ID, engineRegistry } from '../engine/default-registry'
import type { EngineAdapter } from '../engine/adapter'
import { detectEngineSupport } from '../engine/support'
import { moveToUcci, sideLabel } from '../engine/ucci'
import { pieceLabel } from '../game/notation'
import type { Color, MoveRecord, Position } from '../game/types'
import { XiangqiGameEngine, type XiangqiGameState } from '../games/xiangqi/game-engine'
import { analyzeReviewMove, recordedCaptureNotes, reviewPositions, REVIEW_TIME_MS, scoreText, type MoveReview } from '../games/xiangqi/review'
import { ChessBoard } from './ChessBoard'
import './xiangqi-review.css'
import { NotebookSave } from '../games/xiangqi/NotebookSave'
import { MoveComparison } from '../games/xiangqi/MoveComparison'
import { XiangqiTurningPoints } from './XiangqiTurningPoints'
import type { NotebookEntry, NotebookReference } from '../games/xiangqi/notebook'

interface Props {
  history: readonly MoveRecord[]
  onClose: () => void
  engineId?: string
  initialIndex?: number
  entry?: 'review' | 'practice' | 'notebook'
  notebookEntry?: NotebookEntry
  reference?: NotebookReference
}
const game = new XiangqiGameEngine()

export function XiangqiReviewScreen({ history, onClose, engineId = DEFAULT_ENGINE_ID, initialIndex = 0, entry = 'review', notebookEntry, reference }: Props) {
  const positions = useMemo(() => reviewPositions(history.map((move) => move.ucci)), [history])
  const [index, setIndex] = useState(Math.max(0, Math.min(history.length, initialIndex)))
  const [reviews, setReviews] = useState<Record<number, MoveReview>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('选择一步，查看棋谱事实，或按需启动引擎分析。')
  const [error, setError] = useState<string | null>(null)
  const [practice, setPractice] = useState<'retry' | 'challenge' | null>(null)
  const [branch, setBranch] = useState<XiangqiGameState | null>(null)
  const [humanColor, setHumanColor] = useState<Color>(entry === 'review' ? 'red' : positions[Math.max(0, Math.min(history.length, initialIndex))].turn)
  const [showReference, setShowReference] = useState(false)
  const [trialMove, setTrialMove] = useState<{ before: XiangqiGameState; ucci: string; reference?: string } | null>(null)
  const [trial, setTrial] = useState<MoveReview | null>(null)
  const [selected, setSelected] = useState<Position | null>(null)
  const adapterRef = useRef<EngineAdapter | null>(null)
  const adapterEngineRef = useRef<string | null>(null)
  const initializingRef = useRef<Promise<unknown> | null>(null)
  const generation = useRef(0)
  const busyRef = useRef(false)
  const current = branch ?? positions[index]
  const review = reviews[index]
  const recorded = history[index]
  const storedReference = reference ?? notebookEntry?.reference
  const positionReference = index === initialIndex && storedReference ? storedReference : recorded ? { actual: recorded.ucci, source: 'record' as const } : undefined
  const canPlay = practice && !busy && !current.result && current.turn === humanColor && !(practice === 'retry' && branch && branch.history.length > index)
  const legal = canPlay ? game.getLegalActions(current) : []
  const targets = selected ? legal.filter((move) => move.from.row === selected.row && move.from.col === selected.col).map((move) => move.to) : []

  useEffect(() => () => {
    generation.current += 1
    adapterRef.current?.dispose()
    adapterRef.current = null
    initializingRef.current = null
  }, [])

  const cancel = () => {
    generation.current += 1
    adapterRef.current?.stop('复盘操作已取消。')
    adapterRef.current?.dispose()
    adapterRef.current = null
    initializingRef.current = null
    adapterEngineRef.current = null
    busyRef.current = false
    setBusy(false)
  }

  const perform = async (job: (engine: EngineAdapter, assertCurrent: () => void) => Promise<void>, selectedEngine = engineId) => {
    if (busyRef.current) return
    const token = ++generation.current
    const assertCurrent = () => {
      if (token !== generation.current) throw new DOMException('复盘任务已取消。', 'AbortError')
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (adapterRef.current && adapterEngineRef.current !== selectedEngine) {
        adapterRef.current.dispose()
        adapterRef.current = null
        initializingRef.current = null
      }
      if (!adapterRef.current) {
        const support = detectEngineSupport()
        if (!support.supported) throw new Error(support.reason ?? '浏览器不支持分析引擎。')
        const adapter = engineRegistry.createEngine('xiangqi', selectedEngine, {
          assetBase: document.baseURI,
          onProgress: (progress) => { if (token === generation.current) setMessage(progress.message) },
        }, { threads: 1, hash: 64 })
        adapterRef.current = adapter
        adapterEngineRef.current = selectedEngine
        initializingRef.current = adapter.init()
      }
      const engine = adapterRef.current
      await initializingRef.current
      assertCurrent()
      await job(engine, assertCurrent)
    } catch (caught) {
      if (token === generation.current) {
        setError(caught instanceof Error ? caught.message : '分析失败，请重试。')
        adapterRef.current?.dispose()
        adapterRef.current = null
        initializingRef.current = null
      }
    } finally {
      if (token === generation.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  const navigate = (next: number) => {
    cancel()
    setIndex(Math.max(0, Math.min(history.length, next)))
    setBranch(null)
    setPractice(null)
    setTrial(null)
    setTrialMove(null)
    setShowReference(false)
    setSelected(null)
    setError(null)
    setMessage('原棋谱浏览；练习分支不会覆盖原局。')
  }

  const analyze = (all: boolean) => void perform(async (engine, assertCurrent) => {
    for (let step = all ? 0 : index; step < (all ? history.length : index + 1); step += 1) {
      if (!history[step] || reviews[step]) continue
      setMessage(`正在分析第 ${step + 1} 手 / ${history.length} 手…可随时停止。`)
      const result = await analyzeReviewMove(engine, positions[step], history[step].ucci, assertCurrent)
      assertCurrent()
      setReviews((previous) => ({ ...previous, [step]: result }))
    }
    setMessage('分析完成。评价为有限搜索估计；点击关键着法可重试。')
  })

  const reply = (position: XiangqiGameState) => void perform(async (engine, assertCurrent) => {
    setMessage('练习对手正在思考…')
    const response = await engine.search(position.history.map((entry) => entry.ucci), REVIEW_TIME_MS, { multiPv: 1 })
    assertCurrent()
    const action = response.bestmove && game.findLegalActionByUcci(position, response.bestmove)
    if (!action) throw new Error('练习引擎未返回合法着法，请重试。')
    const next = game.executeAction(position, action)
    setBranch(next)
    setMessage('AI 已落子，轮到你继续挑战。')
  }, DEFAULT_ENGINE_ID)

  const startRetry = () => {
    cancel()
    setBranch(positions[index])
    setHumanColor(positions[index].turn)
    setPractice('retry')
    setTrial(null)
    setTrialMove(null)
    setShowReference(false)
    setSelected(null)
    setError(null)
    setMessage('在棋盘上重走一手；完成后按同一分析方法核对，也可继续与 AI 对弈。')
  }

  const startChallenge = () => {
    if (busyRef.current) return
    const position = branch ?? positions[index]
    setBranch(position)
    setPractice('challenge')
    setTrial(null)
    setTrialMove(null)
    setShowReference(false)
    setSelected(null)
    setMessage(`练习分支：你执${sideLabel(humanColor)}，对手每步搜索 1.5 秒。`)
    if (!position.result && position.turn !== humanColor) reply(position)
  }

  const clickSquare = (point: Position) => {
    if (!canPlay || busyRef.current) return
    const action = selected && legal.find((move) => move.from.row === selected.row && move.from.col === selected.col && move.to.row === point.row && move.to.col === point.col)
    if (!action) {
      setSelected(current.board[point.row][point.col]?.color === humanColor ? point : null)
      return
    }
    const next = game.executeAction(current, action)
    setBranch(next)
    setSelected(null)
    if (practice === 'retry' && entry !== 'review') {
      setTrialMove({ before: current, ucci: moveToUcci(action), reference: positionReference?.actual })
      setMessage('已完成重走一手；可按需分析，或继续挑战。')
    } else if (practice === 'retry') {
      void perform(async (engine, assertCurrent) => {
        const result = await analyzeReviewMove(engine, current, moveToUcci(action), assertCurrent)
        assertCurrent()
        setTrial(result)
        setMessage('重试已分析；可再次重试，或从练习局面继续挑战。')
      })
    } else if (!next.result) reply(next)
  }

  const important = Object.entries(reviews).filter(([, item]) => (item.lossCp ?? 0) >= 100 || (item.bestScore?.kind === 'mate' && item.bestScore.value > 0 && !(item.playedScore?.kind === 'mate' && item.playedScore.value > 0)))
  const branchHistory = branch?.history.slice(index) ?? []

  return <main className="xiangqi-review">
    <header className="review-header">
      <div><p>中国象棋 · 棋谱研习</p><h1>{entry === 'review' ? '复盘与再挑战' : entry === 'notebook' ? '个人练习本' : '局面练习'}</h1></div>
      <button type="button" onClick={() => { cancel(); onClose() }}>{entry === 'review' ? '返回原对局' : '返回来源'}</button>
    </header>
    <div className="review-layout">
      <section className="review-board">
        {notebookEntry && <><h2>{notebookEntry.title}</h2><p>来源：{notebookEntry.source.label}</p></>}
        <h2>{practice ? `练习分支 · 你执${sideLabel(humanColor)}` : `原棋谱 · 已走 ${index} / ${history.length} 手`}</h2>
        {current.result && <p role="status">本局面已结束：{current.result.winner ? `${sideLabel(current.result.winner)}获胜` : '和棋'}。可以查看、收藏或返回更早局面练习。</p>}
        <ChessBoard board={current.board} turn={current.turn} lastMove={current.lastMove} checkColor={current.checkColor} paused={false} interactive={Boolean(canPlay)} selected={selected} legalTargets={targets} onSquareClick={clickSquare} />
        <nav className="review-controls" aria-label="复盘步进">
          <button disabled={index === 0 && !practice} onClick={() => navigate(0)}>初始局面</button>
          <button disabled={index === 0} onClick={() => navigate(index - 1)}>上一步</button>
          <button disabled={index === history.length} onClick={() => navigate(index + 1)}>下一步</button>
          <button onClick={() => navigate(history.length)}>最后局面</button>
        </nav>
        <label className="review-slider">棋谱进度<input aria-label="棋谱进度" type="range" min="0" max={history.length} value={index} onChange={(event) => navigate(Number(event.target.value))} /></label>
        <NotebookSave draft={{ moves: current.history.map((move) => move.ucci), source: { kind: branch ? 'practice' : entry === 'review' ? 'review' : notebookEntry?.source.kind ?? 'live', label: branch ? '独立练习分支' : notebookEntry?.source.label ?? '中国象棋局面研习' }, ...(!branch && positionReference ? { reference: positionReference } : {}) }} />
        {branch && <p>练习棋谱：{branchHistory.map((move) => move.notation).join(' → ') || '等待落子'}。原局保持不变。</p>}
        {current.result && <p role="status">{current.result.winner ? `${sideLabel(current.result.winner)}胜` : '和棋'} · {current.result.reason === 'checkmate' ? '将死' : current.result.reason === 'stalemate' ? '困毙' : '简化和棋裁定'}</p>}
      </section>
      <aside className="review-sidebar">
        {entry === 'review' && <XiangqiTurningPoints history={history} index={index} onNavigate={navigate} />}
        {entry !== 'review' && <section><button onClick={() => setShowReference((value) => !value)}>{showReference ? '收起参考' : '查看参考'}</button>
          {showReference && <div><p>备注：{notebookEntry?.note || '暂无备注'}</p><p>原猜招：{positionReference?.guessed || '未记录'} · 参考着法：{positionReference?.actual || '未记录'} · 来源：{positionReference?.source === 'opening' ? '开局库' : positionReference?.source === 'engine' ? '引擎选招' : '原谱记录'}</p><p>历史参考不是唯一正确答案。</p></div>}
        </section>}
        {entry === 'review' && <section>
          <h2>{recorded ? `第 ${index + 1} 手 · ${sideLabel(recorded.piece.color)} ${recorded.notation}` : '已到原棋谱末尾'}</h2>
          {recordedCaptureNotes(history, index).map((note) => <p key={note}>{note}</p>)}
          {recorded && <p>原局记录评价：{scoreText(recorded.score)} · 深度 {recorded.depth || '未记录'}。原始评价仅供对照，不用于跨步直接相减。</p>}
          <div className="review-controls">
            <button disabled={busy || !recorded || Boolean(practice)} onClick={() => analyze(false)}>分析本手</button>
            <button disabled={busy || history.length === 0 || Boolean(practice)} onClick={() => analyze(true)}>分析全局</button>
            {busy && <button onClick={() => { cancel(); setMessage('已停止，保留已完成的分析。') }}>停止计算</button>}
          </div>
          <p className="review-muted">分析引擎：{engineRegistry.getEngine('xiangqi', engineId)?.name ?? engineId}；每次搜索 1.5 秒，必要时补搜一次。全局分析按需运行。</p>
          {!practice && review && <ReviewEvidence review={review} />}
          {trial && <><h3>你的重试</h3><ReviewEvidence review={trial} /></>}
          <p role="status">{message}</p>
          {error && <p role="alert">{error} 棋谱和练习局面均已保留。</p>}
        </section>
        }
        {entry !== 'review' && <><p role="status">{message}</p>{error && <p role="alert">{error}。局面已保留。</p>}{busy && <button onClick={cancel}>停止计算</button>}</>}
        {trialMove && <MoveComparison before={trialMove.before} userUcci={trialMove.ucci} referenceUcci={trialMove.reference} />}
        <section>
          <h2>重走与挑战</h2>
          <div className="review-controls">
            <button disabled={busy || Boolean(positions[index].result)} onClick={startRetry}>{entry === 'review' ? '重试这一手' : trialMove ? '重新作答' : '重走一手'}</button>
            <label>执子<select aria-label="练习执子" value={humanColor} disabled={busy || Boolean(practice)} onChange={(event) => setHumanColor(event.target.value as Color)}><option value="red">红方</option><option value="black">黑方</option></select></label>
            <button disabled={busy || Boolean(current.result)} onClick={startChallenge}>{practice === 'challenge' && current.turn !== humanColor ? '重试 AI 应手' : entry === 'review' ? '从此局面继续挑战' : practice ? '继续挑战' : '开始练习'}</button>
            {practice && <button onClick={() => navigate(index)}>返回原谱局面</button>}
            {entry !== 'review' && <button onClick={() => navigate(initialIndex)}>重新开始本局面</button>}
          </div>
          <p className="review-muted">原对局保持暂停。练习不计时，使用 Fairy-Stockfish · 1 线程 / 64 MB · 每手 1.5 秒；离开后分支不保存，不覆盖原棋谱；结束复盘后可手动继续原对局。</p>
        </section>
        <section><h2>待复查的关键着法</h2><p className="review-muted">仅列出已分析且评价差至少 1 兵值或可能漏杀的着法；这是筛选提示，不是确定判错。</p>
          <div className="review-controls">{important.map(([key]) => <button key={key} onClick={() => navigate(Number(key))}>第 {Number(key) + 1} 手 · {history[Number(key)].notation}</button>)}</div>
          {!important.length && <p>尚无已识别关键着法。</p>}
        </section>
        <section><h2>完整棋谱</h2><ol className="review-moves">{history.map((move, step) => <li key={step}><button aria-current={index === step ? 'step' : undefined} onClick={() => navigate(step)}>{step + 1}. {sideLabel(move.piece.color)} {move.notation}{move.captured ? ` · 吃${pieceLabel(move.captured)}` : ''}</button></li>)}</ol></section>
      </aside>
    </div>
  </main>
}

function ReviewEvidence({ review }: { review: MoveReview }) {
  return <div className="review-evidence">
    <h3>可核验分析</h3>
    <p>最佳候选：{review.bestNotation}（{review.bestUcci}）· {scoreText(review.bestScore)} · 深度 {review.depth}</p>
    <p>所选着法：{review.playedNotation} · {scoreText(review.playedScore)} · 深度 {review.playedDepth || '规则终局'}</p>
    <p>双方评价均为本手行棋方视角。</p>
    {review.notes.map((note) => <p key={note}>{note}</p>)}
    <p>已校验合法的最佳候选变化：{review.variation.join(' → ') || '未提供'}。变化展示不等于已证明强制。</p>
  </div>
}
