import { ChessStudyActions } from './ChessStudyActions'
import { ChessStudyPage } from './ChessStudyPage'
import type { ChessStudyEntry } from './ChessTemporaryStudy'
import { useMemo, useState } from 'react'
import { GAME_ROUTES } from '../routes'
import { BoardWorkbenchTabs, type WorkbenchPanel } from '../core'
import { serializeMatchArchive } from '../core/archive'
import { createChessArchive, exportChessPgn } from './archive'
import { ChessBoard } from './ChessBoard'
import { ChessGuessPanel } from './ChessGuessPanel'
import { ChessMatchInfoPanel } from './ChessMatchInfoPanel'
import { CHESS_PERSONALITIES, CHESS_SEARCH_PROFILES, chessPersonalityForColor } from './ai-engine'
import { evaluationCpForWhite, formatWhiteScore, pvToSan, wdlForWhite } from './analysis'
import { useChessMatch } from './useChessMatch'
import { ChessLibraryActions } from './ChessLibraryActions'
import type { ChessColor, ChessGameState, ChessLiveAnalysis, ChessSearchBudgetId, ChessTurnAnalysis } from './types'
import './chess.css'

type PanelId = 'match' | 'analysis' | 'history' | 'engine'

export function ChessGamePage() {
  const [study, setStudy] = useState<ChessStudyEntry | null>(null)
  const match = useChessMatch()
  const [activePanel, setActivePanel] = useState<PanelId>('match')
  const guessing = match.guess.phase !== 'off'
  const choosing = match.guess.phase === 'choosing'
  const revealed = match.guess.phase === 'revealed' ? match.guess.round?.analysis : undefined
  const displayAnalyses = guessing ? revealed?.source === 'engine' ? { [revealed.color]: revealed } : {} : match.analyses
  const displayLiveInfo = guessing ? {} : match.liveInfo
  const liveAnalysis = match.liveInfo[match.state.turn]
  const activeAnalysis = guessing ? revealed?.source === 'engine' ? revealed : undefined : liveAnalysis?.rootFen === match.state.fen
    ? liveAnalysis
    : latestCompletedAnalysis(match.analyses)
  const busy = match.runState === 'loading' || match.runState === 'running' || match.runState === 'thinking'
  const status = match.state.result ? resultLabel(match.state) : match.runState === 'error' ? '引擎故障已暂停' : match.runState === 'loading' ? '正在加载或恢复引擎' : match.runState === 'paused' ? '观战已暂停' : busy ? `${colorLabel(match.state.turn)}方思考中` : '已就绪'
  const panels = useMemo(() => createPanels(match.state, activeAnalysis, match), [match, activeAnalysis])
  if (study) return <ChessStudyPage entry={study} onClose={() => setStudy(null)} />
  return (
    <main className="chess-page">
      <div className="chess-page__ambient chess-page__ambient--one" aria-hidden="true" />
      <div className="chess-page__ambient chess-page__ambient--two" aria-hidden="true" />
      <header className="chess-header">
        <a className="chess-back" href={GAME_ROUTES.chess}>← <span>国际象棋模式</span></a>
        <div className="chess-brand"><span>♞</span><div><strong>PROJECT10 · CHESS</strong><small>STANDARD AI THEATRE</small></div></div>
        <div className={`chess-runtime chess-runtime--${match.runState}`}><i /> <span>{runtimeLabel(match.runState)}</span><b>{match.profile.mode === 'professional' ? 'STOCKFISH 18 · PV1 专业模式' : 'FAIRY‑STOCKFISH · 双人格'}</b></div>
      </header>
      <ChessLibraryActions mode="theatre" id={match.libraryId} state={match.state} players={match.archivePlayers} status={match.saveStatus} pause={match.suspendForStudy} saveNow={match.saveNow} />

      <section className="chess-arena" aria-labelledby="chess-page-title">
        <div className="chess-stage">
          <div className="chess-heading"><div><p>FIDE 标准规则 · UCI / NNUE · 可审计运行时</p><h1 id="chess-page-title">{match.profile.mode === 'professional' ? 'Stockfish 18 专业对弈' : '双人格观战剧场'}</h1></div><div className="chess-phase"><span>{status}</span><strong>{String(match.state.history.length).padStart(2, '0')} PLY</strong></div></div>
          <ChessBoard state={match.state} interactive={choosing} humanColor={match.state.turn}
            disabled={!choosing || match.guessBusy} onMove={match.selectGuess}
            guessMove={choosing ? match.guess.round?.selected : null}
            interactionKey={`${match.guess.phase}-${match.guess.round?.id ?? 0}`} />
          <ChessGuessPanel match={match} onStudy={setStudy} />
          <ChessStudyActions match={match} onOpen={setStudy} />
          <ChessMatchInfoPanel state={match.state} analyses={displayAnalyses} liveInfo={displayLiveInfo} />
          <div className="chess-seats">
            <Seat color="w" active={match.state.turn === 'w' && busy} name={match.profile.mode === 'professional' ? 'Stockfish 18 · PV1' : CHESS_PERSONALITIES[match.seats.w?.personality ?? personalityFor(match.state, 'w')].label} analysis={displayAnalyses.w} profile={match.seats.w?.profile?.version} />
            <div className="chess-versus">VS</div>
            <Seat color="b" active={match.state.turn === 'b' && busy} name={match.profile.mode === 'professional' ? 'Stockfish 18 · PV1' : CHESS_PERSONALITIES[match.seats.b?.personality ?? personalityFor(match.state, 'b')].label} analysis={displayAnalyses.b} profile={match.seats.b?.profile?.version} />
          </div>
        </div>

        <aside className="chess-console" aria-label="国际象棋观战工作台">
          <section className="chess-console__status" aria-live="polite"><span className="chess-console__eyebrow">CURRENT SESSION</span><strong>{status}</strong><small>{match.notice}</small></section>
          <BoardWorkbenchTabs active={activePanel} onChange={setActivePanel} panels={panels} label="国际象棋工作台" />
        </aside>
      </section>
      <footer className="chess-footer"><span>STANDARD-CHESS-FIDE-CLAIMS-V2</span><i /><span>三次重复可申请 · 五次重复自动和棋</span></footer>
    </main>
  )
}

