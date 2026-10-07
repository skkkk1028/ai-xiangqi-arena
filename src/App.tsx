import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MoveRecord, Position } from './game/types'
import { formatMove } from './game/notation'
import { XiangqiReviewScreen } from './components/XiangqiReviewScreen'
import { ChessBoard } from './components/ChessBoard'
import { EngineSelectionScreen } from './components/EngineSelectionScreen'
import { HumanVsEngineConfigScreen } from './components/HumanVsEngineConfigScreen'
import { HumanVsEngineMatchScreen } from './components/HumanVsEngineMatchScreen'
import { GuessNextMove } from './components/GuessNextMove'
import { LocalXiangqiMatchScreen } from './components/LocalXiangqiMatchScreen'
import {
  ChevronLeftIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  VolumeIcon,
} from './components/Icons'
import { MoveHistory } from './components/MoveHistory'
import { PlayerCard } from './components/PlayerCard'
import { PositionEvaluation } from './components/PositionEvaluation'
import { ResultModal } from './components/ResultModal'
import { StartScreen } from './components/StartScreen'
import { moveToUcci, sideLabel } from './engine/ucci'
import { AI_PERSONALITIES } from './engine/personality'
import { useAiMatch } from './hooks/useAiMatch'
import { useHumanVsEngine } from './hooks/useHumanVsEngine'
import { useLocalXiangqiMatch } from './hooks/useLocalXiangqiMatch'
import { serializeMatchArchive } from './games/core'
import { createXiangqiArchive } from './games/xiangqi'
import { XiangqiGameEngine, type XiangqiGameState } from './games/xiangqi/game-engine'

import { NotebookPage } from './games/xiangqi/NotebookPage'
import { SearchComparison } from './components/SearchComparison'
import { OpeningPracticePage } from './games/xiangqi/OpeningPracticePage'
import { NotebookSave } from './games/xiangqi/NotebookSave'
import type { NotebookReference } from './games/xiangqi/notebook'

const guessGame = new XiangqiGameEngine()

