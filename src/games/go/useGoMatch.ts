import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameController, type AIEngine } from '../core'
import {
  GO_AI_ENGINES,
  HttpLeelaZeroTransport,
  HttpSayuriTransport,
  KataGoEngine,
  KataGoMatchAnalysisStore,
  LeelaZeroEngine,
  SayuriEngine,
  goAIEngineName,
  kataGoRuntimeBackendLabel,
  type GoAIAnalysis,
  type GoAIAnalysisListener,
  type GoAIEngineId,
  type GoAIEngineRuntimeDetails,
  type KataGoAnalysis,
  type KataGoCapabilities,
  type KataGoSearchProfile,
  type KataGoTransport,
} from './ai'
import { pointKey } from './board'
import { GoGameEngine } from './game-engine'
import { getGoGroup } from './rules'
import type { GoGameState, GoMove, GoMoveRecord, GoPlayer, GoPoint } from './types'

export type GoMatchMode = 'local' | 'ai' | 'battle'
export type GoAIRunState = 'offline' | 'connecting' | 'ready' | 'running' | 'thinking' | 'paused' | 'error'

type GoController = GameController<GoGameState, GoMove, GoPlayer, GoMoveRecord, GoAIAnalysis>
type GoSeatEngine = AIEngine<GoGameState, GoMove, GoPlayer, GoMoveRecord, GoAIAnalysis> & {
  subscribe(listener: GoAIAnalysisListener): () => void
}

interface AISession {
  controller: GoController
  transports: readonly { dispose(): void | Promise<void> }[]
  unsubscribe: readonly (() => void)[]
  capabilities: KataGoCapabilities | null
  engineDetails: Partial<Record<GoAIEngineId, GoAIEngineRuntimeDetails>>
}

const GO_ENGINE = new GoGameEngine()
const USE_NATIVE_KATAGO = import.meta.env.VITE_KATAGO_BRIDGE === '1'

