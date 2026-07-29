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
import { useAiMatch } from './hooks/useAiMatch'

function App() {
  const {
    state,
    soundEnabled,
    setSoundEnabled,
    start,
    pause,
    resume,
    newGame,
    returnHome,
  } = useAiMatch()

  if (state.phase === 'ready') return <StartScreen onStart={start} />

  const fullRound = Math.floor(state.history.length / 2) + 1
  const statusText =
    state.phase === 'paused'
      ? '对局暂停'
      : state.checkColor
        ? `${state.checkColor === 'red' ? '红方' : '黑方'}被将军`
        : `${state.turn === 'red' ? '红方 · 赤焰' : '黑方 · 玄甲'}思考中`

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
            <small>楚河汉界 · 智见胜负</small>
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
            thinking={state.thinking}
            depth={state.turn === 'black' ? state.searchDepth : 0}
            nodes={state.turn === 'black' ? state.searchNodes : 0}
          />
          <div className="side-quote">
            <span>先</span>
            <p>攻如烈火，落子无悔</p>
          </div>
        </aside>

        <section className="board-stage">
          <div className="board-title-row">
            <span>九路十行 · 楚河汉界</span>
            <span>
              {state.checkColor ? '将军' : state.thinking ? '正在推演最佳着法' : '等待行棋'}
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
            <span>AI 评估仅用于行棋，不代表最终胜负</span>
          </div>
        </section>

        <aside className="arena-side arena-side--black">
          <PlayerCard
            color="black"
            remainingMs={state.clocks.black}
            turnElapsedMs={state.turn === 'black' ? state.clocks.turn : 0}
            active={state.turn === 'black' && state.phase === 'running'}
            thinking={state.thinking}
            depth={state.turn === 'red' ? state.searchDepth : 0}
            nodes={state.turn === 'red' ? state.searchNodes : 0}
          />
          <MoveHistory history={state.history} />
        </aside>
      </main>

      <footer className="match-footer">
        <span>规则：将死 · 困毙 · 超时 · 自动认输 · 简化和棋</span>
        <span>所有搜索均在本机浏览器内完成</span>
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
