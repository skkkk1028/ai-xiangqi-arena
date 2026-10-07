import { useMemo, useState } from 'react'
import { BoardWorkbenchTabs, type WorkbenchPanel } from '../core'
import { GAME_ROUTES } from '../routes'
import { ChessBoard } from './ChessBoard'
import { ChessMatchInfoPanel } from './ChessMatchInfoPanel'
import { CHESS_ARENA_PROFILES, arenaEngineLabel, useChessMatch } from './useChessMatch'
import { ChessLibraryActions } from './ChessLibraryActions'
import type { ChessArenaBudgetId, ChessArenaEngineId, ChessColor, ChessGameState } from './types'
import './chess.css'

type HumanPanel = 'setup' | 'moves' | 'analysis' | 'engine'

const HUMAN_ENGINES: readonly { id: ChessArenaEngineId; note: string }[] = [
  { id: 'stockfish-18', note: '官方 Stockfish 18，原生桥接可用时优先使用，未连接时按项目配置回退。' },
  { id: 'fairy-stockfish-chess', note: '现有 Fairy-Stockfish 国际象棋 NNUE Worker，适合浏览器直接运行。' },
  { id: 'obsidian-16', note: '独立 GPL-3.0 C++ UCI/NNUE 引擎，需要本地预览桥接。' },
]

export function ChessHumanPage() {
  const match = useChessMatch({ mode: 'human' })
  const [panel, setPanel] = useState<HumanPanel>('setup')
  const busy = ['loading', 'running', 'thinking'].includes(match.runState)
  const humanTurn = match.state.turn === match.humanColor
  const boardInteractive = match.runState === 'paused' && humanTurn && !match.state.result
  const setupLocked = busy || match.state.history.length > 0 || match.runState === 'paused' || match.runState === 'finished'
  const status = match.state.result
    ? humanResultLabel(match.state)
    : match.runState === 'error'
      ? '引擎故障已暂停'
      : busy
        ? `${match.state.turn === 'w' ? '白' : '黑'}方 AI 思考中`
        : boardInteractive
          ? '轮到你行棋'
          : '等待开始'
  const panels = useMemo<readonly WorkbenchPanel<HumanPanel>[]>(() => [
    { id: 'setup', label: '配置', eyebrow: 'SETUP', content: <HumanSetup match={match} locked={setupLocked} /> },
    { id: 'moves', label: '棋谱', eyebrow: 'MOVES', content: <HumanMoves state={match.state} /> },
    { id: 'analysis', label: '分析', eyebrow: 'PV1', content: <HumanAnalysis match={match} /> },
    { id: 'engine', label: '引擎', eyebrow: 'UCI', content: <HumanEngine match={match} /> },
  ], [match, setupLocked])

  return (
    <main className="chess-page chess-human-page">
      <div className="chess-page__ambient chess-page__ambient--one" aria-hidden="true" />
      <div className="chess-page__ambient chess-page__ambient--two" aria-hidden="true" />
      <header className="chess-header">
        <a className="chess-back" href={GAME_ROUTES.chess}>← <span>国际象棋模式</span></a>
        <div className="chess-brand"><span>♙</span><div><strong>PROJECT10 · HUMAN MATCH</strong><small>HUMAN VS ENGINE</small></div></div>
        <div className={`chess-runtime chess-runtime--${match.runState}`}><i /><span>{match.runState.toUpperCase()}</span><b>{arenaEngineLabel(match.humanEngine)} · {match.profile.label}</b></div>
      </header>
      <ChessLibraryActions mode="human" id={match.libraryId} state={match.state} players={match.archivePlayers} status={match.saveStatus} pause={match.pause} saveNow={match.saveNow} />
      <section className="chess-arena" aria-labelledby="human-title">
        <div className="chess-stage">
          <div className="chess-heading"><div><p>FIDE 标准规则 · 真人执一方 · 现有三种 AI 引擎</p><h1 id="human-title">人机对战</h1></div><div className="chess-phase"><span>{status}</span><strong>{String(match.state.history.length).padStart(2, '0')} PLY</strong></div></div>
          <div className="human-versus">
            <HumanSeat color={match.humanColor} name={`真人 · ${match.humanColor === 'w' ? '白方' : '黑方'}`} active={humanTurn && !match.state.result} />
            <span>VS</span>
            <HumanSeat color={match.humanColor === 'w' ? 'b' : 'w'} name={arenaEngineLabel(match.humanEngine)} active={!humanTurn && busy} />
          </div>
          <ChessBoard state={match.state} interactive={boardInteractive} humanColor={match.humanColor} disabled={!boardInteractive} onMove={match.playHumanMove} />
          <p className="human-board-hint">{boardInteractive ? '点击你的棋子，再点击目标格完成落子；升变时选择后、车、象或马。' : match.state.result ? '本局已结束。' : '点击“开始对战”后，轮到你时即可在棋盘上落子。'}</p>
          <ChessMatchInfoPanel state={match.state} analyses={match.analyses} liveInfo={match.liveInfo} />
        </div>
        <aside className="chess-console" aria-label="人机对战工作台">
          <section className="chess-console__status" aria-live="polite"><span className="chess-console__eyebrow">HUMAN MATCH SESSION</span><strong>{status}</strong><small>{match.notice}</small></section>
          <BoardWorkbenchTabs active={panel} onChange={setPanel} panels={panels} label="人机对战工作台" />
        </aside>
      </section>
      <footer className="chess-footer"><span>HUMAN-VS-ENGINE-FIDE</span><i /><span>三种 AI 引擎 · 可选思考强度 · 走子与优势分实时记录</span></footer>
    </main>
  )
}

