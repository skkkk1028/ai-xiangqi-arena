import { useMemo, useState } from 'react'
import { BoardWorkbenchTabs, type WorkbenchPanel } from '../core'
import { GAME_ROUTES } from '../routes'
import { ChessBoard } from './ChessBoard'
import { ChessMatchInfoPanel } from './ChessMatchInfoPanel'
import { createChessArchive, exportChessArenaPgn } from './archive'
import { serializeMatchArchive } from '../core/archive'
import { CHESS_ARENA_PROFILES, arenaEngineLabel, useChessMatch } from './useChessMatch'
import type { ChessArenaBudgetId, ChessArenaEngineId, ChessColor, ChessGameState, ChessTurnAnalysis } from './types'
import './chess.css'

type ArenaPanel = 'setup' | 'analysis' | 'moves' | 'runtime'

const ENGINES: readonly { id: ChessArenaEngineId; description: string; availability: string }[] = [
  { id: 'stockfish-18', description: '官方 Stockfish 18；原生竞技场优先，桥接不可用时回退完整浏览器 WASM。', availability: '原生 / 浏览器回退' },
  { id: 'obsidian-16', description: '独立 GPL-3.0 C++ UCI/NNUE 引擎；固定官方 v16.0。', availability: '需要本地预览' },
  { id: 'fairy-stockfish-chess', description: '现有 Fairy-Stockfish 标准国际象棋 NNUE Worker；竞技场始终采用 PV1。', availability: '浏览器 Worker' },
]

export function ChessArenaPage() {
  const match = useChessMatch({ mode: 'arena' })
  const [panel, setPanel] = useState<ArenaPanel>('setup')
  const busy = ['loading', 'running', 'thinking'].includes(match.runState)
  const locked = busy || match.state.history.length > 0 || match.runState === 'paused' || match.runState === 'finished'
  const status = match.state.result ? resultLabel(match.state) : match.runState === 'error' ? '引擎故障已暂停' : match.runState === 'paused' ? '竞技场已暂停' : busy ? `${match.state.turn === 'w' ? '白' : '黑'}方思考中` : '等待配置并开赛'
  const panels = useMemo<readonly WorkbenchPanel<ArenaPanel>[]>(() => [
    { id: 'setup', label: '配置', eyebrow: 'SETUP', content: <Setup match={match} locked={locked} /> },
    { id: 'analysis', label: '分析', eyebrow: 'PV1', content: <ArenaAnalysis match={match} /> },
    { id: 'moves', label: '棋谱', eyebrow: 'MOVES', content: <ArenaMoves state={match.state} players={match.archivePlayers} /> },
    { id: 'runtime', label: '运行时', eyebrow: 'UCI', content: <ArenaRuntime match={match} /> },
  ], [locked, match])

  return (
    <main className="chess-page chess-arena-page">
      <div className="chess-page__ambient chess-page__ambient--one" aria-hidden="true" />
      <header className="chess-header">
        <a className="chess-back" href={GAME_ROUTES.chess}>← <span>国际象棋模式</span></a>
        <div className="chess-brand"><span>♛</span><div><strong>PROJECT10 · ENGINE ARENA</strong><small>INDEPENDENT UCI MATCH</small></div></div>
        <div className={`chess-runtime chess-runtime--${match.runState}`}><i /><span>{match.runState.toUpperCase()}</span><b>同资源 · MultiPV 1 · PV1</b></div>
      </header>
      <section className="chess-arena" aria-labelledby="arena-title">
        <div className="chess-stage">
          <div className="chess-heading"><div><p>FIDE 标准规则 · 双独立会话 · 中立选招</p><h1 id="arena-title">多引擎对战竞技场</h1></div><div className="chess-phase"><span>{status}</span><strong>{String(match.state.history.length).padStart(2, '0')} PLY</strong></div></div>
          <div className="arena-engine-versus">
            <EngineBadge color="w" id={match.arenaEngines.w} active={busy && match.state.turn === 'w'} />
            <span>VS</span>
            <EngineBadge color="b" id={match.arenaEngines.b} active={busy && match.state.turn === 'b'} />
          </div>
          <ChessBoard state={match.state} />
          <ChessMatchInfoPanel state={match.state} analyses={match.analyses} liveInfo={match.liveInfo} />
        </div>
        <aside className="chess-console" aria-label="多引擎竞技场工作台">
          <section className="chess-console__status" aria-live="polite"><span className="chess-console__eyebrow">FAIR MATCH SESSION</span><strong>{status}</strong><small>{match.notice}</small></section>
          <BoardWorkbenchTabs active={panel} onChange={setPanel} panels={panels} label="多引擎竞技场工作台" />
        </aside>
      </section>
      <footer className="chess-footer"><span>ENGINE-ARENA-V1</span><i /><span>Obsidian 16 为同级候选，尚未通过项目内 ±50 Elo 认证</span></footer>
    </main>
  )
}