function App() {
  const [review, setReview] = useState<{ history: readonly MoveRecord[]; engineId?: string; initialIndex?: number; entry?: 'practice'; reference?: NotebookReference } | null>(null)
  const [notebookOpen, setNotebookOpen] = useState(false)
  const [openingBookOpen, setOpeningBookOpen] = useState(false)
  const [openingPractice, setOpeningPractice] = useState(false)
  const [practiceError, setPracticeError] = useState<string | null>(null)
  const openingPracticeRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [guessSelected, setGuessSelected] = useState<Position | null>(null)
  const humanMatch = useHumanVsEngine()
  const localMatch = useLocalXiangqiMatch()
  const {
    state,
    view,
    engineState,
    engineStates,
    engineConfigs,
    soundEnabled,
    setSoundEnabled,
    start,
    openEngineSelection,
    closeEngineSelection,
    startEngineBattle,
    pause,
    suspendForPractice,
    resume,
    newGame,
    returnHome,
    releaseEngines,
    retryEngine,
    guess,
    toggleGuess,
    selectGuess,
    submitGuess,
    nextGuess,
  } = useAiMatch()
  const guessLegalMoves = useMemo(() => guess.phase === 'choosing' && guess.round ? [...guessGame.getLegalActions(guess.round.before)] : [], [guess.phase, guess.round])
  const guessLegalTargets = useMemo(() => guessSelected ? guessLegalMoves.filter((move) => move.from.row === guessSelected.row && move.from.col === guessSelected.col).map((move) => move.to) : [], [guessLegalMoves, guessSelected])
  useLayoutEffect(() => { setGuessSelected(null) }, [guess.phase, guess.round?.before])
  const onGuessSquareClick = (position: Position) => {
    if (guess.phase !== 'choosing' || !guess.round) return
    const piece = guess.round.before.board[position.row][position.col]
    if (guessSelected) {
      const move = guessLegalMoves.find((candidate) => candidate.from.row === guessSelected.row && candidate.from.col === guessSelected.col && candidate.to.row === position.row && candidate.to.col === position.col)
      if (move) { selectGuess(move); setGuessSelected(null); return }
    }
    setGuessSelected(piece?.color === guess.round.before.turn ? position : null)
  }

  const openPractice = async (before?: XiangqiGameState, reference?: NotebookReference) => {
    if (openingPracticeRef.current) return
    openingPracticeRef.current = true
    setOpeningPractice(true)
    setPracticeError(null)
    try {
      const stable = await suspendForPractice()
      if (!mountedRef.current) return
      const position = before ?? stable
      const history = position.history.map((move) => ({ ...move, score: null, wdl: null, depth: 0 }))
      setReview({ history, initialIndex: history.length, entry: 'practice', reference })
    } catch (error) {
      if (mountedRef.current) setPracticeError(error instanceof Error ? error.message : '暂时无法进入练习。')
    } finally {
      openingPracticeRef.current = false
      if (mountedRef.current) setOpeningPractice(false)
    }
  }

  const openHumanBattle = () => {
    releaseEngines()
    humanMatch.openConfiguration()
  }

  const closeHumanBattle = () => {
    humanMatch.close()
    void retryEngine().catch(() => undefined)
  }

  const openLocalBattle = () => {
    releaseEngines()
    void localMatch.open()
  }

  const closeLocalBattle = () => {
    localMatch.close()
    void retryEngine().catch(() => undefined)
  }

  if (review) return <XiangqiReviewScreen history={review.history} engineId={review.engineId} initialIndex={review.initialIndex} entry={review.entry} reference={review.reference} onClose={() => setReview(null)} />

  if (notebookOpen) return <NotebookPage onClose={() => { setNotebookOpen(false); void retryEngine().catch(() => undefined) }} />
  if (openingBookOpen) return <OpeningPracticePage onClose={() => { setOpeningBookOpen(false); void retryEngine().catch(() => undefined) }} />

  if (localMatch.view === 'match') {
    return <LocalXiangqiMatchScreen match={localMatch} onHome={closeLocalBattle} onReview={() => {
      localMatch.pause()
      setReview({ history: [...localMatch.state.history] })
    }} />
  }

  if (humanMatch.view === 'configuration') {
    return (
      <HumanVsEngineConfigScreen
        engines={humanMatch.engines}
        engineState={humanMatch.engineState}
        onBack={closeHumanBattle}
        onStart={humanMatch.start}
      />
    )
  }

  if (humanMatch.view === 'match' && humanMatch.state) {
    return (
      <HumanVsEngineMatchScreen
        state={humanMatch.state}
        engineState={humanMatch.engineState}
        legalMoves={humanMatch.legalMoves}
        onMove={humanMatch.playHumanMove}
        onPause={humanMatch.pause}
        onResume={humanMatch.resume}
        onNewGame={humanMatch.newGame}
        onHome={closeHumanBattle}
        negotiation={humanMatch.negotiation}
        resignEligibility={humanMatch.resignEligibility}
        drawEligibility={humanMatch.drawEligibility}
        undoEligibility={humanMatch.undoEligibility}
        onResign={humanMatch.resign}
        onOfferDraw={humanMatch.offerDraw}
        onRequestUndo={humanMatch.requestUndo}
        onReview={() => {
          humanMatch.pause()
          setReview({ history: [...humanMatch.state!.history], engineId: humanMatch.state!.config.engineId })
        }}
      />
    )
  }

  if (view === 'home') {
    return (
      <StartScreen
        onStart={start}
        onEngineBattle={openEngineSelection}
        onHumanBattle={openHumanBattle}
        onLocalBattle={openLocalBattle}
        onNotebook={() => { releaseEngines(); setNotebookOpen(true) }}
        onOpeningPractice={() => { releaseEngines(); setOpeningBookOpen(true) }}
        engine={engineState}
        onRetry={() => void retryEngine()}
        guessEnabled={guess.phase !== 'off'}
        onGuessChange={toggleGuess}
      />
    )
  }

  if (view === 'engine-selection') {
    return (
      <EngineSelectionScreen
        engines={engineConfigs}
        engineStates={engineStates}
        onBack={closeEngineSelection}
        onStart={startEngineBattle}
        guessEnabled={guess.phase !== 'off'}
        onGuessChange={toggleGuess}
      />
    )
  }

  const fullRound = Math.floor(state.history.length / 2) + 1
  const concealGuess = guess.phase === 'choosing' || guess.phase === 'searching'
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
          <button className="header-archive-button" disabled={state.history.length === 0} onClick={() => {
            toggleGuess(false)
            setReview({ history: [...state.history] })
          }}>复盘与再挑战</button>
          <button
            className="header-archive-button"
            type="button"
            disabled={state.history.length === 0}
            onClick={() => {
              const archive = createXiangqiArchive({
                history: state.history,
                players: [
                  { seat: 'red', kind: 'ai', name: state.players.red.name },
                  { seat: 'black', kind: 'ai', name: state.players.black.name },
                ],
                result: state.result,
              })
              downloadArchive('xiangqi-game.json', serializeMatchArchive(archive))
            }}
          >
            导出棋谱
          </button>
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
            info={!concealGuess && state.liveInfoSide === 'red' ? state.liveInfo : null}
            personality={state.mode === 'fairy-duel' ? AI_PERSONALITIES.red : undefined}
            engineName={state.players.red.name}
            protocol={state.players.red.protocol}
            skillLevel={state.players.red.skillLevel}
            styleDescription={state.players.red.styleDescription}
            openingName={state.opening.name}
            openingBranch={concealGuess ? '竞猜中' : state.opening.redName}
          />
          <div className="side-quote engine-build">
            <span>核</span>
            <p>
              {engineStates.red.profile?.version ?? state.players.red.name}
              <small>
                {engineStates.red.profile
                  ? `${engineStates.red.profile.threads} 线程 · ${engineStates.red.profile.hashMb} MB Hash`
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
          <div className="match-versus" aria-label="AI 对阵">
            <span>{state.players.red.name}</span>
            <strong>VS</strong>
            <span>{state.players.black.name}</span>
          </div>
          {!concealGuess && <PositionEvaluation info={state.liveInfo} perspective={state.liveInfoSide} />}
          <ChessBoard
            board={state.board}
            turn={state.turn}
            lastMove={state.lastMove}
            checkColor={state.checkColor}
            paused={state.phase === 'paused' && guess.phase !== 'choosing'}
            interactive={guess.phase === 'choosing'}
            selected={guessSelected}
            legalTargets={guessLegalTargets}
            onSquareClick={onGuessSquareClick}
          />
          <button className="header-archive-button" disabled={openingPractice} onClick={() => void openPractice()}>{openingPractice ? '正在暂停原对局…' : '从当前局面练习'}</button>
          {practiceError && <p role="alert">{practiceError}</p>}
          {!concealGuess && <SearchComparison board={state.board} turn={state.turn} paused={state.phase === 'paused' || state.phase === 'finished'} />}
          <NotebookSave getDraft={async () => { const position = await suspendForPractice(); return { moves: position.history.map((move) => move.ucci), source: { kind: 'live', label: state.mode === 'fairy-duel' ? 'AI 人格观战' : 'AI 引擎对战' } } }} />
          <label className="guess-toggle"><input type="checkbox" checked={guess.phase !== 'off'} onChange={(event) => toggleGuess(event.target.checked)} />猜下一手</label>
          <GuessNextMove guess={guess} finished={Boolean(state.result)} onSubmit={submitGuess} onNext={nextGuess} onPractice={() => void openPractice(guess.round?.before, { guessed: guess.round?.selected ? moveToUcci(guess.round.selected) : undefined, actual: guess.round?.actual?.ucci, source: guess.round?.source })} practiceDisabled={openingPractice} />
          <div className="board-footnote">
            <span>红方视角</span>
            <i />
            <span>评价已统一换算为红黑双方视角</span>
          </div>
        </section>

        <aside className="arena-side arena-side--black">
          <PlayerCard
            color="black"
            remainingMs={state.clocks.black}
            turnElapsedMs={state.turn === 'black' ? state.clocks.turn : 0}
            active={state.turn === 'black' && state.phase === 'running'}
            thinking={state.turn === 'black' && state.thinking}
            info={!concealGuess && state.liveInfoSide === 'black' ? state.liveInfo : null}
            personality={state.mode === 'fairy-duel' ? AI_PERSONALITIES.black : undefined}
            engineName={state.players.black.name}
            protocol={state.players.black.protocol}
            skillLevel={state.players.black.skillLevel}
            styleDescription={state.players.black.styleDescription}
            openingName={state.opening.name}
            openingBranch={concealGuess ? '竞猜中' : state.opening.blackName}
          />
          <MoveHistory history={state.history} />
        </aside>
      </main>

      <footer className="match-footer">
        <span>裁定：将死 · 困毙 · 超时 · 保守认输 · 简化和棋</span>
        <span>{state.players.red.name} VS {state.players.black.name} · 所有计算均在本机完成</span>
      </footer>

      {state.result && (
        <ResultModal
          result={state.result}
          plies={state.history.length}
          onNewGame={newGame}
          onHome={returnHome}
          interactionSummary={guess.round?.actual
            ? `你的猜招：${guess.round.selected ? formatMove(guess.round.selected) : '跳过'}；AI 实战着：${guess.round.actual.notation}（${guess.round.source === 'opening' ? '开局库' : '引擎选招'}）；${guess.round.selected && moveToUcci(guess.round.selected) === guess.round.actual.ucci ? '猜中' : guess.round.selected ? '未猜中' : '本题跳过'}；本局命中 ${guess.stats.hits} / ${guess.stats.answered}，最长连续命中 ${guess.stats.longest}。`
            : guess.phase === 'void' ? `竞猜本题作废；本局命中 ${guess.stats.hits} / ${guess.stats.answered}。` : undefined}
          onReview={state.history.length ? () => setReview({ history: [...state.history] }) : undefined}
        />
      )}
    </div>
  )
}

function downloadArchive(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default App
