import { GAME_ROUTES } from '../routes'
import { kataGoRuntimeBackendLabel, type KataGoAnalysis, type KataGoSearchProfile } from './ai'
import { GoBoard } from './GoBoard'
import { GO_PASS_MOVE, type GoGameState, type GoPlayer, type GoScore } from './types'
import { useGoMatch, type GoAIRunState, type GoMatchMode } from './useGoMatch'

export function GoGamePage() {
  const match = useGoMatch()
  const {
    state,
    mode,
    profile,
    runState,
    notice,
    capabilities,
    analysisByPlayer,
    legalMoveKeys,
  } = match
  const turnName = playerName(state.turn)
  const status = getStatusCopy(state, mode, runState)
  const recentHistory = state.history.slice(-6).reverse()
  const activeAnalysis = analysisByPlayer[state.turn] ?? analysisByPlayer.black ?? analysisByPlayer.white ?? null
  const aiBusy = runState === 'running' || runState === 'thinking'

  return (
    <main className="go-page go-match-page">
      <div className="go-page__mist go-page__mist--one" aria-hidden="true" />
      <div className="go-page__mist go-page__mist--two" aria-hidden="true" />

      <header className="go-page__header go-match-header">
        <a className="go-page__back" href={GAME_ROUTES.lobby}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H6m5-6-6 6 6 6" />
          </svg>
          返回棋类大厅
        </a>
        <div className="go-academy-brand">
          <span>弈</span>
          <div>
            <strong>云岫棋院</strong>
            <small>GO ACADEMY · AI LAB</small>
          </div>
        </div>
        <div className={`go-runtime-badge go-runtime-badge--${mode === 'ai' ? runState : 'local'}`}>
          <i />
          <span>{mode === 'ai' ? runtimeLabel(runState) : 'LOCAL RULES ONLINE'}</span>
          <b>{mode === 'ai' ? kataGoRuntimeBackendLabel(capabilities?.runtimeBackend) : '中国规则 · 7.5 贴目'}</b>
        </div>
      </header>

      <section className="go-arena" aria-labelledby="go-page-title">
        <div className="go-board-stage">
          <div className="go-board-heading">
            <div>
              <p>十九路研习对局 · {mode === 'ai' ? 'KATAGO SELF-PLAY' : 'LOCAL SESSION'}</p>
              <h1 id="go-page-title">{mode === 'ai' ? '双机弈境' : '静室手谈'}</h1>
            </div>
            <div className={`go-phase go-phase--${state.phase}`}>
              <i />
              <span>{status.eyebrow}</span>
              <strong>{status.title}</strong>
            </div>
          </div>

          <div className="go-board-frame">
            <span className="go-board-frame__corner go-board-frame__corner--tl" aria-hidden="true" />
            <span className="go-board-frame__corner go-board-frame__corner--br" aria-hidden="true" />
            <GoBoard
              board={state.board}
              turn={state.turn}
              lastMove={state.lastMove}
              legalMoveKeys={legalMoveKeys}
              deadStoneKeys={match.deadStoneKeys}
              interactive={mode === 'local' && state.phase === 'playing'}
              scoring={state.phase === 'scoring'}
              onPlay={match.execute}
              onToggleDead={match.toggleDeadGroup}
            />
          </div>

          <div className="go-board-caption">
            <span>十九路标准棋盘</span>
            <i />
            <span>位置超级劫 · 禁止自杀</span>
            <i />
            <span>{mode === 'ai' ? `${kataGoRuntimeBackendLabel(capabilities?.runtimeBackend)} · ${capabilities?.runtimeBackend === 'native-katago' ? '本机 GPU 计算' : '访客设备计算'}` : '本地规则运算'}</span>
          </div>
        </div>

        <aside className="go-console" aria-label="围棋对局信息">
          <ModePanel
            mode={mode}
            profile={profile}
            busy={aiBusy || runState === 'connecting'}
            onMode={(next) => void match.changeMode(next)}
            onProfile={(next) => void match.changeProfile(next)}
          />

          <section className="go-turn-card">
            <div className={`go-turn-card__stone go-turn-card__stone--${state.turn}`} aria-hidden="true" />
            <div>
              <span>CURRENT TURN</span>
              <strong>{state.phase === 'playing' ? `${turnName}方行棋` : status.title}</strong>
              <small>{status.detail}</small>
            </div>
            <b>{state.history.length} 手</b>
          </section>

          <section className="go-players" aria-label="棋手信息">
            <PlayerStrip
              color="black"
              name={mode === 'ai' ? 'KataGo · 黑' : '本地棋手 A'}
              active={state.phase === 'playing' && state.turn === 'black'}
              prisoners={state.prisoners.black}
              analysis={analysisByPlayer.black}
            />
            <div className="go-players__versus"><span />VS<span /></div>
            <PlayerStrip
              color="white"
              name={mode === 'ai' ? 'KataGo · 白' : '本地棋手 B'}
              active={state.phase === 'playing' && state.turn === 'white'}
              prisoners={state.prisoners.white}
              analysis={analysisByPlayer.white}
            />
          </section>

          <section className="go-match-data" aria-label="棋局数据">
            <div><span>手数</span><strong>{state.history.length}</strong><small>MOVES</small></div>
            <div><span>回合</span><strong>{Math.ceil(state.history.length / 2)}</strong><small>ROUNDS</small></div>
            <div><span>连续虚着</span><strong>{state.consecutivePasses}</strong><small>PASSES</small></div>
          </section>

          {state.phase === 'scoring' && match.scorePreview && (
            <ScoringPreview
              score={match.scorePreview}
              confirmations={match.scoringConfirmations}
            />
          )}

          {state.phase === 'finished' && state.result && (
            <section className="go-result-card" aria-live="polite">
              <span>FINAL SCORE · 中国面积计分</span>
              <strong>{playerName(state.result.winner)}方胜 · {state.result.score.margin} 目</strong>
              <small>黑 {state.result.score.black.total} · 白 {state.result.score.white.total}</small>
            </section>
          )}

          <MatchControls match={match} aiBusy={aiBusy} />

          {notice && <p className="go-notice" role="status">{notice}</p>}

          <section className="go-history-panel" aria-label="最近棋谱">
            <header><span>最近棋谱</span><small>MOVE LOG</small></header>
            {recentHistory.length > 0 ? (
              <ol>
                {recentHistory.map((record) => (
                  <li key={record.moveNumber}>
                    <b>{String(record.moveNumber).padStart(3, '0')}</b>
                    <i className={`go-history-panel__stone go-history-panel__stone--${record.color}`} />
                    <span>{record.notation}</span>
                    <small>{record.captures.length ? `提 ${record.captures.length}` : '—'}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>等待第一手落子</p>
            )}
          </section>

          <KataGoPanel
            mode={mode}
            runState={runState}
            profile={profile}
            capabilities={capabilities}
            analysis={activeAnalysis}
          />
        </aside>
      </section>

      <footer className="go-match-footer">
        <span>中国规则 · 面积计分 · 贴目 7.5 · 位置超级劫</span>
        <span>{mode === 'ai' ? `GO LAB / KATAGO ${profile.toUpperCase()}` : 'GO LAB / LOCAL SESSION · AI STANDBY'}</span>
      </footer>
    </main>
  )
}

function ModePanel({
  mode,
  profile,
  busy,
  onMode,
  onProfile,
}: {
  mode: GoMatchMode
  profile: KataGoSearchProfile
  busy: boolean
  onMode: (mode: GoMatchMode) => void
  onProfile: (profile: KataGoSearchProfile) => void
}) {
  return (
    <section className="go-mode-panel" aria-label="围棋对局模式">
      <header><span>MATCH MODE</span><small>{mode === 'ai' ? 'KATAGO LAB' : 'LOCAL ROOM'}</small></header>
      <div className="go-segmented">
        <button type="button" aria-pressed={mode === 'local'} onClick={() => onMode('local')}>本地双人</button>
        <button type="button" aria-pressed={mode === 'ai'} onClick={() => onMode('ai')}>AI 自对弈</button>
      </div>
      <div className="go-profile-selector" aria-label="KataGo 搜索档位">
        <span>SEARCH</span>
        <button type="button" disabled={mode !== 'ai' || busy} aria-pressed={profile === 'fast'} onClick={() => onProfile('fast')}>快 · 2000</button>
        <button type="button" disabled={mode !== 'ai' || busy} aria-pressed={profile === 'strong'} onClick={() => onProfile('strong')}>强 · 20000</button>
      </div>
    </section>
  )
}

function MatchControls({ match, aiBusy }: { match: ReturnType<typeof useGoMatch>; aiBusy: boolean }) {
  const { state, mode, runState } = match
  if (state.phase === 'scoring') {
    return (
      <section className="go-controls" aria-label="棋局操作">
        <button
          type="button"
          className="go-control go-control--primary"
          disabled={match.scoringConfirmations.black}
          onClick={() => match.confirmScoring('black')}
        >
          {match.scoringConfirmations.black ? '黑方已确认' : '黑方确认'}<small>BLACK CONFIRM</small>
        </button>
        <button
          type="button"
          className="go-control go-control--primary"
          disabled={!match.scoringConfirmations.black || match.scoringConfirmations.white}
          onClick={() => match.confirmScoring('white')}
        >
          {match.scoringConfirmations.white ? '白方已确认' : '白方确认'}<small>WHITE CONFIRM</small>
        </button>
        <button type="button" className="go-control" onClick={() => void match.resumePlay()}>
          继续对局<small>RESUME</small>
        </button>
      </section>
    )
  }

  if (mode === 'ai') {
    const canStart = state.phase === 'playing' && !aiBusy && runState !== 'connecting'
    return (
      <section className="go-controls go-controls--ai" aria-label="AI 对弈操作">
        <button type="button" className="go-control go-control--primary" disabled={!canStart} onClick={() => void match.startAI()}>
          {runState === 'paused' || runState === 'error' ? '继续对弈' : '开始对弈'}<small>RUN</small>
        </button>
        <button type="button" className="go-control" disabled={!aiBusy} onClick={() => void match.pauseAI()}>
          暂停<small>PAUSE</small>
        </button>
        <button type="button" className="go-control" disabled={!canStart} onClick={() => void match.stepAI()}>
          单步<small>STEP</small>
        </button>
        <button type="button" className="go-control" onClick={() => void match.newGame()}>
          重新开局<small>NEW GAME</small>
        </button>
      </section>
    )
  }

  return (
    <section className="go-controls" aria-label="棋局操作">
      <button
        type="button"
        className="go-control go-control--primary"
        aria-label="虚着"
        disabled={state.phase !== 'playing'}
        onClick={() => match.execute(GO_PASS_MOVE)}
      >
        虚着<small>PASS</small>
      </button>
      <button type="button" className="go-control" onClick={() => void match.newGame()}>
        重新开局<small>NEW GAME</small>
      </button>
    </section>
  )
}

function KataGoPanel({
  mode,
  runState,
  profile,
  capabilities,
  analysis,
}: {
  mode: GoMatchMode
  runState: GoAIRunState
  profile: KataGoSearchProfile
  capabilities: ReturnType<typeof useGoMatch>['capabilities']
  analysis: KataGoAnalysis | null
}) {
  const online = mode === 'ai' && capabilities?.ready
  return (
    <section className={`go-ai-slot${online ? ' go-ai-slot--online' : ''}`} aria-label="KataGo AI 信息面板">
      <header>
        <span><i />AI ENGINE · KATAGO</span>
        <b>{mode === 'ai' ? runtimeLabel(runState) : 'STANDBY'}</b>
      </header>
      <div className="go-ai-slot__core" aria-hidden="true"><span>KG</span><i /><i /><i /></div>
      <div className="go-ai-slot__summary">
        <strong>{online ? (runState === 'thinking' ? 'KataGo 正在计算' : 'KataGo 引擎已就绪') : 'KataGo 引擎待命'}</strong>
        <p>{analysis ? `主变化：${analysis.pvNotation.join(' ') || '—'}` : engineDescription(capabilities)}</p>
      </div>
      <dl>
        <div className="go-ai-slot__wide"><dt>BACKEND</dt><dd>{kataGoRuntimeBackendLabel(analysis?.runtimeBackend ?? capabilities?.runtimeBackend)}</dd></div>
        <div><dt>REQUESTED</dt><dd>{kataGoRuntimeBackendLabel(analysis?.requestedBackend ?? capabilities?.requestedBackend)}</dd></div>
        <div className="go-ai-slot__wide"><dt>MODEL</dt><dd>{analysis?.modelName ?? capabilities?.modelName ?? '—'}</dd></div>
        <div><dt>ENGINE</dt><dd>{analysis?.engineVersion ?? capabilities?.engineVersion ?? '—'}</dd></div>
        <div><dt>BACKEND FALLBACK</dt><dd title={analysis?.backendFallbackReason ?? capabilities?.backendFallbackReason ?? undefined}>{yesNo(analysis?.backendFallback ?? capabilities?.backendFallback)}</dd></div>
        <div><dt>MODEL FALLBACK</dt><dd title={analysis?.modelFallbackReason ?? capabilities?.modelFallbackReason ?? undefined}>{yesNo(analysis?.modelFallback ?? capabilities?.modelFallback)}</dd></div>
        <div><dt>BLACK WR</dt><dd>{analysis ? percent(analysis.blackWinRate) : '—'}</dd></div>
        <div><dt>DELTA</dt><dd>{analysis ? delta(analysis.winRateChange) : '—'}</dd></div>
        <div><dt>PROFILE</dt><dd>{profile === 'fast' ? 'FAST · 2000' : 'STRONG · 20000'}</dd></div>
        <div><dt>VISITS</dt><dd>{analysis ? `${analysis.visits} / ${analysis.requestedVisits}` : `— / ${capabilities?.profiles[profile].maxVisits ?? '—'}`}</dd></div>
        <div><dt>ELAPSED</dt><dd>{analysis ? `${(analysis.elapsedMs / 1000).toFixed(1)}s` : '—'}</dd></div>
        <div><dt>TIMEOUT CUT</dt><dd>{analysis ? (analysis.timedOut ? 'YES · TRUNCATED' : 'NO') : '—'}</dd></div>
        <div><dt>STOP</dt><dd>{analysis ? analysis.stopReason.toUpperCase() : '—'}</dd></div>
        <div><dt>SCORE</dt><dd>{scoreLead(analysis?.scoreLeadBlack)}</dd></div>
      </dl>
      {analysis && (
        <ol className="go-ai-candidates" aria-label="KataGo 候选着">
          {analysis.candidates.slice(0, 3).map((candidate) => (
            <li key={`${candidate.order}-${candidate.notation}`}>
              <b>{candidate.order + 1}</b>
              <span>{candidate.notation}</span>
              <small>{percent(candidate.blackWinRate)} · {candidate.visits}v</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function PlayerStrip({
  color,
  name,
  active,
  prisoners,
  analysis,
}: {
  color: GoPlayer
  name: string
  active: boolean
  prisoners: number
  analysis?: KataGoAnalysis
}) {
  const winRate = analysis ? (color === 'black' ? analysis.blackWinRate : analysis.whiteWinRate) : null
  return (
    <div className={`go-player-strip${active ? ' go-player-strip--active' : ''}`}>
      <i className={`go-player-strip__stone go-player-strip__stone--${color}`} aria-hidden="true" />
      <div>
        <span>{color === 'black' ? 'BLACK · 先手' : 'WHITE · 后手'}</span>
        <strong>{name}</strong>
      </div>
      <small>{winRate === null ? `提子 ${prisoners}` : `胜率 ${percent(winRate)}`}</small>
    </div>
  )
}

function playerName(player: GoPlayer | null): string {
  if (player === 'black') return '黑'
  if (player === 'white') return '白'
  return '和棋'
}

function getStatusCopy(
  state: GoGameState,
  mode: GoMatchMode,
  runState: GoAIRunState,
): { eyebrow: string; title: string; detail: string } {
  if (state.phase === 'scoring') {
    return { eyebrow: 'SCORING REVIEW', title: '计分确认', detail: '确认结果或恢复落子' }
  }
  if (state.phase === 'finished') {
    return { eyebrow: 'SESSION COMPLETE', title: '对局结束', detail: '本局已经完成结算' }
  }
  if (mode === 'ai') {
    return {
      eyebrow: runState === 'thinking' ? 'ENGINE THINKING' : state.turn === 'black' ? 'BLACK AI' : 'WHITE AI',
      title: `${playerName(state.turn)}方行棋`,
      detail: aiStatusDetail(runState),
    }
  }
  return {
    eyebrow: state.turn === 'black' ? 'BLACK TO PLAY' : 'WHITE TO PLAY',
    title: `${playerName(state.turn)}方行棋`,
    detail: '请在棋盘交叉点落子',
  }
}

function runtimeLabel(state: GoAIRunState): string {
  const labels: Record<GoAIRunState, string> = {
    offline: 'OFFLINE',
    connecting: 'CONNECTING',
    ready: 'READY',
    running: 'RUNNING',
    thinking: 'THINKING',
    paused: 'PAUSED',
    error: 'SERVICE ERROR',
  }
  return labels[state]
}

function aiStatusDetail(state: GoAIRunState): string {
  if (state === 'thinking') return 'KataGo 正在计算候选着'
  if (state === 'connecting') return '正在加载本地 AI 模型'
  if (state === 'paused') return 'AI 对弈已暂停'
  if (state === 'error') return 'AI 初始化异常，棋盘状态已保留'
  if (state === 'running') return '自动对弈运行中'
  return '等待开始 AI 自对弈'
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function delta(value: number | null): string {
  if (value === null) return '—'
  const points = value * 100
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)}pp`
}

function scoreLead(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `黑 ${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function yesNo(value: boolean | undefined): string {
  if (value === undefined) return '—'
  return value ? 'YES' : 'NO'
}

function engineDescription(capabilities: ReturnType<typeof useGoMatch>['capabilities']): string {
  if (!capabilities) return '切换至 AI 自对弈后加载实际模型与推理后端。'
  if (capabilities.runtimeBackend === 'native-katago') {
    return '官方 Native KataGo · B28 专业级路线，由本机 OpenCL GPU 计算。'
  }
  return `B18 专业模型 · ${kataGoRuntimeBackendLabel(capabilities.runtimeBackend)}，实际棋力取决于访客设备与完成 visits。`
}

function ScoringPreview({
  score,
  confirmations,
}: {
  score: GoScore
  confirmations: Record<GoPlayer, boolean>
}) {
  return (
    <section className="go-scoring-preview" aria-label="计分预览" aria-live="polite">
      <header><span>计分预览</span><small>SCORING PREVIEW</small></header>
      <div className="go-scoring-preview__totals">
        <div><b>黑方</b><strong>{score.black.total}</strong><small>棋子 {score.black.livingStones} · 围空 {score.black.territory}</small></div>
        <div><b>白方</b><strong>{score.white.total}</strong><small>棋子 {score.white.livingStones} · 围空 {score.white.territory} · 贴目 {score.komi}</small></div>
      </div>
      <p>暂定：{score.winner ? `${playerName(score.winner)}方领先 ${score.margin} 目` : '和棋'} · 已标记死子 {score.confirmedDeadStones.length} 枚</p>
      <footer>
        <span className={confirmations.black ? 'is-confirmed' : ''}>黑方 {confirmations.black ? '已确认' : '待确认'}</span>
        <span className={confirmations.white ? 'is-confirmed' : ''}>白方 {confirmations.white ? '已确认' : '待确认'}</span>
      </footer>
    </section>
  )
}
