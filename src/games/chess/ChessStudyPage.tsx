import { ChessTemporaryStudy, type ChessStudyEntry } from './ChessTemporaryStudy'
import { NotebookSave } from './NotebookSave'
import { chessNotebookDraft } from './notebook'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GAME_ROUTES } from '../routes'
import { ChessBoard } from './ChessBoard'
import { createChessArchive, restoreChessArchive } from './archive'
import { chessLibrary, newChessId, type ChessLibraryGameV1, type ChessSavedAnalysis } from './library'
import { downloadChessFile } from './ChessLibraryPage'
import { ChessGameEngine, replayChessState, actionToUci, isChessMoveAction, parseChessUci } from './rules'
import { ChessStudyEngine, studyAnalysisKey, studyEngineIdentity, type StudyTier } from './study-engine'
import { explainChessMove, whiteWinRateEstimate } from './study-analysis'
import { pvToSan } from './analysis'
import type { ChessAction, ChessColor, ChessGameState, ChessMoveAction } from './types'
import { readChessLiveReturn, writeChessLiveReturn } from './live-return'

const rules = new ChessGameEngine()

export function ChessStudyPage({ gameId, entry, onClose }: { gameId?: string; entry?: ChessStudyEntry; onClose?: () => void }) {
  if (entry) return <ChessTemporaryStudy entry={entry} onClose={onClose ?? (() => undefined)} />
  return <SavedChessStudyPage gameId={gameId!} />
}
function SavedChessStudyPage({ gameId }: { gameId: string }) {
  const [practicePaused, setPracticePaused] = useState(false)
  const [temporary, setTemporary] = useState<ChessStudyEntry | null>(null)
  const [game, setGame] = useState<ChessLibraryGameV1 | null>(null)
  const [analyses, setAnalyses] = useState<ChessSavedAnalysis[]>([])
  const [ply, setPly] = useState(0)
  const [tier, setTier] = useState<StudyTier>('quick')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState<ChessGameState | null>(null)
  const [retryAnalysis, setRetryAnalysis] = useState<ChessSavedAnalysis | null>(null)
  const [practice, setPractice] = useState<{ state: ChessGameState; humanColor: ChessColor; id: string; startPly: number; createdAt: string } | null>(null)
  const [practiceStatus, setPracticeStatus] = useState('')
  const [aiRetry, setAiRetry] = useState(0)
  const engineRef = useRef<ChessStudyEngine | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const practiceRef = useRef(practice)
  practiceRef.current = practice

  useEffect(() => {
    const generation = ++generationRef.current
    setGame(null); setAnalyses([]); setPly(0); setRetry(null); setPractice(null); setError(null)
    void chessLibrary.get(gameId).then(async (loaded) => {
      if (!loaded) throw new Error('找不到这局棋谱。')
      restoreChessArchive(loaded.archive)
      const saved = await chessLibrary.analyses(gameId)
      if (generation === generationRef.current) { setGame(loaded); setAnalyses(saved); setPly(loaded.archive.moves.length) }
    }).catch((reason) => { if (generation === generationRef.current) setError(String(reason)) })
    return () => { generationRef.current++; abortRef.current?.abort(); engineRef.current?.dispose(); engineRef.current = null }
  }, [gameId])

  const stopAnalysis = useCallback(() => { abortRef.current?.abort(); engineRef.current?.stop(); setBusy('') }, [])
  const timeline = useMemo(() => {
    if (!game) return []
    try {
      const snapshots = [replayChessState([], {
        initialFen: game.archive.initialPosition, seed: Number(game.archive.metadata?.seed),
        openingId: String(game.archive.metadata?.openingId), openingName: String(game.archive.metadata?.openingName),
      })]
      for (const uci of game.archive.moves) {
        const action = parseChessUci(uci)
        const previous = snapshots[snapshots.length - 1]
        const legal = action && rules.getLegalActions(previous).find((candidate) => rules.actionsEqual(candidate, action))
        if (!legal) throw new Error(`第 ${snapshots.length} 手棋谱无效。`)
        snapshots.push(rules.executeAction(previous, legal))
      }
      return snapshots
    } catch { return [] }
  }, [game])
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (temporary || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || practiceRef.current) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
      const next = event.key === 'ArrowLeft' ? (current: number) => Math.max(0, current - 1)
        : event.key === 'ArrowRight' ? (current: number) => Math.min(timeline.length - 1, current + 1)
        : event.key === 'Home' ? () => 0
        : event.key === 'End' ? () => timeline.length - 1 : null
      if (!next || timeline.length === 0) return
      event.preventDefault()
      setPly(next)
      setRetry(null)
    }
    window.addEventListener('keydown', navigate)
    return () => window.removeEventListener('keydown', navigate)
  }, [timeline.length, temporary])
  const at = timeline[ply]
  const original = game && ply > 0 ? timeline[ply]?.history[ply - 1] : undefined
  const findAnalysis = (positionPly: number, selectedTier: StudyTier) => analyses.filter((item) => item.tier === selectedTier && item.prefix.length === positionPly && item.prefix.every((move, i) => move === game?.archive.moves[i])).at(-1)

  const analysePosition = async (positionPly: number, selectedTier: StudyTier, signal: AbortSignal): Promise<ChessSavedAnalysis> => {
    if (!game || !timeline[positionPly]) throw new Error('局面不可用。')
    const engine = engineRef.current ?? (engineRef.current = new ChessStudyEngine())
    const profile = await engine.init()
    if (signal.aborted) throw new DOMException('分析已取消。', 'AbortError')
    const prefix = game.archive.moves.slice(0, positionPly)
    const identity = studyEngineIdentity(profile)
    const key = studyAnalysisKey(game.id, game.archive.initialPosition!, prefix, selectedTier, identity)
    const existing = analyses.find((item) => item.key === key)
    if (existing) return existing
    const searched = await engine.search(game.archive.initialPosition!, prefix, selectedTier, 4, signal)
    const result: ChessSavedAnalysis = {
      key, gameId: game.id, prefix: [...prefix], initialFen: game.archive.initialPosition!, ruleset: game.archive.ruleset,
      tier: selectedTier, engine: searched.engine, elapsedMs: searched.elapsedMs, timedOut: searched.timedOut,
      response: searched.response, createdAt: new Date().toISOString(),
    }
    if (signal.aborted) throw new DOMException('分析已取消。', 'AbortError')
    await chessLibrary.saveAnalysis(result)
    if (!signal.aborted) setAnalyses((current) => current.some((item) => item.key === result.key) ? current : [...current, result])
    return result
  }

  const runAnalysis = async (all: boolean, selectedTier: StudyTier = tier) => {
    if (!game || busy || practice) return
    stopAnalysis()
    const controller = new AbortController()
    abortRef.current = controller
    const generation = generationRef.current
    const positions = all ? Array.from({ length: timeline.length }, (_, index) => index) : ply === 0 ? [0] : [ply - 1, ply]
    try {
      for (const position of positions) {
        if (controller.signal.aborted || generation !== generationRef.current) break
        setBusy(`${all ? '分析全局' : '分析本手'} ${position}/${game.archive.moves.length}`)
        await analysePosition(position, selectedTier, controller.signal)
      }
      if (!all && retry && retry.history.length === ply && !retry.result && !controller.signal.aborted) {
        setBusy('比较重试着')
        const searched = await (engineRef.current ?? (engineRef.current = new ChessStudyEngine())).search(retry.initialFen, retry.history.map((item) => item.uci), selectedTier, 4, controller.signal)
        if (!controller.signal.aborted) setRetryAnalysis({ key: `retry-${Date.now()}`, gameId: game.id, prefix: retry.history.map((item) => item.uci), initialFen: retry.initialFen,
          ruleset: game.archive.ruleset, tier: selectedTier, engine: searched.engine, elapsedMs: searched.elapsedMs, timedOut: searched.timedOut, response: searched.response, createdAt: new Date().toISOString() })
      }
      if (generation === generationRef.current && !controller.signal.aborted) setError(null)
    } catch (reason) { if (!controller.signal.aborted && generation === generationRef.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (abortRef.current === controller) { abortRef.current = null; setBusy('') } }
  }

  const retryMove = (action: ChessAction) => {
    if (!game || ply < 1) return
    if (retry && (retry.history.length >= ply || retry.result)) return
    try {
      const base = timeline[ply - 1]
      const legal = rules.getLegalActions(base).find((candidate) => rules.actionsEqual(candidate, action))
      if (!legal) throw new Error('重试着法不合法。')
      setRetry(rules.executeAction(base, legal))
      setRetryAnalysis(null)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const compareRetry = async () => {
    if (!retry || !game || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy('比较重试着')
    try {
      await analysePosition(ply - 1, tier, controller.signal)
      await analysePosition(ply, tier, controller.signal)
      const searched = await (engineRef.current ?? (engineRef.current = new ChessStudyEngine())).search(retry.initialFen, retry.history.map((item) => item.uci), tier, 4, controller.signal)
      if (controller.signal.aborted) return
      setRetryAnalysis({ key: `retry-${Date.now()}`, gameId: game.id, prefix: retry.history.map((item) => item.uci), initialFen: retry.initialFen,
        ruleset: game.archive.ruleset, tier, engine: searched.engine, elapsedMs: searched.elapsedMs, timedOut: searched.timedOut, response: searched.response, createdAt: new Date().toISOString() })
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (abortRef.current === controller) { abortRef.current = null; setBusy('') } }
  }

  const startPractice = (humanColor: ChessColor) => {
    if (temporary) return <ChessTemporaryStudy entry={temporary} onClose={() => setTemporary(null)} />
  if (!game || !at) return
    const base = retry ?? at
    if ((base.result?.termination === 'claim' || !retry && ply === game.archive.moves.length && game.archive.result?.termination === 'claim') && !window.confirm('此处已声明和棋。忽略声明并以不限时练习继续？')) return
    if (base.result && base.result.termination !== 'claim') { setError('该局面已经由棋盘或自动规则终局，请选择更早的一手重试。'); return }
    stopAnalysis()
    engineRef.current?.dispose(); engineRef.current = null
    const playable = replayChessState(base.history.map((move) => move.uci), {
      initialFen: base.initialFen, seed: base.seed, openingId: base.openingId, openingName: base.openingName,
    })
    setPractice({ state: playable, humanColor, id: newChessId(), startPly: retry ? ply - 1 : ply, createdAt: new Date().toISOString() })
    setPracticeStatus('练习已就绪。')
    setError(null)
  }

  const playPractice = useCallback((action: ChessAction) => {
    const current = practiceRef.current
    if (!current || current.state.result || current.state.turn !== current.humanColor || busy) return
    try {
      const legal = rules.getLegalActions(current.state).find((candidate) => rules.actionsEqual(candidate, action))
      if (!legal) throw new Error('练习着法不合法。')
      setPractice({ ...current, state: rules.executeAction(current.state, legal) })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [busy])

  useEffect(() => {
    if (!practice || !game || practice.state.history.length <= practice.startPly) return
    const generation = generationRef.current
    const id = practice.id
    const archive = createChessArchive({ state: practice.state, createdAt: practice.createdAt, players: [
      { seat: practice.humanColor, kind: 'human', name: '练习者' },
      { seat: practice.humanColor === 'w' ? 'b' : 'w', kind: 'ai', name: 'Stockfish 18 · PV1' },
    ] })
    void chessLibrary.save({ id: practice.id, title: `练习 · ${game.title}`, favorite: false, mode: 'practice', archive,
      configuration: { humanColor: practice.humanColor, budget: '3000ms', engine: 'Stockfish 18 PV1' },
      source: { gameId: game.id, ply: practice.startPly },
    }).then(() => { if (generation === generationRef.current && practiceRef.current?.id === id) setPracticeStatus('练习已保存') }, () => { if (generation === generationRef.current && practiceRef.current?.id === id) setPracticeStatus('练习保存失败；可先导出当前棋局。') })
  }, [practice, game])

  useEffect(() => {
    if (practicePaused || temporary || !practice || practice.state.result || practice.state.turn === practice.humanColor || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    const id = practice.id
    setPracticeStatus('Stockfish 18 思考中…')
    void (async () => {
      try {
        const searched = await (engineRef.current ?? (engineRef.current = new ChessStudyEngine())).search(practice.state.initialFen, practice.state.history.map((move) => move.uci), 'quick', 1, controller.signal)
        if (controller.signal.aborted || practiceRef.current?.id !== id || practiceRef.current.state.fen !== practice.state.fen) return
        const action = searched.response.bestmove && parseChessUci(searched.response.bestmove)
        const legal = action && rules.getLegalActions(practice.state).find((candidate) => isChessMoveAction(candidate) && rules.actionsEqual(candidate, action))
        if (!legal) throw new Error('Stockfish 应手不合法。')
        setPractice({ ...practice, state: rules.executeAction(practice.state, legal) })
        setPracticeStatus('轮到你行棋。')
      } catch (reason) { if (!controller.signal.aborted) setPracticeStatus(`引擎不可用：${reason instanceof Error ? reason.message : String(reason)}。可重试。`) }
    })()
    return () => { controller.abort(); engineRef.current?.stop() }
  }, [practice?.state.fen, practice?.humanColor, practice?.id, busy, aiRetry, temporary, practicePaused])

  if (temporary) return <ChessTemporaryStudy entry={temporary} onClose={() => setTemporary(null)} />
  if (!game || !at) return <main className="chess-page chess-study-page"><a href={GAME_ROUTES.chessLibrary}>← 棋谱库</a><p role={error ? 'alert' : undefined}>{error ?? '正在读取棋谱…'}</p></main>
  const before = ply > 0 ? findAnalysis(ply - 1, tier) : undefined
  const after = findAnalysis(ply, tier)
  const explanation = original ? explainChessMove(original, before, after, undefined, timeline[ply + 1]?.lastMove ?? undefined) : null
  const retryExplanation = retry?.result?.termination === 'claim' ? null : retry?.lastMove && retry.history.length === ply ? explainChessMove(retry.lastMove, before, undefined, retryAnalysis ?? undefined) : null
  const activeState = practice?.state ?? retry ?? (ply === game.archive.moves.length ? restoreChessArchive(game.archive) : at)
  const claimActions = practice && practice.state.turn === practice.humanColor ? rules.getLegalActions(practice.state).filter((action) => !isChessMoveAction(action)) : []
  const retryClaims = retry && !retry.result && retry.history.length < ply ? rules.getLegalActions(timeline[ply - 1]).filter((action) => !isChessMoveAction(action)) : []
  const liveReturn = readChessLiveReturn()
  const returnRoute = liveReturn?.id === game.id && liveReturn.phase === 'study' ? {
    theatre: GAME_ROUTES.chessTheatre, arena: GAME_ROUTES.chessArena,
    human: GAME_ROUTES.chessHuman, local: GAME_ROUTES.chessLocal,
  }[liveReturn.mode] : null
  return <main className="chess-page chess-study-page">
    <header className="chess-header"><a className="chess-back" href={GAME_ROUTES.chessLibrary} onClick={stopAnalysis}>← 棋谱库</a>{returnRoute && <a href={returnRoute} onClick={() => { stopAnalysis(); writeChessLiveReturn({ ...liveReturn!, phase: 'resume' }) }}>返回原对局（保持暂停）</a>}<div className="chess-brand"><span>♞</span><div><strong>{game.title}</strong><small>保存 · 复盘 · 重试</small></div></div></header>
    <section className="chess-study-content">
      <div className="chess-study-board"><button onClick={() => { stopAnalysis(); engineRef.current?.dispose(); engineRef.current = null; setPracticePaused(true); setTemporary({state: activeState, source: game.title, reference: !practice && !retry && game.archive.moves[ply] ? {actual: game.archive.moves[ply], description: '原谱着法'} : undefined}) }}>临时练习</button>
        <NotebookSave draft={chessNotebookDraft(activeState, {kind: practice ? 'practice' : 'review', label: game.title}, !practice && !retry && game.archive.moves[ply] ? {actual: game.archive.moves[ply], description: '原谱着法'} : undefined)} beforeOpen={stopAnalysis} />
        <ChessBoard state={activeState} interactive={Boolean(retry && !practice || practice && practice.state.turn === practice.humanColor)} humanColor={activeState.turn} disabled={Boolean(busy || practice && practice.state.turn !== practice.humanColor || retry && !practice && (retry.history.length >= ply || retry.result))} onMove={practice ? playPractice : retryMove} />
        {practice && <div className="chess-study-practice">{practicePaused && <button onClick={() => setPracticePaused(false)}>继续原练习</button>}<p>{practiceStatus} · 你执{practice.humanColor === 'w' ? '白' : '黑'} · {practice.state.history.length} 手</p><div className="chess-study-actions">{claimActions.map((action, index) => <button key={index} onClick={() => playPractice(action)}>申请{action.reason === 'threefold-repetition' ? '三次重复' : '五十回合'}和棋{action.intendedMove ? `（声明 ${actionToUci(action.intendedMove)}）` : ''}</button>)}{practiceStatus.startsWith('引擎不可用') && <button onClick={() => setAiRetry((value) => value + 1)}>重试 AI 应手</button>}<button onClick={() => downloadChessFile('国际象棋练习.json', JSON.stringify(createChessArchive({ state: practice.state, createdAt: practice.createdAt, players: [{ seat: practice.humanColor, kind: 'human', name: '练习者' }, { seat: practice.humanColor === 'w' ? 'b' : 'w', kind: 'ai', name: 'Stockfish 18' }] }), null, 2), 'application/json')}>导出练习 JSON</button><button onClick={() => { setPractice(null); setRetry(null) }}>结束练习并复盘</button></div></div>}
        {retry && !practice && <div className="chess-study-practice"><p>重试：{retry.result?.termination === 'claim' ? '已申请和棋' : retry.history.length < ply ? '请选择合法着法或申请和棋' : retry.lastMove?.san}；原着：{original?.san}</p><div className="chess-study-actions">{retryClaims.map((action, index) => <button key={index} onClick={() => retryMove(action)}>申请{action.reason === 'threefold-repetition' ? '三次重复' : '五十回合'}和棋{action.intendedMove ? `（声明 ${actionToUci(action.intendedMove)}）` : ''}</button>)}</div><button onClick={() => void compareRetry()} disabled={Boolean(busy || retry.history.length < ply)}>比较重试着</button>{retryExplanation?.lines.map((line, index) => <p key={index}>{line}</p>)}</div>}
      </div>
      <aside className="chess-study-panel">
        <p>原对局：{game.archive.players.map((player) => `${player.name}${player.engine ? `（${player.engine.descriptor.name} ${player.engine.descriptor.version}）` : ''}`).join(' / ')}；复盘分析：Stockfish 18。</p>
        {game.archive.result && <p>原局终局：{String(game.archive.result.reason)}；{game.archive.result.winner === 'w' ? '白方胜' : game.archive.result.winner === 'b' ? '黑方胜' : '和棋或技术停止'}。</p>}
        {game.clock && <p>原局时钟：白方 {Math.ceil(game.clock.totals.w / 1000)} 秒，黑方 {Math.ceil(game.clock.totals.b / 1000)} 秒；每步剩余 {Math.ceil(game.clock.moveRemainingMs / 1000)} 秒。</p>}
        <div className="chess-study-toolbar"><button onClick={() => { setPly(0); setRetry(null) }}>起点</button><button disabled={ply === 0} onClick={() => { setPly(ply - 1); setRetry(null) }}>上一步</button><button disabled={ply === game.archive.moves.length} onClick={() => { setPly(ply + 1); setRetry(null) }}>下一步</button><button onClick={() => { setPly(game.archive.moves.length); setRetry(null) }}>末尾</button></div>
        <label>第 {ply} / {game.archive.moves.length} 手<input type="range" min="0" max={game.archive.moves.length} value={ply} onChange={(event) => { setPly(Number(event.target.value)); setRetry(null) }} /></label>
        <div className="chess-study-graph" aria-label="白方胜率曲线">{timeline.map((state, index) => {
          const point = whiteWinRateEstimate(findAnalysis(index, tier), state.turn)
          return <button key={index} style={{ height: `${point?.percent ?? 50}%` }} title={`第 ${index} 手：${point ? `白方 ${point.percent.toFixed(1)}%（${point.source}）` : '未分析'}`} aria-label={`跳转第 ${index} 手`} className={ply === index ? 'is-active' : ''} onClick={() => { setPly(index); setRetry(null) }} />
        })}</div>
        <div className="chess-study-actions"><button onClick={() => void runAnalysis(false)} disabled={Boolean(busy || practice)}>分析本手</button><button onClick={() => void runAnalysis(true)} disabled={Boolean(busy || practice)}>分析全局</button><button onClick={() => { setTier('deep'); void runAnalysis(false, 'deep') }} disabled={Boolean(busy || practice)}>加深本手</button><button onClick={stopAnalysis} disabled={!busy}>停止</button></div>
        <p>{busy || `当前档位：${tier === 'quick' ? '快速 3 秒' : '加深 10 秒'} · Stockfish 18 MultiPV 4`}</p>
        {error && <p role="alert">{error}</p>}
        {after && <p>局面分析：{after.engine.name} {after.engine.version} · {after.engine.backend}{after.engine.fallback ? ' · 原生回退浏览器' : ''} · {after.engine.threads} 线程 / {after.engine.hashMb} MB{after.engine.network ? ` · 模型 ${after.engine.network.slice(0, 12)}` : ''} · 深度 {after.response.info.depth} · 节点 {after.response.info.nodes} · 实际 {after.elapsedMs}ms{after.timedOut ? ' · 超时' : ''}{!after.response.info.score ? ' · 缺少分数' : ''}{!after.response.info.wdl ? ' · 缺少引擎 WDL，曲线使用兵值估算' : ''}</p>}
        {before && ply > 0 && <div className="chess-study-candidates"><strong>本手之前的候选着</strong>{before.response.candidates.map((candidate) => <p key={`${candidate.multipv}-${candidate.pv[0]}`}>PV{candidate.multipv} · {candidate.score?.kind === 'cp' ? `${(candidate.score.value / 100).toFixed(2)} 兵` : candidate.score?.kind === 'mate' ? `M${candidate.score.value}` : '无评价'} · {pvToSan(timeline[ply - 1].fen, candidate.pv)}</p>)}</div>}
        {explanation && <div className="chess-study-explanation"><h2>第 {ply} 手 {explanation.review && <small>待复查</small>}</h2>{explanation.lines.map((line, index) => <p key={index}>{line}</p>)}</div>}
        {ply > 0 && !practice && <div className="chess-study-actions"><button onClick={() => { setRetry(timeline[ply - 1]); setRetryAnalysis(null) }}>重试这一手</button></div>}
        {!practice && <div className="chess-study-actions"><span>继续练习：</span><button onClick={() => startPractice('w')}>执白</button><button onClick={() => startPractice('b')}>执黑</button></div>}
        {game.clock?.result && <p>原局超时结果：{game.clock.result.winner === 'w' ? '白方' : '黑方'}获胜；练习不限时。</p>}
        {game.declaredResult && <p>PGN 声明结果：{game.declaredResult.token}（{game.declaredResult.termination}）</p>}
        <div className="chess-study-moves"><button onClick={() => { setPly(0); setRetry(null) }}>初始局面</button>{timeline.slice(1).map((state, index) => <button className={ply === index + 1 ? 'is-active' : ''} key={index} onClick={() => { setPly(index + 1); setRetry(null) }}>{index + 1}. {state.lastMove?.san}</button>)}</div>
      </aside>
    </section>
  </main>
}