function createPanels(state: ChessGameState, activeAnalysis: ChessTurnAnalysis | ChessLiveAnalysis | undefined, match: ReturnType<typeof useChessMatch>): readonly WorkbenchPanel<PanelId>[] {
  return [
    { id: 'match', label: '对局', eyebrow: 'MATCH', content: <MatchPanel state={state} match={match} /> },
    { id: 'analysis', label: '分析', eyebrow: 'LIVE', content: <AnalysisPanel analysis={activeAnalysis} /> },
    { id: 'history', label: '棋谱', eyebrow: 'PGN', content: <HistoryPanel state={state} /> },
    { id: 'engine', label: '引擎', eyebrow: 'UCI', content: <EnginePanel match={match} /> },
  ]
}

function MatchPanel({ state, match }: { state: ChessGameState; match: ReturnType<typeof useChessMatch> }) {
  const finished = Boolean(state.result)
  const guessing = match.guess.phase !== 'off'
  return <div className="chess-panel-content"><div className="chess-opening"><span>OPENING / {state.openingId}</span><strong>{state.openingName}</strong><small>种子 {state.seed}</small></div><div className="chess-budget"><span>SEARCH BUDGET</span>{(Object.keys(CHESS_SEARCH_PROFILES) as ChessSearchBudgetId[]).map((id) => <button key={id} className={match.budgetId === id ? 'is-active' : ''} disabled={finished || match.guessBusy || match.runState === 'loading' || match.runState === 'thinking' || match.runState === 'running'} onClick={() => match.changeBudget(id)}>{CHESS_SEARCH_PROFILES[id].label}</button>)}</div><div className="chess-controls"><button className="chess-button chess-button--primary" disabled={finished || match.runState === 'loading' || (guessing && match.runState !== 'thinking' && match.runState !== 'running')} onClick={match.runState === 'running' || match.runState === 'thinking' ? match.pause : match.start}>{finished ? '对局已结束' : match.runState === 'running' || match.runState === 'thinking' ? '暂停' : match.runState === 'paused' ? '继续' : '开始观战'}</button><button className="chess-button" disabled={finished || guessing || match.runState === 'loading' || match.runState === 'running' || match.runState === 'thinking'} onClick={match.step}>单步</button><button className="chess-button" onClick={() => void match.newGame()}>新局</button><button className="chess-button" onClick={() => void match.restore()}>恢复最近</button></div></div>
}

