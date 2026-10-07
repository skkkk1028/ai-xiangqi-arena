import { useEffect, useMemo, useState } from 'react'
import { sideLabel } from '../engine/ucci'
import type { Position } from '../game/types'
import type { useLocalXiangqiMatch } from '../hooks/useLocalXiangqiMatch'
import { ChessBoard } from './ChessBoard'
import { SearchComparison } from './SearchComparison'
import { ChevronLeftIcon, PauseIcon, PlayIcon, RefreshIcon } from './Icons'
import { MatchNegotiationPanel, type NegotiationPending } from './MatchNegotiationPanel'
import { MoveHistory } from './MoveHistory'
import { PositionEvaluation } from './PositionEvaluation'
import { ResultModal } from './ResultModal'

type LocalMatch = ReturnType<typeof useLocalXiangqiMatch>

interface LocalXiangqiMatchScreenProps {
  match: LocalMatch
  onHome: () => void
  onReview?: () => void
}

export function LocalXiangqiMatchScreen({ match, onHome, onReview }: LocalXiangqiMatchScreenProps) {
  const { state } = match
  const [selected, setSelected] = useState<Position | null>(null)
  const legalTargets = useMemo(() => selected
    ? match.legalMoves.filter((move) => move.from.row === selected.row && move.from.col === selected.col).map((move) => move.to)
    : [], [match.legalMoves, selected])

  useEffect(() => setSelected(null), [state.game.turn, state.history.length, state.phase, state.pending])

  const clickSquare = (position: Position) => {
    if (state.phase !== 'running' || state.pending) return
    const piece = state.game.board[position.row][position.col]
    if (selected && match.playMove(selected, position)) {
      setSelected(null)
      return
    }
    setSelected(piece?.color === state.game.turn ? position : null)
  }

  const status = state.phase === 'ready'
    ? '双方就绪，等待开始'
    : state.phase === 'paused'
      ? '对局暂停'
      : state.game.result
        ? '对局结束'
        : state.game.checkColor
          ? `${sideLabel(state.game.checkColor)}被将军`
          : `${sideLabel(state.game.turn)}行棋`
  const pending: NegotiationPending | null = state.pending
    ? {
        kind: state.pending.kind,
        title: state.pending.kind === 'draw' ? '对方提出和棋' : '对方申请友谊悔棋',
        message: state.pending.kind === 'draw'
          ? `${sideLabel(state.pending.requester)}提出和棋。提议方棋钟仍在计时，请对手决定。`
          : `${sideLabel(state.pending.requester)}申请撤销最近一个完整回合。已消耗的总时间不会返还。`,
        awaitingOpponent: true,
      }
    : null

  return (
    <div className="local-xiangqi-match-page">
      <header className="local-match-header">
        <button type="button" className="local-icon-button" onClick={onHome} aria-label="返回象棋首页"><ChevronLeftIcon /></button>
        <div className="local-match-brand"><span>双</span><div><strong>同屏双人对战</strong><small>同设备轮流行棋 · 友谊赛</small></div></div>
        <div className="local-match-status"><small>第 {Math.floor(state.history.length / 2) + 1} 回合</small><strong>{status}</strong></div>
        <div className="local-header-actions">
          {onReview && <button type="button" disabled={!state.history.length || Boolean(state.pending)} onClick={onReview}>复盘与再挑战</button>}
          <button type="button" onClick={match.newGame} disabled={Boolean(state.pending)}><RefreshIcon />新局</button>
          {state.phase === 'ready' ? (
            <button type="button" className="local-primary-button" onClick={match.startMatch}><PlayIcon />开始对局</button>
          ) : (
            <button
              type="button"
              onClick={state.phase === 'paused' ? match.resume : match.pause}
              disabled={state.phase === 'finished' || Boolean(state.pending)}
            >{state.phase === 'paused' ? <PlayIcon /> : <PauseIcon />}{state.phase === 'paused' ? '继续' : '暂停'}</button>
          )}
        </div>
      </header>

      <main className="local-match-layout">
        <section className="local-board-workspace">
          <div className="local-clocks" aria-label="双方棋钟">
            <LocalClock color="red" active={state.phase === 'running' && state.game.turn === 'red'} remaining={state.clocks.red} turn={state.game.turn === 'red' ? state.clocks.turn : 0} />
            <LocalClock color="black" active={state.phase === 'running' && state.game.turn === 'black'} remaining={state.clocks.black} turn={state.game.turn === 'black' ? state.clocks.turn : 0} />
          </div>
          <div className="local-evaluation-block">
            <PositionEvaluation info={state.evaluation} perspective={state.evaluationPerspective} />
            <div className={`local-evaluation-state is-${state.evaluationState.phase}`}>
              {state.evaluationState.phase === 'loading' && '正在载入 Fairy-Stockfish NNUE 评分引擎…'}
              {state.evaluationState.phase === 'searching' && '正在后台评估当前局面；不影响继续行棋。'}
              {state.evaluationState.phase === 'ready' && '局面评分已更新 · 不显示建议着法'}
              {state.evaluationState.phase === 'idle' && '等待评分引擎'}
              {state.evaluationState.phase === 'error' && <><span>评分暂不可用：{state.evaluationState.error}</span><button type="button" onClick={() => void match.retryEvaluator()}>重试评分</button></>}
            </div>
          </div>
          <ChessBoard
            board={state.game.board}
            turn={state.game.turn}
            lastMove={state.game.lastMove}
            checkColor={state.game.checkColor}
            paused={state.phase === 'paused'}
            interactive={state.phase === 'running' && !state.pending}
            selected={selected}
            legalTargets={legalTargets}
            onSquareClick={clickSquare}
          />
          <div className="local-board-caption"><span>当前仅可操作 {sideLabel(state.game.turn)}棋子</span><i /><span>总时 20 分钟 · 单步 60 秒</span></div>
        </section>

        <aside className="local-match-workbench">
          <section className="local-turn-card">
            <p className="eyebrow">CURRENT TURN</p>
            <h2>{status}</h2>
            <p>红方先行；合法着法、将军、将死、困毙及项目简化和棋均由现有规则引擎裁定。</p>
            <div><span>红方提和 {state.drawOffers.red} 次</span><span>黑方提和 {state.drawOffers.black} 次</span></div>
          </section>
          <MoveHistory history={state.history} />
          <SearchComparison board={state.game.board} turn={state.game.turn} paused={state.phase === 'paused' || state.phase === 'finished'} />
          <section className="local-rule-note">
            <strong>对局规则</strong>
            <span>认输立即判负；第 26 回合起可提和；每方前 25 回合内最多获得一次双方同意的完整回合悔棋。</span>
            <small>正式竞赛落子生根后不得悔棋；本站悔棋明确属于同屏友谊赛扩展，已消耗总时间不返还。</small>
          </section>
          <MatchNegotiationPanel
            resign={match.resignEligibility}
            draw={match.drawEligibility}
            undo={match.undoEligibility}
            pending={pending}
            notice={state.notice}
            onResign={match.resign}
            onOfferDraw={match.offerDraw}
            onRequestUndo={match.requestUndo}
            onAccept={match.acceptNegotiation}
            onReject={match.rejectNegotiation}
          />
        </aside>
      </main>

      {state.game.result && <ResultModal result={state.game.result} plies={state.history.length} onNewGame={match.newGame} onHome={onHome} onReview={state.history.length ? onReview : undefined} />}
    </div>
  )
}

function LocalClock({ color, active, remaining, turn }: { color: 'red' | 'black'; active: boolean; remaining: number; turn: number }) {
  return (
    <section className={`local-clock local-clock--${color} ${active ? 'is-active' : ''}`} aria-label={`${color === 'red' ? '红方' : '黑方'}棋钟`}>
      <div><small>{color === 'red' ? 'RED PLAYER' : 'BLACK PLAYER'}</small><strong>{color === 'red' ? '红方玩家' : '黑方玩家'}</strong></div>
      <time aria-label={`${color === 'red' ? '红方' : '黑方'}剩余时间`}>{formatClock(remaining)}</time>
      <span>本步 {formatClock(turn)} / 01:00</span>
    </section>
  )
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