function HumanSetup({ match, locked }: { match: ReturnType<typeof useChessMatch>; locked: boolean }) {
  const humanTurn = match.state.turn === match.humanColor
  const busy = ['loading', 'running', 'thinking'].includes(match.runState)
  const finished = Boolean(match.state.result)
  const startDisabled = finished || match.runState === 'loading' || (match.runState === 'paused' && humanTurn)
  return <div className="chess-panel-content">
    <label className="human-option"><span>真人执子方</span><select aria-label="真人执子方" value={match.humanColor} disabled={locked} onChange={(event) => match.changeHumanColor(event.target.value as ChessColor)}><option value="w">白方</option><option value="b">黑方</option></select><small>选择你控制的颜色；另一方由 AI 执子。</small></label>
    <label className="human-option"><span>AI 对手</span><select aria-label="AI 对手" value={match.humanEngine} disabled={locked} onChange={(event) => match.changeHumanEngine(event.target.value as ChessArenaEngineId)}>{HUMAN_ENGINES.map((engine) => <option key={engine.id} value={engine.id}>{arenaEngineLabel(engine.id)}</option>)}</select><small>{HUMAN_ENGINES.find((engine) => engine.id === match.humanEngine)?.note}</small></label>
    <div className="chess-budget"><span>AI 思考强度</span>{(Object.keys(CHESS_ARENA_PROFILES) as ChessArenaBudgetId[]).map((id) => <button key={id} className={match.budgetId === id ? 'is-active' : ''} disabled={locked} onClick={() => match.changeBudget(id)}>{CHESS_ARENA_PROFILES[id].label}</button>)}</div>
    <div className="human-rules-note">思考强度只影响 AI 搜索时长、线程和 Hash；不会改变棋盘规则，也不会限制真人可走的合法着法。</div>
    <div className="chess-controls"><button className="chess-button chess-button--primary" disabled={startDisabled} onClick={busy ? match.pause : match.start}>{finished ? '对局已结束' : busy ? '暂停思考' : match.runState === 'paused' && humanTurn ? '等待你的落子' : match.runState === 'paused' ? '继续对战' : '开始对战'}</button><button className="chess-button" disabled={finished || busy || humanTurn} onClick={match.step}>AI 单步</button><button className="chess-button" onClick={() => void match.newGame()}>新局</button><button className="chess-button" onClick={() => void match.restore()}>恢复最近</button></div>
  </div>
}

function HumanSeat({ color, name, active }: { color: ChessColor; name: string; active: boolean }) { return <div className={`human-seat human-seat--${color}${active ? ' is-active' : ''}`}><span>{color === 'w' ? '♔' : '♚'}</span><div><small>{color === 'w' ? 'WHITE' : 'BLACK'}</small><strong>{name}</strong></div></div> }
function HumanMoves({ state }: { state: ChessGameState }) { return <div className="chess-panel-content"><div className="chess-history">{state.history.length === 0 ? <span>尚未开始对局。</span> : state.history.map((move, index) => <div key={`${index}-${move.uci}`}><small>{Math.floor(index / 2) + 1}{move.color === 'w' ? '.' : '…'}</small><strong>{move.san}</strong><code>{move.uci}</code></div>)}</div></div> }
function HumanAnalysis({ match }: { match: ReturnType<typeof useChessMatch> }) { const analysis = Object.values(match.analyses).sort((a, b) => b!.ply - a!.ply)[0]; return <div className="chess-panel-content"><div className="chess-pv"><span>ENGINE PV1</span><code>{analysis?.response?.info.pv.join(' ') || analysis?.uci || '等待 AI 搜索…'}</code></div><dl className="chess-metrics"><div><dt>DEPTH</dt><dd>{analysis?.info.depth ?? '—'}</dd></div><div><dt>NODES</dt><dd>{analysis?.info.nodes?.toLocaleString() ?? '—'}</dd></div><div><dt>TIME</dt><dd>{analysis?.info.elapsedMs ?? '—'} ms</dd></div></dl></div> }
function HumanEngine({ match }: { match: ReturnType<typeof useChessMatch> }) { const aiColor = match.humanColor === 'w' ? 'b' : 'w'; const seat = match.seats[aiColor]; return <div className="chess-panel-content"><div className="chess-engine-seat"><span>{arenaEngineLabel(match.humanEngine)} · {aiColor === 'w' ? '白方' : '黑方'}</span><strong>{seat?.profile?.version ?? '开赛后加载'}</strong><small>{seat?.profile ? `${seat.profile.threads} threads · ${seat.profile.hashMb} MB` : seat?.error ?? '未建立 AI 会话'}</small></div>{match.error && <p className="chess-error">{match.error}</p>}</div> }
function humanResultLabel(state: ChessGameState) { if (state.result?.reason === 'checkmate') return `${state.result.winner === 'w' ? '白' : '黑'}方将死`; if (state.result?.reason === 'technical-stop') return '技术停止'; return '对局结束' }
