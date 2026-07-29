import { ChessBoard } from './components/ChessBoard'
import {
  ChevronLeftIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  VolumeIcon,
} from './components/Icons'
import { MoveHistory } from './components/MoveHistory'
import { PlayerCard } from './components/PlayerCard'
import { ResultModal } from './components/ResultModal'
import { StartScreen } from './components/StartScreen'
import { sideLabel } from './engine/ucci'
import { useAiMatch } from './hooks/useAiMatch'

function App() {
  const {
    state,
    engineState,
    soundEnabled,
    setSoundEnabled,
    start,
    pause,
    resume,
    newGame,
    returnHome,
    retryEngine,
  } = useAiMatch()

  if (state.phase === 'ready') {
    return <StartScreen onStart={start} engine={engineState} onRetry={() => void retryEngine()} />
  }

  const fullRound = Math.floor(state.history.length / 2) + 1
  const statusText =
    state.phase === 'paused'
      ? '对局暂停'
      : state.checkColor
        ? `${sideLabel(state.checkColor)}被将军`
        : `${sideLabel(state.turn)} · ${state.thinking ? '深度搜索中' : '准备行棋'}`

  return (
    <div className="match-page">
      <header className="match-header">
        <button className="back-button" onClick={returnHome} aria-label="返回首页">
          <ChevronLeftIcon />
        </button>
        <a className="brand brand--compact" href="#match" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark">弈</span>
          <span>
            <strong>AI 象棋</strong>
            <small>专业 NNUE 引擎对弈</small>
          </span>
        </a>
        <div className="match-status">
          <span className={state.phase === 'running' ? 'pulse-dot' : 'pause-dot'} />
          <div>
            <small>第 {fullRound} 回合</small>
            <strong>{statusText}</strong>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setSoundEnabled((value) => !value)}
            aria-label={soundEnabled ? '关闭音效' : '开启音效'}
            title={soundEnabled ? '关闭音效' : '开启音效'}
          >
            <VolumeIcon muted={!soundEnabled} />
          </button>
          <button className="icon-button" onClick={newGame} aria-label="开始新对局" title="新对局">
            <RefreshIcon />
          </button>
          <button
            className="control-button"
            onClick={state.phase === 'paused' ? resume : pause}
            disabled={state.phase === 'finished'}
          >
            {state.phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
            {state.phase === 'paused' ? '继续' : '暂停'}
          </button>
        </div>
      </header>

      <main className="arena" id="match">
        <aside className="arena-side arena-side--red">
          <PlayerCard
            color="red"
            remainingMs={state.clocks.red}
            turnElapsedMs={state.turn === 'red' ? state.clocks.turn : 0}
            active={state.turn === 'red' && state.phase === 'running'}
            thinking={state.turn === 'red' && state.thinking}
            info={state.turn === 'red' ? state.liveInfo : null}
          />
          <div className="side-quote engine-build">
            <span>核</span>
            <p>
              {engineState.profile?.version ?? 'Fairy-Stockfish'}
              <small>
                {engineState.profile
                  ? `${engineState.profile.threads} 线程 · ${engineState.profile.hashMb} MB Hash`
                  : '专业引擎'}
              </small>
            </p>
          </div>
        </aside>

        <section className="board-stage">
          <div className="board-title-row">
            <span>九路十行 · 楚河汉界</span>
            <span>
              {state.checkColor ? '将军' : state.thinking ? '真实搜索进行中' : '等待行棋'}
            </span>
          </div>
          <ChessBoard
            board={state.board}
            turn={state.turn}
            lastMove={state.lastMove}
            checkColor={state.checkColor}
            paused={state.phase === 'paused'}
          />
          <div className="board-footnote">
            <span>红方视角</span>
            <i />
            <span>NNUE 评估以当前行棋方为视角</span>
          </div>
        </section>

        <aside className="arena-side arena-side--black">
          <PlayerCard
            color="black"
            remainingMs={state.clocks.black}
            turnElapsedMs={state.turn === 'black' ? state.clocks.turn : 0}
            active={state.turn === 'black' && state.phase === 'running'}
            thinking={state.turn === 'black' && state.thinking}
            info={state.turn === 'black' ? state.liveInfo : null}
          />
          <MoveHistory history={state.history} />
        </aside>
      </main>

      <footer className="match-footer">
        <span>裁定：将死 · 困毙 · 超时 · 保守认输 · 简化和棋</span>
        <span>Fairy-Stockfish NNUE · UCCI · 所有计算均在本机完成</span>
      </footer>

      {state.result && (
        <ResultModal
          result={state.result}
          plies={state.history.length}
          onNewGame={newGame}
          onHome={returnHome}
        />
      )}
    </div>
  )
}

export default App