function Setup({ match, locked }: { match: ReturnType<typeof useChessMatch>; locked: boolean }) {
  return <div className="chess-panel-content">
    <EngineSelect color="w" value={match.arenaEngines.w} disabled={locked} onChange={match.changeArenaEngine} />
    <EngineSelect color="b" value={match.arenaEngines.b} disabled={locked} onChange={match.changeArenaEngine} />
    <div className="chess-budget"><span>双方统一资源</span>{(Object.keys(CHESS_ARENA_PROFILES) as ChessArenaBudgetId[]).map((id) => <button key={id} className={match.budgetId === id ? 'is-active' : ''} disabled={locked} onClick={() => match.changeBudget(id)}>{CHESS_ARENA_PROFILES[id].label}</button>)}</div>
    <p className="arena-fairness">双方始终使用相同线程、Hash 和每步墙钟时间。跨引擎对战不使用“相同节点数”，因为不同引擎的节点不可直接比较。</p>
    <div className="chess-controls"><button className="chess-button chess-button--primary" disabled={Boolean(match.state.result) || match.runState === 'loading'} onClick={busyState(match.runState) ? match.pause : match.start}>{match.state.result ? '对局已结束' : busyState(match.runState) ? '暂停' : match.runState === 'paused' ? '继续' : '开始对战'}</button><button className="chess-button" disabled={Boolean(match.state.result) || busyState(match.runState)} onClick={match.step}>单步</button><button className="chess-button" onClick={() => void match.newGame()}>新局</button><button className="chess-button" onClick={() => void match.restore()}>恢复最近</button></div>
  </div>
}

function EngineSelect({ color, value, disabled, onChange }: { color: ChessColor; value: ChessArenaEngineId; disabled: boolean; onChange: (color: ChessColor, id: ChessArenaEngineId) => void }) {
  const selected = ENGINES.find((engine) => engine.id === value)!
  return <label className="arena-engine-select"><span>{color === 'w' ? '白方引擎' : '黑方引擎'}</span><select aria-label={`${color === 'w' ? '白' : '黑'}方 AI 引擎`} value={value} disabled={disabled} onChange={(event) => onChange(color, event.target.value as ChessArenaEngineId)}>{ENGINES.map((engine) => <option key={engine.id} value={engine.id}>{arenaEngineLabel(engine.id)}</option>)}</select><small>{selected.description}</small><em>{selected.availability}</em></label>
}

function EngineBadge({ color, id, active }: { color: ChessColor; id: ChessArenaEngineId; active: boolean }) { return <div className={`arena-engine-badge${active ? ' is-active' : ''}`}><span>{color === 'w' ? '♔ WHITE' : 'BLACK ♚'}</span><strong>{arenaEngineLabel(id)}</strong></div> }
function ArenaAnalysis({ match }: { match: ReturnType<typeof useChessMatch> }) { const analysis = latest(match.analyses); return <div className="chess-panel-content"><dl className="chess-metrics"><div><dt>DEPTH</dt><dd>{analysis?.info.depth ?? '—'}</dd></div><div><dt>NODES</dt><dd>{analysis?.info.nodes.toLocaleString() ?? '—'}</dd></div><div><dt>NPS</dt><dd>{analysis?.info.nps.toLocaleString() ?? '—'}</dd></div><div><dt>TIME</dt><dd>{analysis?.info.elapsedMs ?? '—'} ms</dd></div></dl><div className="chess-pv"><span>ENGINE PV1</span><code>{analysis?.response?.info.pv.join(' ') || analysis?.uci || '等待搜索…'}</code></div></div> }
function ArenaMoves({ state, players }: { state: ChessGameState; players: ReturnType<typeof useChessMatch>['archivePlayers'] }) { const safePlayers = players.length === 2 ? players : [{ seat: 'w', kind: 'ai' as const, name: '竞技场白方引擎' }, { seat: 'b', kind: 'ai' as const, name: '竞技场黑方引擎' }]; const archive = createChessArchive({ state, players: safePlayers }); const pgn = exportChessArenaPgn(state, safePlayers); return <div className="chess-panel-content"><div className="chess-history">{state.history.length ? state.history.map((move, index) => <div key={`${index}-${move.uci}`}><small>{Math.floor(index / 2) + 1}{move.color === 'w' ? '.' : '…'}</small><strong>{move.san}</strong><code>{move.uci}</code></div>) : <span>尚未开始对局。</span>}</div><div className="chess-export"><button onClick={() => download('project10-chess-arena.pgn', pgn, 'application/x-chess-pgn')}>下载 PGN</button><button onClick={() => download('project10-chess-arena.json', serializeMatchArchive(archive), 'application/json')}>下载 JSON</button><button onClick={() => void navigator.clipboard?.writeText(pgn)}>复制棋谱</button></div></div> }
function ArenaRuntime({ match }: { match: ReturnType<typeof useChessMatch> }) { return <div className="chess-panel-content">{(['w', 'b'] as ChessColor[]).map((color) => { const seat = match.seats[color]; return <div className="chess-engine-seat" key={color}><span>{color === 'w' ? '白方' : '黑方'} · {arenaEngineLabel(match.arenaEngines[color])}</span><strong>{seat?.profile?.version ?? '未加载'}</strong><small>{seat?.profile ? `${seat.profile.threads} threads · ${seat.profile.hashMb} MB · ${seat.profile.networkSha256 ?? '无网络指纹'}` : seat?.error ?? '开赛后建立独立会话'}</small></div> })}{match.error && <p className="chess-error">{match.error}</p>}</div> }
function latest(values: Partial<Record<ChessColor, ChessTurnAnalysis>>) { return Object.values(values).sort((a, b) => b.ply - a.ply)[0] }
function busyState(state: string) { return state === 'running' || state === 'thinking' }
function resultLabel(state: ChessGameState) { if (state.result?.reason === 'checkmate') return `${state.result.winner === 'w' ? '白' : '黑'}方将死`; if (state.result?.reason === 'threefold-repetition' || state.result?.reason === 'fifty-move') return '引擎申请和棋'; return '对局结束' }
function download(name: string, value: string, type: string) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([value], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href) }
