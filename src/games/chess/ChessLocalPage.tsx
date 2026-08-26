import { useMemo, useState } from 'react'
import { BoardWorkbenchTabs, type WorkbenchPanel } from '../core'
import { GAME_ROUTES } from '../routes'
import { ChessBoard } from './ChessBoard'
import type { ChessColor, ChessGameState } from './types'
import { CHESS_LOCAL_TIME_CONTROLS, useLocalChessMatch, type ChessLocalTimeControlId } from './useLocalChessMatch'
import './chess.css'

type LocalPanel = 'match' | 'moves' | 'rules'

export function ChessLocalPage() {
  const match = useLocalChessMatch()
  const [panel, setPanel] = useState<LocalPanel>('match')
  const interactive = match.runState === 'running' && !match.state.result && !match.clockResult
  const status = localStatus(match)
  const panels = useMemo<readonly WorkbenchPanel<LocalPanel>[]>(() => [
    { id: 'match', label: '对局', eyebrow: 'MATCH', content: <LocalMatchControls match={match} /> },
    { id: 'moves', label: '棋谱', eyebrow: 'MOVES', content: <LocalMoves state={match.state} /> },
    { id: 'rules', label: '计时', eyebrow: 'CLOCK', content: <LocalRules /> },
  ], [match])

  return (
    <main className="chess-page chess-local-page">
      <div className="chess-page__ambient chess-page__ambient--one" aria-hidden="true" />
      <div className="chess-page__ambient chess-page__ambient--two" aria-hidden="true" />
      <header className="chess-header">
        <a className="chess-back" href={GAME_ROUTES.chess}>← <span>国际象棋模式</span></a>
        <div className="chess-brand"><span>♜</span><div><strong>PROJECT10 · LOCAL MATCH</strong><small>HUMAN VS HUMAN</small></div></div>
        <div className={`chess-runtime chess-runtime--${match.runState}`}><i /><span>{match.runState.toUpperCase()}</span><b>{match.timeControl.label}</b></div>
      </header>
      <section className="chess-arena" aria-labelledby="local-title">
        <div className="chess-stage">
          <div className="chess-heading"><div><p>同屏双人 · FIDE 棋盘规则 · 双重时限</p><h1 id="local-title">双人对战</h1></div><div className="chess-phase"><span>{status}</span><strong>{String(match.state.history.length).padStart(2, '0')} PLY</strong></div></div>
          <div className="local-clock-versus">
            <LocalClockCard color="w" active={interactive && match.state.turn === 'w'} totalMs={match.clock.totals.w} moveMs={match.state.turn === 'w' ? match.clock.moveRemainingMs : match.timeControl.moveMs} />
            <span>VS</span>
            <LocalClockCard color="b" active={interactive && match.state.turn === 'b'} totalMs={match.clock.totals.b} moveMs={match.state.turn === 'b' ? match.clock.moveRemainingMs : match.timeControl.moveMs} />
          </div>
          <ChessBoard state={match.state} interactive={interactive} humanColor={match.state.turn} disabled={!interactive} onMove={match.playMove} />
          <p className="human-board-hint">{interactive ? `轮到${match.state.turn === 'w' ? '白' : '黑'}方：点击棋子，再点击目标格。` : match.runState === 'paused' ? '棋局已暂停，继续后才能落子。' : match.runState === 'finished' ? '本局已经结束，请开始新局。' : '选择计时档位并点击“开始对局”。'}</p>
        </div>
        <aside className="chess-console" aria-label="双人对战工作台">
          <section className="chess-console__status" aria-live="polite"><span className="chess-console__eyebrow">LOCAL MATCH SESSION</span><strong>{status}</strong><small>{match.notice}</small></section>
          <BoardWorkbenchTabs active={panel} onChange={setPanel} panels={panels} label="双人对战工作台" />
        </aside>
      </section>
      <footer className="chess-footer"><span>LOCAL-HUMAN-MATCH-V1</span><i /><span>固定白方视角 · 暂停冻结时钟 · 超时直接判负</span></footer>
    </main>
  )
}

function LocalMatchControls({ match }: { match: ReturnType<typeof useLocalChessMatch> }) {
  const ready = match.runState === 'ready'
  const finished = match.runState === 'finished'
  return <div className="chess-panel-content">
    <div className="chess-budget"><span>TIME CONTROL</span>{(Object.keys(CHESS_LOCAL_TIME_CONTROLS) as ChessLocalTimeControlId[]).map((id) => <button key={id} className={match.timeControlId === id ? 'is-active' : ''} disabled={!ready} onClick={() => match.changeTimeControl(id)}>{CHESS_LOCAL_TIME_CONTROLS[id].label}</button>)}</div>
    <div className="local-time-summary"><div><span>每方总时</span><strong>{formatClock(match.timeControl.totalMs)}</strong></div><div><span>每步上限</span><strong>{formatClock(match.timeControl.moveMs)}</strong></div></div>
    <div className="chess-controls"><button className="chess-button chess-button--primary" disabled={finished} onClick={match.runState === 'running' ? match.pause : match.start}>{finished ? '对局已结束' : match.runState === 'running' ? '暂停' : match.runState === 'paused' ? '继续' : '开始对局'}</button><button className="chess-button" onClick={match.newGame}>新局</button></div>
  </div>
}

function LocalClockCard({ color, active, totalMs, moveMs }: { color: ChessColor; active: boolean; totalMs: number; moveMs: number }) {
  return <div className={`local-clock-card local-clock-card--${color}${active ? ' is-active' : ''}`}><span>{color === 'w' ? '♔ WHITE · 白方玩家' : 'BLACK · 黑方玩家 ♚'}</span><strong aria-label={`${color === 'w' ? '白' : '黑'}方总时间`}>{formatClock(totalMs)}</strong><small aria-label={`${color === 'w' ? '白' : '黑'}方单步时间`}>本步 {formatClock(moveMs)}</small></div>
}

function LocalMoves({ state }: { state: ChessGameState }) {
  return <div className="chess-panel-content"><div className="chess-history">{state.history.length === 0 ? <span>尚未开始对局。</span> : state.history.map((move, index) => <div key={`${index}-${move.uci}`}><small>{Math.floor(index / 2) + 1}{move.color === 'w' ? '.' : '…'}</small><strong>{move.san}</strong><code>{move.uci}</code></div>)}</div></div>
}

function LocalRules() {
  return <div className="chess-panel-content local-rules"><p>当前方的总时和单步时同时递减，任一归零即判当前方超时负。</p><p>暂停会冻结两个时钟；继续后从原剩余时间恢复。合法落子后，下一方获得完整单步时限。</p><p>浏览器切到后台后仍按真实经过时间结算，不会因标签页降频延长用时。</p></div>
}

function localStatus(match: ReturnType<typeof useLocalChessMatch>): string {
  if (match.clockResult) return `${match.clockResult.winner === 'w' ? '白' : '黑'}方胜 · ${match.clockResult.reason === 'total-timeout' ? '对手总时耗尽' : '对手单步超时'}`
  if (match.state.result?.reason === 'checkmate') return `${match.state.result.winner === 'w' ? '白' : '黑'}方将死获胜`
  if (match.state.result) return '和棋'
  if (match.runState === 'paused') return '对局已暂停'
  if (match.runState === 'running') return `${match.state.turn === 'w' ? '白' : '黑'}方行棋中`
  return '等待开始'
}

export function formatClock(ms: number): string {
  const safe = Math.max(0, ms)
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  if (safe < 10_000) return `${minutes}:${String(seconds).padStart(2, '0')}.${Math.floor((safe % 1_000) / 100)}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