export function useGoMatch() {
  const [state, setStateValue] = useState<GoGameState>(() => GO_ENGINE.init())
  const [mode, setModeValue] = useState<GoMatchMode>('local')
  const [profile, setProfileValue] = useState<KataGoSearchProfile>('strong')
  const [battleEngines, setBattleEnginesValue] = useState<Record<GoPlayer, GoAIEngineId>>({
    black: 'katago',
    white: 'leela-zero',
  })
  const [runState, setRunStateValue] = useState<GoAIRunState>('offline')
  const [notice, setNotice] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<KataGoCapabilities | null>(null)
  const [engineDetails, setEngineDetails] = useState<Partial<Record<GoAIEngineId, GoAIEngineRuntimeDetails>>>({})
  const [analysisByPlayer, setAnalysisByPlayer] = useState<Partial<Record<GoPlayer, GoAIAnalysis>>>({})
  const [deadStoneRepresentatives, setDeadStoneRepresentatives] = useState<GoPoint[]>([])
  const [scoringConfirmations, setScoringConfirmations] = useState<Record<GoPlayer, boolean>>({
    black: false,
    white: false,
  })

  const stateRef = useRef(state)
  const modeRef = useRef(mode)
  const profileRef = useRef(profile)
  const battleEnginesRef = useRef(battleEngines)
  const runStateRef = useRef(runState)
  const sessionRef = useRef<AISession | null>(null)
  const loopTokenRef = useRef(0)
  const autoRunningRef = useRef(false)
  const mountedRef = useRef(true)

  const setState = useCallback((next: GoGameState) => {
    stateRef.current = next
    if (mountedRef.current) setStateValue(next)
  }, [])

  const setRunState = useCallback((next: GoAIRunState) => {
    runStateRef.current = next
    if (mountedRef.current) setRunStateValue(next)
  }, [])

  const legalMoveKeys = useMemo(
    () => new Set(GO_ENGINE.getLegalMoves(state).map(pointKey)),
    [state],
  )
  const scoringRequest = useMemo(
    () => ({ deadStoneRepresentatives }),
    [deadStoneRepresentatives],
  )
  const scorePreview = useMemo(
    () => state.phase === 'scoring' ? GO_ENGINE.previewScore(state, scoringRequest) : null,
    [scoringRequest, state],
  )
  const deadStoneKeys = useMemo(
    () => new Set(scorePreview?.confirmedDeadStones.map(pointKey) ?? []),
    [scorePreview],
  )

  const resetScoringReview = useCallback(() => {
    setDeadStoneRepresentatives([])
    setScoringConfirmations({ black: false, white: false })
  }, [])

  const disposeSession = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) return
    for (const unsubscribe of session.unsubscribe) unsubscribe()
    await session.controller.dispose()
    for (const transport of session.transports) await transport.dispose()
  }, [])

  const createSession = useCallback(async (initialState?: GoGameState) => {
    await disposeSession()
    const sessionMode = modeRef.current
    const seatIds: Record<GoPlayer, GoAIEngineId> = sessionMode === 'ai'
      ? { black: 'katago', white: 'katago' }
      : battleEnginesRef.current
    const transports: { dispose(): void | Promise<void> }[] = []
    let kataGoTransport: KataGoTransport | null = null
    let leelaZeroTransport: HttpLeelaZeroTransport | null = null
    let sayuriTransport: HttpSayuriTransport | null = null
    let kataGoCapabilities: KataGoCapabilities | null = null
    const sessionEngineDetails: Partial<Record<GoAIEngineId, GoAIEngineRuntimeDetails>> = {}
    const kataGoStore = new KataGoMatchAnalysisStore()
    let controller: GoController | null = null
    let unsubscribe: (() => void)[] = []
    try {
      const needsLeelaZero = seatIds.black === 'leela-zero' || seatIds.white === 'leela-zero'
      const needsSayuri = seatIds.black === 'sayuri' || seatIds.white === 'sayuri'
      if ((needsLeelaZero || needsSayuri) && !USE_NATIVE_KATAGO) {
        throw new Error(`${needsSayuri ? 'Sayuri' : 'Leela Zero'} 仅支持 start-local-preview.cmd 启动的本地原生模式。`)
      }
      if (seatIds.black === 'katago' || seatIds.white === 'katago') {
        kataGoTransport = await createConfiguredKataGoTransport()
        transports.push(kataGoTransport)
        kataGoCapabilities = await kataGoTransport.initialize()
        const battleProfile = kataGoCapabilities.profiles['battle-matched']
        const activeProfile = sessionMode === 'battle' ? battleProfile : kataGoCapabilities.profiles[profileRef.current]
        if (!activeProfile) throw new Error('KataGo 服务未提供 battle-matched 独立搜索档位。')
        sessionEngineDetails.katago = {
          engineVersion: kataGoCapabilities.engineVersion,
          modelName: kataGoCapabilities.modelName,
          budget: activeProfile.maxVisits,
          budgetUnit: 'visits',
          runtimeLabel: kataGoRuntimeBackendLabel(kataGoCapabilities.runtimeBackend),
        }
      }
      if (needsLeelaZero) {
        leelaZeroTransport = new HttpLeelaZeroTransport()
        transports.push(leelaZeroTransport)
        const details = await leelaZeroTransport.initialize()
        sessionEngineDetails['leela-zero'] = {
          engineVersion: details.engineVersion,
          modelName: details.modelName,
          budget: details.playouts,
          budgetUnit: 'playouts',
          runtimeLabel: 'Native Leela Zero · OpenCL',
        }
      }
      if (needsSayuri) {
        sayuriTransport = new HttpSayuriTransport()
        transports.push(sayuriTransport)
        const details = await sayuriTransport.initialize()
        sessionEngineDetails.sayuri = {
          engineVersion: details.engineVersion,
          modelName: details.modelName,
          budget: details.playouts,
          budgetUnit: 'playouts',
          runtimeLabel: 'Native Sayuri · CUDA 12',
        }
      }

      const createSeatEngine = (player: GoPlayer): GoSeatEngine => {
        const engineId = seatIds[player]
        if (engineId === 'katago' && kataGoTransport) {
          return new KataGoEngine(`katago-${player}`, {
            transport: kataGoTransport,
            // Existing AI self-play keeps its selected 2k/20k profile. Only the
            // battle mode can request the independently calibrated budget.
            profile: sessionMode === 'battle' ? 'battle-matched' : profileRef.current,
            analysisStore: kataGoStore,
          })
        }
        if (engineId === 'leela-zero' && leelaZeroTransport) {
          return new LeelaZeroEngine(`leela-zero-${player}`, leelaZeroTransport)
        }
        if (engineId === 'sayuri' && sayuriTransport) {
          return new SayuriEngine(`sayuri-${player}`, sayuriTransport)
        }
        throw new Error(`${goAIEngineName(engineId)} 传输层尚未就绪。`)
      }
      const black = createSeatEngine('black')
      const white = createSeatEngine('white')
      const sessionGame = new GoSessionGameEngine(initialState)
      controller = new GameController<GoGameState, GoMove, GoPlayer, GoMoveRecord, GoAIAnalysis>(
        sessionGame,
        [
          { id: 'black', name: `${goAIEngineName(seatIds.black)} 黑方`, kind: 'ai', engine: black },
          { id: 'white', name: `${goAIEngineName(seatIds.white)} 白方`, kind: 'ai', engine: white },
        ],
      )
      const publish = (analysis: GoAIAnalysis) => {
        if (!mountedRef.current) return
        setAnalysisByPlayer((current) => ({ ...current, [analysis.player]: analysis }))
      }
      unsubscribe = [black.subscribe(publish), white.subscribe(publish)]
      const snapshot = await controller.start()
      const session = { controller, transports, unsubscribe, capabilities: kataGoCapabilities, engineDetails: sessionEngineDetails }
      sessionRef.current = session
      setCapabilities(kataGoCapabilities)
      setEngineDetails(sessionEngineDetails)
      setState(snapshot.state)
      return session
    } catch (error) {
      for (const release of unsubscribe) release()
      await controller?.dispose().catch(() => undefined)
      for (const transport of transports) await transport.dispose()
      throw error
    }
  }, [disposeSession, setState])

  const pauseAI = useCallback(async (message = 'AI 对弈已暂停。') => {
    autoRunningRef.current = false
    loopTokenRef.current += 1
    setRunState('paused')
    setNotice(message)
    await sessionRef.current?.controller.cancelPendingTurn(message).catch(() => undefined)
  }, [setRunState])

  const playOneAITurn = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current
    if (!session) throw new Error('围棋 AI 会话尚未建立。')
    const current = session.controller.getSnapshot()
    if (current.state.phase !== 'playing') {
      setState(current.state)
      return false
    }
    if (current.state.history.length >= 1_000) {
      await pauseAI('已达到 1000 手保护上限，对局未被判定胜负。')
      return false
    }
    setRunState('thinking')
    const turn = await session.controller.playAITurn()
    setState(turn.snapshot.state)
    if (turn.snapshot.state.phase !== 'playing') {
      autoRunningRef.current = false
      setRunState('paused')
      setNotice('双方连续虚着，已进入计分确认。')
      return false
    }
    return true
  }, [pauseAI, setRunState, setState])

  const runAILoop = useCallback(async (token: number) => {
    try {
      while (
        mountedRef.current &&
        modeRef.current !== 'local' &&
        autoRunningRef.current &&
        token === loopTokenRef.current
      ) {
        const shouldContinue = await playOneAITurn()
        if (!shouldContinue) break
        setRunState('running')
        await delay(360)
      }
    } catch (error) {
      if (!autoRunningRef.current || isAbortError(error)) return
      autoRunningRef.current = false
      setRunState('error')
      setNotice(errorMessage(error, 'KataGo 搜索失败，棋盘未发生变化。'))
    }
  }, [playOneAITurn, setRunState])

  const startAI = useCallback(async () => {
    if (modeRef.current === 'local' || autoRunningRef.current) return
    try {
      if (!sessionRef.current) {
        setRunState('connecting')
        await createSession(stateRef.current)
      }
      setNotice(null)
      autoRunningRef.current = true
      const token = ++loopTokenRef.current
      setRunState('running')
      void runAILoop(token)
    } catch (error) {
      autoRunningRef.current = false
      setRunState('error')
      setNotice(errorMessage(error, '围棋 AI 无法启动。'))
    }
  }, [createSession, runAILoop, setRunState])

  const stepAI = useCallback(async () => {
    if (modeRef.current === 'local' || autoRunningRef.current) return
    try {
      if (!sessionRef.current) {
        setRunState('connecting')
        await createSession(stateRef.current)
      }
      setNotice(null)
      await playOneAITurn()
      if (stateRef.current.phase === 'playing') setRunState('paused')
    } catch (error) {
      if (isAbortError(error)) return
      setRunState('error')
      setNotice(errorMessage(error, '围棋 AI 单步搜索失败。'))
    }
  }, [createSession, playOneAITurn, setRunState])

  const changeMode = useCallback(async (next: GoMatchMode) => {
    if (next === modeRef.current) return
    autoRunningRef.current = false
    loopTokenRef.current += 1
    await sessionRef.current?.controller.cancelPendingTurn('对局模式已切换。').catch(() => undefined)
    await disposeSession()
    modeRef.current = next
    setModeValue(next)
    setAnalysisByPlayer({})
    setCapabilities(null)
    setEngineDetails({})
    resetScoringReview()
    const fresh = GO_ENGINE.init()
    setState(fresh)
    if (next === 'local') {
      setRunState('offline')
      setNotice('已切换为本地双人对局。')
      return
    }
    setRunState('connecting')
    setNotice(next === 'battle'
      ? '正在连接黑白双方的本地 AI 引擎…'
      : USE_NATIVE_KATAGO
        ? '正在启动 Native KataGo 并加载本机 GPU 模型…'
        : '正在浏览器中加载 KataGo 模型，首次使用需要下载模型…')
    try {
      await createSession(fresh)
      setRunState('ready')
      setNotice(next === 'battle'
        ? 'AI 互对弈引擎已就绪，可以开始对弈。'
        : USE_NATIVE_KATAGO
          ? 'Native KataGo 已就绪，可以开始自对弈。'
          : '浏览器 KataGo 已就绪，可以开始自对弈。')
    } catch (error) {
      setRunState('error')
      setNotice(errorMessage(error, 'KataGo 初始化失败。'))
    }
  }, [createSession, disposeSession, resetScoringReview, setRunState, setState])

  const changeBattleEngine = useCallback(async (player: GoPlayer, engineId: GoAIEngineId) => {
    if (modeRef.current !== 'battle' || autoRunningRef.current) return
    if (!GO_AI_ENGINES.some((engine) => engine.id === engineId)) return
    if (battleEnginesRef.current[player] === engineId) return
    const next = { ...battleEnginesRef.current, [player]: engineId }
    battleEnginesRef.current = next
    setBattleEnginesValue(next)
    setAnalysisByPlayer({})
    const fresh = GO_ENGINE.init()
    setState(fresh)
    setRunState('connecting')
    setNotice('引擎组合已更改，正在建立新的互对弈会话。')
    try {
      await createSession(fresh)
      setRunState('ready')
      setNotice('AI 互对弈引擎已就绪，可以开始对弈。')
    } catch (error) {
      setRunState('error')
      setNotice(errorMessage(error, '围棋 AI 组合初始化失败。'))
    }
  }, [createSession, setRunState, setState])

  const changeProfile = useCallback(async (next: KataGoSearchProfile) => {
    if (next === profileRef.current || autoRunningRef.current) return
    profileRef.current = next
    setProfileValue(next)
    setAnalysisByPlayer({})
    resetScoringReview()
    if (modeRef.current !== 'ai') return
    autoRunningRef.current = false
    loopTokenRef.current += 1
    setRunState('connecting')
    setNotice('搜索档位已更改，正在新开棋局。')
    const fresh = GO_ENGINE.init()
    setState(fresh)
    try {
      await createSession(fresh)
      setRunState('ready')
    } catch (error) {
      setRunState('error')
      setNotice(errorMessage(error, 'KataGo 无法启动。'))
    }
  }, [createSession, resetScoringReview, setRunState, setState])

  const execute = useCallback((move: GoMove) => {
    if (modeRef.current !== 'local') return
    try {
      setState(GO_ENGINE.applyMove(stateRef.current, move))
      setNotice(null)
    } catch (error) {
      setNotice(errorMessage(error, '当前着法无法执行。'))
    }
  }, [setState])

  const newGame = useCallback(async () => {
    autoRunningRef.current = false
    loopTokenRef.current += 1
    const fresh = GO_ENGINE.init()
    setAnalysisByPlayer({})
    resetScoringReview()
    setState(fresh)
    setNotice(null)
    if (modeRef.current === 'local') return
    setRunState('connecting')
    try {
      await createSession(fresh)
      setRunState('ready')
    } catch (error) {
      setRunState('error')
      setNotice(errorMessage(error, 'KataGo 无法启动。'))
    }
  }, [createSession, resetScoringReview, setRunState, setState])

  const toggleDeadGroup = useCallback((point: GoPoint) => {
    if (stateRef.current.phase !== 'scoring') return
    const group = getGoGroup(stateRef.current.board, point)
    if (!group) return
    const groupKeys = new Set(group.stones.map(pointKey))
    setDeadStoneRepresentatives((current) => {
      const alreadySelected = current.some((representative) => groupKeys.has(pointKey(representative)))
      return alreadySelected
        ? current.filter((representative) => !groupKeys.has(pointKey(representative)))
        : [...current, { ...point }]
    })
    setScoringConfirmations({ black: false, white: false })
    setNotice(null)
  }, [])

  const confirmScoring = useCallback((player: GoPlayer) => {
    try {
      if (stateRef.current.phase !== 'scoring') throw new Error('当前不在计分阶段。')
      if (player === 'white' && !scoringConfirmations.black) {
        throw new Error('请先由黑方确认当前死子方案。')
      }
      const next = { ...scoringConfirmations, [player]: true }
      if (next.black && next.white) {
        setState(GO_ENGINE.finalizeScoring(stateRef.current, scoringRequest))
        setScoringConfirmations(next)
      } else {
        setScoringConfirmations(next)
      }
      setNotice(null)
    } catch (error) {
      setNotice(errorMessage(error, '当前无法完成计分。'))
    }
  }, [scoringConfirmations, scoringRequest, setState])

  const resumePlay = useCallback(async () => {
    try {
      const resumed = GO_ENGINE.resumePlay(stateRef.current)
      resetScoringReview()
      setState(resumed)
      setNotice('已恢复落子，虚着计数已清零。')
      if (modeRef.current !== 'local') {
        setRunState('connecting')
        await createSession(resumed)
        setRunState('paused')
      }
    } catch (error) {
      setRunState(modeRef.current !== 'local' ? 'error' : 'offline')
      setNotice(errorMessage(error, '当前无法恢复落子。'))
    }
  }, [createSession, resetScoringReview, setRunState, setState])

  useEffect(() => () => {
    mountedRef.current = false
    autoRunningRef.current = false
    loopTokenRef.current += 1
    void disposeSession()
  }, [disposeSession])

  return {
    state,
    mode,
    profile,
    battleEngines,
    runState,
    notice,
    capabilities,
    engineDetails,
    analysisByPlayer,
    legalMoveKeys,
    scorePreview,
    deadStoneKeys,
    scoringConfirmations,
    execute,
    changeMode,
    changeProfile,
    changeBattleEngine,
    startAI,
    pauseAI,
    stepAI,
    newGame,
    toggleDeadGroup,
    confirmScoring,
    resumePlay,
  }
}

async function createConfiguredKataGoTransport(): Promise<KataGoTransport> {
  if (USE_NATIVE_KATAGO) {
    const { HttpKataGoTransport } = await import('./ai/KataGoTransport')
    return new HttpKataGoTransport()
  }
  const { BrowserKataGoTransport } = await import('./ai/BrowserKataGoTransport')
  return new BrowserKataGoTransport()
}

class GoSessionGameEngine extends GoGameEngine {
  private initialState: GoGameState | null

  constructor(initialState?: GoGameState) {
    super()
    this.initialState = initialState ?? null
  }

  override initializeGame(): GoGameState {
    if (!this.initialState) return super.initializeGame()
    const state = this.initialState
    this.initialState = null
    return state
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