function AnalysisPanel({ analysis }: { analysis: ChessTurnAnalysis | ChessLiveAnalysis | undefined }) {
  const info = analysis?.info
  const color = analysis?.color ?? 'w'
  const evaluationCp = evaluationCpForWhite(info, color)
  const wdl = wdlForWhite(info?.wdl, color)
  const pv = isCompletedAnalysis(analysis) ? analysis.response?.info.pv ?? analysis.info.pv : analysis?.info.pv ?? []
  const fallbackMove = isCompletedAnalysis(analysis) ? analysis.uci : null
  return <div className="chess-panel-content"><div className="chess-eval"><span>WHITE POV</span><strong>{formatWhiteScore(info, color)}</strong><i style={{ height: `${Math.min(92, Math.max(8, 50 + evaluationCp / 10))}%` }} /></div><dl className="chess-metrics"><div><dt>DEPTH</dt><dd>{info?.depth ?? '—'}</dd></div><div><dt>NODES</dt><dd>{info?.nodes?.toLocaleString() ?? '—'}</dd></div><div><dt>NPS</dt><dd>{info?.nps?.toLocaleString() ?? '—'}</dd></div><div><dt>TIME</dt><dd>{info?.elapsedMs ?? '—'} ms</dd></div><div><dt>WDL</dt><dd>{wdl ? `${wdl.win}/${wdl.draw}/${wdl.loss}` : '—'}</dd></div></dl><div className="chess-pv"><span>SAN / UCI 主变化</span><code>{analysis && pv.length ? `${pvToSan(analysis.rootFen, pv)} · ${pv.join(' ')}` : fallbackMove || '等待搜索…'}</code></div></div>
}

function HistoryPanel({ state }: { state: ChessGameState }) {
  const archive = createChessArchive({ state, players: [{ seat: 'w', kind: 'ai', name: CHESS_PERSONALITIES[chessPersonalityForColor(state.seed, 'w')].label }, { seat: 'b', kind: 'ai', name: CHESS_PERSONALITIES[chessPersonalityForColor(state.seed, 'b')].label }] })
  return <div className="chess-panel-content"><div className="chess-history">{state.history.length === 0 ? <span>开局前缀将在开始后逐步动画播放。</span> : state.history.map((record, index) => <div key={`${index}-${record.uci}`}><small>{Math.floor(index / 2) + 1}{record.color === 'w' ? '.' : '…'}</small><strong>{record.san}</strong><code>{record.uci}</code></div>)}</div><div className="chess-export"><button onClick={() => downloadText('project10-chess.pgn', exportChessPgn(state), 'application/x-chess-pgn')}>下载 PGN</button><button onClick={() => downloadText('project10-chess.json', serializeMatchArchive(archive), 'application/json')}>下载 JSON</button><button onClick={() => void navigator.clipboard?.writeText(exportChessPgn(state))}>复制棋谱</button></div></div>
}

