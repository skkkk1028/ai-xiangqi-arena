import { useEffect, useMemo, useRef, useState } from 'react'
import { GoMoveComparison as MoveComparisonPanel } from './GoMoveComparison'
import { NotebookSave } from './NotebookSave'
import { goMoveToGtp } from './ai/coordinates'
import { GoBoard } from './GoBoard'
import { WinRateChart } from './WinRateChart'
import { pointKey } from './board'
import { getGoGroup } from './rules'
import { createGoArchive, restoreGoArchive } from './sgf'
import { downloadGoFile, goLibrary, newGoId, type GoLibraryGame, type GoSavedAnalysis } from './library'
import { canonicalStudyMove, compareGoMove, encodedPrefix, GoStudyAnalyzer, goStudyPositions, playableStudyState, studyGame, type GoMoveComparison, type GoStudyProfile } from './study-analysis'
import { createConfiguredKataGoTransport } from './ai/configured-transport'
import { KataGoEngine } from './ai/KataGoEngine'
import type { KataGoTransport } from './ai/KataGoTransport'
import type { KataGoCapabilities } from './ai/types'
import { goEngineDescriptor } from './ai/go-ai'
import { kataGoRuntimeBackendLabel } from './ai/types'
import type { GoGameState, GoMove, GoPlayer, GoPoint } from './types'
import type { GoWinRatePoint } from './win-rate-analysis'
import './study.css'

