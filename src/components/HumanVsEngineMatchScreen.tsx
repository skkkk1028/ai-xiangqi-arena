import { useEffect, useMemo, useState } from 'react'
import { difficultyProfile } from '../engine/difficulty'
import { normalizePositionEvaluation } from '../engine/evaluation'
import { sideLabel } from '../engine/ucci'
import type { Move, Position } from '../game/types'
import type { HumanEngineState, HumanMatchState } from '../hooks/useHumanVsEngine'
import { ChessBoard } from './ChessBoard'
import { ChevronLeftIcon, PauseIcon, PlayIcon, RefreshIcon } from './Icons'
import { MoveHistory } from './MoveHistory'
import { PositionEvaluation } from './PositionEvaluation'
import { ResultModal } from './ResultModal'

interface HumanVsEngineMatchScreenProps {
  state: HumanMatchState
  engineState: HumanEngineState
  legalMoves: readonly Move[]
  onMove: (from: Position, to: Position) => boolean
  onPause: () => void
  onResume: () => void
  onNewGame: () => void
  onHome: () => void
}

export function HumanVsEngineMatchScreen({
  state,
  engineState,
  legalMoves,
  onMove,
  onPause,
  onResume,
  onNewGame,
  onHome,
}: HumanVsEngineMatchScreenProps) {
  const [selected, setSelected] = useState<Position | null>(null)
  const humanTurn = state.turn === state.config.humanColor && state.phase === 'running'
  const legalTargets = useMemo(
    () => selected
      ? legalMoves.filter((move) => move.from.row === selected.row && move.from.col === selected.col)
        .map((move) => move.to)
      : [],
    [legalMoves, selected],
  )
  const difficulty = difficultyProfile(state.config.difficulty)
  const evaluation = normalizePositionEvaluation(
    state.liveInfo.score,
    state.liveInfo.wdl,
    state.config.aiColor,
  )

  useEffect(() => setSelected(null), [state.history.length, state.phase, state.turn])

  const clickSquare = (position: Position) => {
    if (!humanTurn || state.thinking) return
    const piece = state.board[position.row][position.col]
    if (selected && onMove(selected, position)) {
      setSelected(null)
      return
    }
    setSelected(piece?.color === state.config.humanColor ? position : null)
  }

  const status = state.phase === 'paused'
    ? '对局暂停'
    : state.result
      ? '对局结束'
      : state.thinking
        ? 'AI 正在计算…'
        : state.checkColor
          ? `${sideLabel(state.checkColor)}被将军`
          : humanTurn ? '等待你行棋' : 'AI 准备行棋'

  return (
    <div className="match-page human-match-page">
      <header className="match-header">
        <button className="back-button" onClick={onHome} aria-label="返回首页">
          <ChevronLeftIcon />
        </button>
        <div className="brand brand--compact">
          <span className="brand-mark">弈</span>
          <span><strong>真人 vs AI</strong><small>本地 NNUE 人机对弈</small></span>
        </div>
        <div className="match-status">
          <span className={state.phase === 'running' ? 'pulse-dot' : 'pause-dot'} />
          <div><small>第 {Math.floor(state.history.length / 2) + 1} 回合</small><strong>{status}</strong></div>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={onNewGame} aria-label="开始新对局" title="新对局">
            <RefreshIcon />
          </button>
          <button
            className="control-button"
            onClick={state.phase === 'paused' ? onResume : onPause}
            disabled={state.phase === 'finished'}
          >
            {state.phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
            {state.phase === 'paused' ? '继续' : '暂停'}
          </button>
        </div>
      </header>

      <main className="arena human-arena" id="human-match">
        <aside className="arena-side arena-side--red">
          <section className={`human-status-card ${humanTurn ? 'is-active' : ''}`}>
            <p className="eyebrow">HUMAN PLAYER</p>
            <h2>真人玩家 · {sideLabel(state.config.humanColor)}</h2>
            <strong className="unlimited-clock">不限时</strong>
            <p>{humanTurn ? '请选择棋子并点击合法落点' : '等待 AI 行棋'}</p>
            <span>红方先手 · 黑方后手</span>
          </section>
          <section className={`ai-status-card ${state.thinking ? 'is-thinking' : ''}`}>
            <p className="eyebrow">AI INFORMATION</p>
            <h2>{state.engineName}</h2>
            <dl>
              <div><dt>难度</dt><dd>等级 {difficulty.level} · {difficulty.name}</dd></div>
              <div><dt>状态</dt><dd>{engineState.phase === 'recovering' ? 'Worker 恢复中…' : state.thinking ? '正在计算…' : '等待'}</dd></div>
              <div><dt>深度</dt><dd>{state.liveInfo.depth || '—'}</dd></div>
              <div><dt>评价</dt><dd>{evaluation.label}</dd></div>
              <div><dt>本步</dt><dd>{formatSeconds(state.aiElapsedMs)} / {formatSeconds(state.aiBudgetMs)}</dd></div>
              <div><dt>资源</dt><dd>{engineState.profile ? `${engineState.profile.threads} 线程 · ${engineState.profile.hashMb} MB Hash` : '—'}</dd></div>
            </dl>
          </section>
        </aside>

        <section className="board-stage">
          <div className="board-title-row">
            <span>九路十行 · 楚河汉界</span>
            <span>{status}</span>
          </div>
          <div className="match-versus" aria-label="真人对 AI">
            <span>{state.config.humanColor === 'red' ? '真人玩家' : state.engineName}</span>
            <strong>VS</strong>
            <span>{state.config.humanColor === 'black' ? '真人玩家' : state.engineName}</span>
          </div>
          <PositionEvaluation info={state.liveInfo} perspective={state.config.aiColor} />
          <ChessBoard
            board={state.board}
            turn={state.turn}
            lastMove={state.lastMove}
            checkColor={state.checkColor}
            paused={state.phase === 'paused'}
            interactive={humanTurn && !state.thinking}
            selected={selected}
            legalTargets={legalTargets}
            onSquareClick={clickSquare}
          />
          <div className="board-footnote">
            <span>红方视角</span><i /><span>真人仅可在自己的回合操作合法着法</span>
          </div>
        </section>

        <aside className="arena-side arena-side--black">
          <MoveHistory history={state.history} />
          <div className="human-rule-note">
            <strong>本局规则</strong>
            <span>将死 · 困毙 · 三次重复 · 120 半回合无吃子</span>
            <small>AI 单步 {difficulty.minThinkMs / 1000}–{difficulty.maxThinkMs / 1000} 秒；真人不限时</small>
          </div>
        </aside>
      </main>

      <footer className="match-footer">
        <span>人机对战 · 合法着法本地校验 · UCCI/UCI Worker 搜索</span>
        <span>{state.engineName} · 等级 {difficulty.level} {difficulty.name}</span>
      </footer>

      {state.result && (
        <ResultModal
          result={state.result}
          plies={state.history.length}
          onNewGame={onNewGame}
          onHome={onHome}
        />
      )}
    </div>
  )
}

function formatSeconds(ms: number): string {
  if (!ms) return '0.0 秒'
  return `${(ms / 1000).toFixed(1)} 秒`
}