function EnginePanel({ match }: { match: ReturnType<typeof useChessMatch> }) {
  const professional = match.profile.mode === 'professional'
  return <div className="chess-panel-content"><p className="chess-engine-note">引擎：<code>{professional ? 'Stockfish 18 · cb3d4ee' : 'Fairy-Stockfish · 5589ea54'}</code><br />模型：<code>{professional ? 'Stockfish 18 embedded NNUE' : 'nn-3475407dc199.nnue'}</code><br />资源指纹：<code>{professional ? '8bef136a3d7a…80373cb' : '3475407dc199…6689ec87'}</code><br />请求预算：<code>{match.profile.movetimeMs} ms · MultiPV {match.profile.multiPv}</code><br />选招策略：<code>{professional ? '始终 PV1；不使用人格重排' : '安全门槛内个性化；优先非重复'}</code></p><EngineSeat color="w" match={match} /><EngineSeat color="b" match={match} />{match.error && <p className="chess-error">{match.error}</p>}</div>
}

function EngineSeat({ color, match }: { color: ChessColor; match: ReturnType<typeof useChessMatch> }) {
  const seat = match.seats[color]
  const fallback = personalityFor(match.state, color)
  const detail = seat?.error
    ? `故障：${seat.error}`
    : seat?.progress && seat.progress.phase !== 'ready'
      ? `${seat.progress.message} · ${seat.progress.loaded}/${seat.progress.total}`
      : seat?.profile
        ? `${seat.profile.threads} threads · ${seat.profile.hashMb} MB · 正常`
        : color === 'w' ? '进入观战后按需加载' : '独立 UCI Worker'
  return <div className="chess-engine-seat"><span>{match.profile.mode === 'professional' ? '专业 PV1' : CHESS_PERSONALITIES[seat?.personality ?? fallback].label} · {color === 'w' ? '白' : '黑'}</span><strong>{seat?.profile?.version ?? '未加载'}</strong><small>{detail}</small></div>
}

function Seat({ color, active, name, analysis, profile }: { color: ChessColor; active: boolean; name: string; analysis?: ChessTurnAnalysis; profile?: string }) { return <div className={`chess-seat chess-seat--${color}${active ? ' is-active' : ''}`}><span className="chess-seat__mark">{color === 'w' ? '♔' : '♚'}</span><div><small>{color === 'w' ? 'WHITE' : 'BLACK'}</small><strong>{name}</strong><span>{analysis?.uci ?? profile ?? 'READY'}</span></div></div> }
function colorLabel(color: ChessColor) { return color === 'w' ? '白' : '黑' }
function personalityFor(state: ChessGameState, color: ChessColor) { return chessPersonalityForColor(state.seed, color) }
function resultLabel(state: ChessGameState) {
  const reason = state.result?.reason
  if (reason === 'checkmate') return `${state.result?.winner === 'w' ? '白' : '黑'}方将死`
  if (reason === 'technical-stop') return '技术停止（400 半回合）'
  if (reason === 'threefold-repetition') return `${state.result?.claimant === 'w' ? '白' : '黑'}方申请三次重复和棋`
  if (reason === 'fifty-move') return `${state.result?.claimant === 'w' ? '白' : '黑'}方申请五十回合和棋`
  if (reason === 'fivefold-repetition') return '五次重复自动和棋'
  if (reason === 'seventy-five-move') return '七十五回合自动和棋'
  return '和棋'
}
function runtimeLabel(runState: string) { return ({ ready: 'READY', loading: 'LOADING MODEL', running: 'AUTO PLAY', thinking: 'THINKING', paused: 'PAUSED', finished: 'FINISHED', error: 'ERROR' } as Record<string, string>)[runState] ?? runState.toUpperCase() }
function latestCompletedAnalysis(analyses: Partial<Record<ChessColor, ChessTurnAnalysis>>): ChessTurnAnalysis | undefined { return Object.values(analyses).sort((left, right) => right.ply - left.ply)[0] }
function isCompletedAnalysis(analysis: ChessTurnAnalysis | ChessLiveAnalysis | undefined): analysis is ChessTurnAnalysis { return Boolean(analysis && 'uci' in analysis) }
function downloadText(name: string, value: string, type: string) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([value], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href) }