export interface GoStudyEntry {
  initialIndex: number
  note?: string
  reference?: { guessed?: GoMove; actual?: GoMove; description?: string }
}
export function GoStudyPage({ game, onClose, onOpen, entry }: { game: GoLibraryGame; onClose: () => void; onOpen: (game: GoLibraryGame) => void; entry?: GoStudyEntry }) {
  const temporary = Boolean(entry)
  const [takeover, setTakeover] = useState<{game: GoLibraryGame; entry: GoStudyEntry} | null>(null)
  const source = useMemo(() => restoreGoArchive(game.archive), [game])
  const positions = useMemo(() => goStudyPositions(source), [source])
  const [cursor, setCursor] = useState(entry?.initialIndex ?? 0)
  const [cache, setCache] = useState<GoSavedAnalysis[]>([])
  const cacheRef = useRef<GoSavedAnalysis[]>([])
  const [loaded, setLoaded] = useState(false)
  const [profile, setProfile] = useState<GoStudyProfile>('winrate')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(temporary ? '先独立思考；练习与分析仅在本页保留，不会自动保存。' : '可先浏览棋谱；分析只在点击后运行，结果保存在本机。')
  const [error, setError] = useState<string | null>(null)
  const [branch, setBranch] = useState<GoGameState | null>(null)
  const [practiceMode, setPracticeMode] = useState<'retry' | 'continue' | null>(null)
  const [practiceBase, setPracticeBase] = useState<GoGameState | null>(null)
  const [practiceRecord, setPracticeRecord] = useState<GoLibraryGame | null>(null)
  const [human, setHuman] = useState<GoPlayer>(entry ? positions[entry.initialIndex].turn : 'black')
  const [showReference, setShowReference] = useState(false)
  const [trialPosition, setTrialPosition] = useState<{ before: GoGameState; move: GoMove } | null>(null)
  const [trial, setTrial] = useState<GoMoveComparison | null>(null)
  const [dead, setDead] = useState<GoPoint[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const busyRef = useRef(false)
  const moveLocked = useRef(false)
  const exiting = useRef(false)
  useEffect(() => { moveLocked.current = false }, [branch])
  const transportRef = useRef<KataGoTransport | null>(null)
  const capabilitiesRef = useRef<KataGoCapabilities | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const serialRef = useRef<Promise<void>>(Promise.resolve())
  const generationRef = useRef(0)
  const mounted = useRef(true)
  const practiceRef = useRef<GoLibraryGame | null>(null)

  useEffect(() => {
    mounted.current = true
    let active = true
    if (temporary) setLoaded(true)
    else void goLibrary.analyses(game.id).then((entries) => {
      if (active) { cacheRef.current = entries; setCache(entries) }
    }).catch((caught) => { if (active) setError(`历史分析读取失败：${String(caught)}`) }).finally(() => { if (active) setLoaded(true) })
    return () => {
      active = false; mounted.current = false; generationRef.current += 1; abortRef.current?.abort()
      const old = transportRef.current
      transportRef.current = null
      void serialRef.current.finally(() => old?.dispose())
    }
  }, [game.id, temporary])

  const cancel = () => {
    generationRef.current += 1
    abortRef.current?.abort()
    busyRef.current = false
    setBusy(false)
  }
  const exit = async (next: () => void) => {
    if (exiting.current) return
    exiting.current = true
    cancel(); setTrialPosition(null); setBusy(true)
    await serialRef.current
    const old = transportRef.current
    transportRef.current = null
    await old?.dispose()
    if (mounted.current) next()
  }
  const perform = (operation: (transport: KataGoTransport, signal: AbortSignal, assertCurrent: () => void) => Promise<void>) => {
    if (busyRef.current) return
    cancel()
    busyRef.current = true
    const generation = generationRef.current
    const abort = new AbortController()
    abortRef.current = abort
    setBusy(true); setError(null)
    const assertCurrent = () => {
      abort.signal.throwIfAborted()
      if (!mounted.current || generation !== generationRef.current) throw new DOMException('会话已切换。', 'AbortError')
    }
    serialRef.current = serialRef.current.catch(() => undefined).then(async () => {
      try {
        assertCurrent()
        if (!transportRef.current) {
          const transport = await createConfiguredKataGoTransport({isolated:temporary})
          if (abort.signal.aborted || !mounted.current || generation !== generationRef.current) { await transport.dispose(); assertCurrent() }
          transportRef.current = transport
        }
        await operation(transportRef.current!, abort.signal, assertCurrent)
      } catch (caught) {
        if (!abort.signal.aborted && mounted.current && generation === generationRef.current) {
          setError(caught instanceof Error ? caught.message : String(caught))
          setNotice('操作未完成，棋谱与已完成分析仍保留；可以重试或下载备份。')
        }
        await transportRef.current?.dispose()
        transportRef.current = null
      } finally {
        if (mounted.current && generation === generationRef.current) { busyRef.current = false; setBusy(false) }
      }
    })
  }
  const analyzer = (transport: KataGoTransport) => new GoStudyAnalyzer(transport, cacheRef.current, (entry) => {
    setCache((old) => [...old.filter((item) => item.key !== entry.key), entry])
  })
  const snapshotFor = (state: GoGameState, selectedProfile: GoStudyProfile, id = game.id) => {
    const prefix = JSON.stringify(encodedPrefix(state))
    return [...cache].reverse().find((entry) => entry.gameId === id && entry.profile === selectedProfile && JSON.stringify(entry.prefix) === prefix)?.event
  }
  const comparisons = useMemo(() => {
    const result: Record<number, GoMoveComparison> = {}
    for (let step = 1; step < positions.length; step += 1) {
      const before = snapshotFor(positions[step - 1], profile)
      const after = snapshotFor(positions[step], profile)
      if (before && after) result[step] = compareGoMove(positions[step - 1], positions[step], before, after)
    }
    return result
  }, [cache, positions, profile, game.id])
  const analyzedMove = branch && practiceBase ? practiceBase.history.length + 1 : Math.max(1, cursor)
  const currentComparison = comparisons[analyzedMove]
  const current = branch ?? positions[cursor]
  const positionReference: GoStudyEntry['reference'] = entry && cursor === entry.initialIndex ? entry.reference : source.history[cursor] ? { actual: source.history[cursor].kind === 'pass' ? {kind:'pass' as const} : source.history[cursor].point!, description: '原谱落子' } : undefined
  const chartPoints = positions.flatMap((state, moveNumber): GoWinRatePoint[] => {
    if (moveNumber === 0) return []
    const event = snapshotFor(state, profile)
    return event ? [{ moveNumber, blackWinRate: event.root.winrate, whiteWinRate: 1 - event.root.winrate, visits: event.root.visits, requestedVisits: event.requestedVisits, elapsedMs: event.elapsedMs, timedOut: event.timedOut, runtimeLabel: event.runtimeBackend, engineVersion: event.engineVersion, modelName: event.modelName }] : []
  })
  const score = branch?.phase === 'scoring' ? studyGame.previewScore(branch, { deadStoneRepresentatives: dead }) : null
  const legalKeys = useMemo(() => new Set(studyGame.getLegalMoves(current).map(pointKey)), [current])
  const canPlay = Boolean(practiceMode && branch && !busy && branch.phase === 'playing' && branch.turn === human && (practiceMode === 'continue' || branch.history.length === practiceBase?.history.length))

  const navigate = (next: number) => {
    cancel(); setCursor(next); setBranch(null); setPracticeMode(null); setPracticeBase(null); setPracticeRecord(null); practiceRef.current = null; setTrial(null); setTrialPosition(null); setShowReference(false); setDead([]); setConfirmed(false); setError(null)
    setNotice(temporary ? '临时练习已清除，原局不变。' : '正在浏览原棋谱，练习记录如已产生落子则已单独保存。')
  }
  const analyze = (all: boolean, selectedProfile = profile) => {
    setProfile(selectedProfile)
    perform(async (transport, signal, assertCurrent) => {
      const service = analyzer(transport)
      for (let step = all ? 1 : analyzedMove; step <= (all ? source.history.length : analyzedMove); step += 1) {
        if (!positions[step]) continue
        assertCurrent(); setNotice(`分析第 ${step} / ${source.history.length} 手；可停止，已完成结果会保存。`)
        await service.move(game, positions[step - 1], positions[step], selectedProfile, signal)
      }
      assertCurrent(); setNotice('分析完成，结果已保存。待复查标记仅是搜索提示。')
    })
  }

  const persistPractice = async (state: GoGameState, player: GoPlayer = human): Promise<GoLibraryGame> => {
    const previous = practiceRef.current
    const createdAt = previous?.archive.createdAt ?? new Date().toISOString()
    const capabilities = capabilitiesRef.current
    const engine = capabilities ? {
      descriptor: goEngineDescriptor('katago', { engineVersion: capabilities.engineVersion, modelName: capabilities.modelName, runtimeLabel: kataGoRuntimeBackendLabel(capabilities.runtimeBackend) }),
      phase: 'ready' as const, backendLabel: kataGoRuntimeBackendLabel(capabilities.runtimeBackend),
      budget: { unit: 'visits' as const, requested: 2000 },
    } : undefined
    const record: GoLibraryGame = {
      id: previous?.id ?? newGoId(), title: previous?.title ?? `${game.title} · 第 ${practiceBase?.history.length ?? cursor} 手后练习`, favorite: false,
      mode: '练习续弈', configuration: { mode: 'human', humanColor: player, profile: 'fast' },
      source: previous?.source ?? { gameId: game.id, moveNumber: practiceBase?.history.length ?? cursor },
      archive: createGoArchive(state, new Date(), { createdAt, players: (['black', 'white'] as const).map((seat) => ({ seat, kind: seat === player ? 'human' : 'ai', name: seat === player ? '练习玩家' : 'KataGo', ...(seat !== player && engine ? { engine } : {}) })) }),
    }
    practiceRef.current = record; setPracticeRecord(record); setSaveStatus('保存中')
    try { await goLibrary.save(record); if (mounted.current && practiceRef.current?.id === record.id) setSaveStatus('已保存') }
    catch (caught) { if (mounted.current) { setSaveStatus('保存失败'); setError(`练习未能保存，可下载备份：${String(caught)}`) } }
    return record
  }
  const aiReply = (state: GoGameState, player = human) => perform(async (transport, signal, assertCurrent) => {
    setNotice('KataGo 正在应手：2000 visits，30 秒上限。')
    const engine = new KataGoEngine('study-practice', { transport, profile: 'fast' })
    try {
      capabilitiesRef.current = await transport.initialize(signal)
      assertCurrent()
      await engine.initialize({ gameId: 'go', player: state.turn })
      assertCurrent()
      const result = await engine.think({ state, player: state.turn, record: state.history, legalActions: studyGame.getLegalActions(state), signal })
      assertCurrent()
      const next = studyGame.applyMove(state, canonicalStudyMove(state, result.action))
      setBranch(next)
      if (!temporary) await persistPractice(next, player)
      assertCurrent()
      setNotice(`AI 已应手（${result.analysis?.visits ?? 0} visits${result.analysis?.timedOut ? '，已超时截断' : ''}）。${next.phase === 'scoring' ? '双方虚着，请确认死子计分。' : '轮到你落子。'}`)
    } finally { await engine.dispose() }
  })
  const beginRetry = () => {
    cancel()
    const retryIndex = temporary ? cursor : Math.max(0, analyzedMove - 1)
    const base = temporary ? (practiceBase ?? current) : positions[retryIndex]
    if (temporary && base.phase !== 'playing') return
    setCursor(retryIndex); setBranch(playableStudyState(base)); setPracticeBase(playableStudyState(base)); setPracticeMode('retry'); setHuman(base.turn); setTrial(null); setTrialPosition(null); setShowReference(false); setDead([]); setConfirmed(false)
    practiceRef.current = null; setPracticeRecord(null); setSaveStatus('等待第一手练习落子')
    setNotice('重走一手或虚着；重试后可比较原着、新着和推荐着。')
  }
  const continuePractice = () => {
    if (busyRef.current) return
    cancel()
    if (current.phase !== 'playing') { setNotice('当前已经进入计分或结束，请先点击“恢复行棋练习”。'); return }
    const base = branch ?? positions[cursor]
    setBranch(base); setPracticeMode('continue'); setTrial(null); setTrialPosition(null)
    if (!branch) { setPracticeBase(base); practiceRef.current = null; setPracticeRecord(null) }
    setNotice(`独立练习，你执${human === 'black' ? '黑' : '白'}，原局不变。`)
    if (base.turn !== human) aiReply(base)
  }
  const play = (move: GoMove) => {
    if (!canPlay || !branch || busyRef.current || moveLocked.current) return
    moveLocked.current = true
    try {
      const next = studyGame.applyMove(branch, canonicalStudyMove(branch, move))
      if (temporary) {
        setBranch(next)
        if (practiceMode === 'retry') {
          setTrialPosition({ before: branch, move })
          setNotice('已重走一手；可按需分析、重新作答或继续挑战。')
        } else if (next.phase === 'playing') aiReply(next)
        return
      }
      const generation = generationRef.current
      setBusy(true)
      setBranch(next)
      void persistPractice(next).then((record) => {
        if (!mounted.current || generation !== generationRef.current || practiceRef.current?.id !== record.id) return
        setBusy(false)
        if (practiceMode === 'retry') {
          perform(async (transport, signal, assertCurrent) => {
            const service = analyzer(transport)
            const base = practiceBase!
            // Recompute both choices with one profile and current engine identity.
            const originalAfter = positions[base.history.length + 1]
            if (originalAfter) await service.move(game, base, originalAfter, profile, signal)
            const result = await service.move(record, base, next, profile, signal)
            assertCurrent(); setTrial(result); setNotice('重试分析完成。可以再次重试，或继续与 AI 对弈。')
          })
        } else if (next.phase === 'playing') aiReply(next)
      })
    } catch (caught) { moveLocked.current = false; setError(String(caught)) }
  }
  const deepenTrial = () => {
    if (!practiceRecord || !practiceBase || !branch || branch.history.length !== practiceBase.history.length + 1) return
    setProfile('fast')
    perform(async (transport, signal, assertCurrent) => {
      const service = analyzer(transport)
      const originalAfter = positions[practiceBase.history.length + 1]
      if (originalAfter) await service.move(game, practiceBase, originalAfter, 'fast', signal)
      const result = await service.move(practiceRecord, practiceBase, branch, 'fast', signal)
      assertCurrent(); setTrial(result)
    })
  }
  const restorePlaying = () => {
    cancel()
    const resumed = playableStudyState(current)
    setBranch(resumed); setPracticeMode(temporary ? null : 'continue'); setTrialPosition(null); setShowReference(false); setDead([]); setConfirmed(false)
    if (temporary || !branch) { setPracticeBase(resumed); practiceRef.current = null; setPracticeRecord(null) }
    if (practiceRef.current) void persistPractice(resumed)
    setNotice('已显式恢复行棋；保留原有超级劫历史，点击继续练习开始应手。')
  }

  if (takeover) return <GoStudyPage key={takeover.game.id} game={takeover.game} entry={takeover.entry} onOpen={onOpen} onClose={() => setTakeover(null)} />
  return <main className="go-study">
    <header><div><p>围棋 · 保存—复盘—重试</p><h1>{game.title}</h1></div><button disabled={busy && abortRef.current?.signal.aborted} onClick={() => void exit(onClose)}>{temporary ? '返回来源' : '返回棋谱库'}</button></header>
    <p>原对局：{game.archive.players.map((player) => player.name).join(' vs ')} · {game.mode}。复盘引擎：KataGo。原局保持暂停。</p>
    <div className="go-study-layout">
      <section className="go-study-board">
        <h2>{branch ? `独立练习 · 已走 ${branch.history.length} 手` : `原棋谱 · 已走 ${cursor} / ${source.history.length} 手`}</h2>
        <div className="go-study-board-frame"><GoBoard board={current.board} turn={current.turn} lastMove={current.lastMove} legalMoveKeys={legalKeys} deadStoneKeys={new Set((score?.confirmedDeadStones ?? (!temporary || showReference ? current.result?.score.confirmedDeadStones : []) ?? []).map(pointKey))} interactive={canPlay} scoring={Boolean(branch?.phase === 'scoring' && !busy)} onPlay={play} onToggleDead={(point) => {
          const group = getGoGroup(current.board, point)
          if (!group) return
          const keys = new Set(group.stones.map(pointKey))
          setDead((old) => old.some((item) => keys.has(pointKey(item))) ? old.filter((item) => !keys.has(pointKey(item))) : [...old, point]); setConfirmed(false)
        }} /></div>
        <div className="go-study-actions"><button disabled={cursor === 0 && !branch} onClick={() => navigate(0)}>初始局面</button><button disabled={!cursor} onClick={() => navigate(cursor - 1)}>上一步</button><button disabled={cursor === source.history.length} onClick={() => navigate(cursor + 1)}>下一步</button><button onClick={() => navigate(source.history.length)}>末尾</button></div>
        <NotebookSave key={`${cursor}-${current.history.length}`} draft={{ archive: createGoArchive(current), source: { kind: branch ? 'practice' : 'review', label: game.title }, reference: !branch ? (entry && cursor === entry.initialIndex ? entry.reference : source.history[cursor] ? { actual: source.history[cursor].kind === 'pass' ? {kind:'pass'} : source.history[cursor].point!, description: '原谱落子' } : undefined) : undefined }} />
        <label className="go-study-progress">棋谱进度<input aria-label="围棋复盘进度" type="range" min="0" max={source.history.length} value={cursor} onChange={(event) => navigate(Number(event.target.value))} /></label>
        {branch && <><p>{temporary ? '临时分支不自动保存，可收藏当前局面。' : '练习保存：'}{!temporary && (saveStatus || '等待落子')} · 原谱不变</p><div className="go-study-actions"><button disabled={!canPlay} onClick={() => play({ kind: 'pass' })}>练习虚着</button><button onClick={() => navigate(cursor)}>返回原谱局面</button>{practiceRecord && <><button onClick={() => void persistPractice(branch)}>重试保存练习</button><button onClick={() => downloadGoFile('go-practice.json', JSON.stringify({ format: 'project10-go-library', version: 1, game: practiceRecord, analyses: cache.filter((entry) => entry.gameId === practiceRecord.id) }, null, 2))}>下载练习备份</button><button onClick={() => void exit(() => onOpen(practiceRecord))}>复盘这盘练习</button></>}</div></>}
        {current.phase !== 'playing' && <div><p>{current.result && (!temporary || showReference) ? `结算：${current.result.winner === 'black' ? '黑' : '白'}胜 ${current.result.score.margin} 目` : current.result ? '本局面已结束，结算详情默认收起' : '双虚着，计分待确认'}</p><button disabled={busy} onClick={restorePlaying}>恢复行棋练习</button></div>}
        {score && <section><h2>练习计分</h2><p>黑 {score.black.total} · 白 {score.white.total}；已标记死子 {score.confirmedDeadStones.length} 枚。点击棋盘调整整块死子。</p><button disabled={confirmed} onClick={() => setConfirmed(true)}>黑方确认死子</button><button disabled={!confirmed} onClick={() => { const final = studyGame.finalizeScoring(branch!, { deadStoneRepresentatives: dead }); setBranch(final); if (!temporary) void persistPractice(final) }}>白方确认并结算</button></section>}
      </section>
      <aside className="go-study-sidebar">
        {temporary && <section><button onClick={() => setShowReference((value) => !value)}>{showReference ? '收起参考' : '查看参考'}</button>
          {showReference && <><p>备注：{entry?.note || '暂无备注'}</p><p>原猜招：{positionReference?.guessed ? goMoveToGtp(positionReference.guessed) : '未记录'}；参考着法：{positionReference?.actual ? goMoveToGtp(positionReference.actual) : '未记录'}；{positionReference?.description}</p><p>历史参考不是唯一正确答案。</p></>}
          <p role="status">{notice}</p>{error && <p role="alert">{error}</p>}{busy && <button onClick={cancel}>停止练习计算</button>}
          <button onClick={() => navigate(entry!.initialIndex)}>重新开始本局面</button>
        </section>}
        {temporary && trialPosition && <MoveComparisonPanel before={trialPosition.before} selected={trialPosition.move} reference={cursor === entry?.initialIndex ? entry.reference?.actual : source.history[cursor]?.kind === 'pass' ? {kind:'pass'} : source.history[cursor]?.point ?? undefined} />}
        {!temporary && <button onClick={() => void exit(() => {
          setTakeover({ game: { ...game, id: newGoId(), title: `${game.title} · 临时练习`, archive: createGoArchive(current) }, entry: { initialIndex: current.history.length, reference: branch ? undefined : positionReference } })
          exiting.current = false; setBusy(false)
        })}>临时练习</button>}
        {!temporary && <section><h2>分析与点评</h2><p>当前分析第 {analyzedMove} 手；棋盘显示已走 {cursor} 手。快速 256 visits / 12 秒；加深 2000 visits / 30 秒。</p>
          <div className="go-study-actions"><button disabled={busy || !loaded || Boolean(branch) || !source.history.length} onClick={() => analyze(false)}>分析本手</button><button disabled={busy || !loaded || Boolean(branch) || !source.history.length} onClick={() => analyze(true)}>分析全局</button><button disabled={busy || !loaded || Boolean(branch) || !source.history.length} onClick={() => analyze(false, 'fast')}>加深本手</button><select aria-label="查看分析档位" value={profile} disabled={busy} onChange={(event) => setProfile(event.target.value as GoStudyProfile)}><option value="winrate">快速分析</option><option value="fast">加深分析</option></select>{busy && <button onClick={() => { cancel(); setNotice('已停止，完成部分已保留。') }}>停止</button>}</div>
          <p role="status">{notice}</p>{error && <p role="alert">{error}</p>}
          <button onClick={() => downloadGoFile('go-study-backup.json', JSON.stringify({ format: 'project10-go-library', version: 1, game, analyses: cache.filter((entry) => entry.gameId === game.id) }, null, 2))}>下载原谱与分析备份</button>
          <p>棋谱事实：本手提子 {source.history[analyzedMove - 1]?.captures.length ?? 0} 枚；对方下一手提子 {source.history[analyzedMove]?.captures.length ?? 0} 枚。被提子可能是交换或弃子，不能直接判坏棋。</p>
          {currentComparison && <Evidence label="原着分析" comparison={currentComparison} />}
          {trial && <Evidence label="重试分析" comparison={trial} />}
          {trial && <button disabled={busy} onClick={deepenTrial}>按统一档位加深原着与重试</button>}
        </section>
        }
        <section><h2>重试与继续练习</h2><div className="go-study-actions"><button disabled={busy || (temporary ? (practiceBase ?? current).phase !== 'playing' : !source.history.length)} onClick={beginRetry}>{temporary ? trialPosition ? '重新作答' : '重走一手' : '重试这一手'}</button><label>执子<select aria-label="练习执子" value={human} disabled={busy || practiceMode === 'continue'} onChange={(event) => setHuman(event.target.value as GoPlayer)}><option value="black">黑方</option><option value="white">白方</option></select></label><button disabled={busy || current.phase !== 'playing'} onClick={continuePractice}>{temporary ? practiceMode ? '继续挑战' : '开始练习' : branch?.turn !== human && branch ? '继续练习 / 重试 AI 应手' : '继续练习'}</button></div><p>真人不限时，KataGo 使用 2000 visits / 30 秒档位。{temporary ? '练习分支不会自动保存，离开后清除。' : '第一手练习落子后自动另存，原棋局不覆盖。'}</p></section>
        {!temporary && <><WinRateChart points={chartPoints} status={busy ? 'analyzing' : chartPoints.length ? 'ready' : 'idle'} error={null} selectedMove={cursor} onSelectMove={navigate} />
        <section><h2>待复查着法</h2><p>预计损失 ≥2 目或胜率降低 ≥10 个百分点；仅为搜索提示，不是确定判错。</p><div className="go-study-actions">{Object.entries(comparisons).filter(([, comparison]) => comparison.reviewWorthy).map(([step]) => <button key={step} onClick={() => navigate(Number(step))}>第 {step} 手</button>)}</div></section>
        </>}
        <section><h2>完整棋谱</h2><div className="go-study-moves">{source.history.map((move) => <button key={move.moveNumber} aria-current={cursor === move.moveNumber ? 'step' : undefined} onClick={() => navigate(move.moveNumber)}>{move.moveNumber}. {move.color === 'black' ? '黑' : '白'} {move.notation}</button>)}</div></section>
      </aside>
    </div>
  </main>
}

function Evidence({ comparison, label }: { comparison: GoMoveComparison; label: string }) {
  return <div className="go-study-evidence"><h3>{label}</h3><p>推荐 {comparison.best ?? '无合法候选'}；所选 {comparison.actual}。</p>{comparison.notes.map((note) => <p key={note}>{note}</p>)}<p>合法候选变化：{comparison.variation.join(' → ') || '未提供'}。合法不代表已证明强制。</p>{[comparison.before, comparison.after].map((event, index) => <p key={index}>{index ? '落子后' : '落子前'}：黑胜率 {(event.root.winrate * 100).toFixed(1)}%；黑方预计目差 {event.root.scoreLead?.toFixed(1) ?? '未知'}；{event.root.visits}/{event.requestedVisits} visits，{(event.elapsedMs / 1000).toFixed(1)} 秒。{event.modelName} · {event.engineVersion} · {event.runtimeBackend}{event.modelFallback ? ' · 模型回退' : ''}{event.backendFallback ? ' · 后端回退' : ''}{event.timedOut ? ' · 超时' : ''}</p>)}</div>
}
