import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameController } from '../core'
import {
  BrowserKataGoTransport,
  HttpKataGoTransport,
  KataGoEngine,
  KataGoMatchAnalysisStore,
  type KataGoAnalysis,
  type KataGoCapabilities,
  type KataGoSearchProfile,
  type KataGoTransport,
} from './ai'
import { pointKey } from './board'
import { GoGameEngine } from './game-engine'
import type { GoGameState, GoMove, GoMoveRecord, GoPlayer } from './types'

export type GoMatchMode = 'local' | 'ai'
export type GoAIRunState = 'offline' | 'connecting' | 'ready' | 'running' | 'thinking' | 'paused' | 'error'

type GoController = GameController<GoGameState, GoMove, GoPlayer, GoMoveRecord, KataGoAnalysis>

interface AISession {
  controller: GoController
  transport: KataGoTransport
  unsubscribe: readonly (() => void)[]
  capabilities: KataGoCapabilities
}

const GO_ENGINE = new GoGameEngine()

export function useGoMatch() {
  const [state, setStateValue] = useState<GoGameState>(() => GO_ENGINE.init())
  const [mode, setModeValue] = useState<GoMatchMode>('local')
  const [profile, setProfileValue] = useState<KataGoSearchProfile>('fast')
  const [runState, setRunStateValue] = useState<GoAIRunState>('offline')
  const [notice, setNotice] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<KataGoCapabilities | null>(null)
  const [analysisByPlayer, setAnalysisByPlayer] = useState<Partial<Record<GoPlayer, KataGoAnalysis>>>({})

  const stateRef = useRef(state)
  const modeRef = useRef(mode)
  const profileRef = useRef(profile)
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

  const disposeSession = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) return
    for (const unsubscribe of session.unsubscribe) unsubscribe()
    await session.controller.dispose()
    session.transport.dispose()
  }, [])

  const createSession = useCallback(async (initialState?: GoGameState) => {
    await disposeSession()
    // Browser play is fully local. The HTTP transport remains only as a
    // non-Worker compatibility seam for protocol tests and legacy runtimes.
    const transport = typeof globalThis.Worker === 'function'
      ? new BrowserKataGoTransport()
      : new HttpKataGoTransport()
    const store = new KataGoMatchAnalysisStore()
    const black = new KataGoEngine('katago-black', {
      transport,
      profile: profileRef.current,
      analysisStore: store,
    })
    const white = new KataGoEngine('katago-white', {
      transport,
      profile: profileRef.current,
      analysisStore: store,
    })
    const sessionGame = new GoSessionGameEngine(initialState)
    const controller = new GameController<GoGameState, GoMove, GoPlayer, GoMoveRecord, KataGoAnalysis>(
      sessionGame,
      [
        { id: 'black', name: 'KataGo 黑方', kind: 'ai', engine: black },
        { id: 'white', name: 'KataGo 白方', kind: 'ai', engine: white },
      ],
    )
    const publish = (analysis: KataGoAnalysis) => {
      if (!mountedRef.current) return
      setAnalysisByPlayer((current) => ({ ...current, [analysis.player]: analysis }))
    }
    const unsubscribe = [black.subscribe(publish), white.subscribe(publish)]
    try {
      const serviceCapabilities = await transport.initialize()
      const snapshot = await controller.start()
      const session = { controller, transport, unsubscribe, capabilities: serviceCapabilities }
      sessionRef.current = session
      setCapabilities(serviceCapabilities)
      setState(snapshot.state)
      return session
    } catch (error) {
      for (const release of unsubscribe) release()
      await controller.dispose().catch(() => undefined)
      transport.dispose()
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
    if (!session) throw new Error('KataGo 会话尚未建立。')
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
        modeRef.current === 'ai' &&
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
    if (modeRef.current !== 'ai' || autoRunningRef.current) return
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
      setNotice(errorMessage(error, '浏览器 KataGo 无法启动。'))
    }
  }, [createSession, runAILoop, setRunState])

  const stepAI = useCallback(async () => {
    if (modeRef.current !== 'ai' || autoRunningRef.current) return
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
      setNotice(errorMessage(error, 'KataGo 单步搜索失败。'))
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
    const fresh = GO_ENGINE.init()
    setState(fresh)
    if (next === 'local') {
      setRunState('offline')
      setNotice('已切换为本地双人对局。')
      return
    }
    setRunState('connecting')
    setNotice('正在浏览器中加载 KataGo 模型，首次使用需要下载模型…')
    try {
      await createSession(fresh)
      setRunState('ready')
      setNotice('浏览器 KataGo 已就绪，可以开始自对弈。')
    } catch (error) {
      setRunState('error')
      setNotice(errorMessage(error, '浏览器 KataGo 初始化失败。'))
    }
  }, [createSession, disposeSession, setRunState, setState])

  const changeProfile = useCallback(async (next: KataGoSearchProfile) => {
    if (next === profileRef.current || autoRunningRef.current) return
    profileRef.current = next
    setProfileValue(next)
    setAnalysisByPlayer({})
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
      setNotice(errorMessage(error, '浏览器 KataGo 无法启动。'))
    }
  }, [createSession, setRunState, setState])

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
    setState(fresh)
    setNotice(null)
    if (modeRef.current === 'local') return
    setRunState('connecting')
    try {
      await createSession(fresh)
      setRunState('ready')
    } catch (error) {
      setRunState('error')
      setNotice(errorMessage(error, '浏览器 KataGo 无法启动。'))
    }
  }, [createSession, setRunState, setState])

  const finalizeScoring = useCallback(() => {
    try {
      setState(GO_ENGINE.finalizeScoring(stateRef.current))
      setNotice(null)
    } catch (error) {
      setNotice(errorMessage(error, '当前无法完成计分。'))
    }
  }, [setState])

  const resumePlay = useCallback(async () => {
    try {
      const resumed = GO_ENGINE.resumePlay(stateRef.current)
      setState(resumed)
      setNotice('已恢复落子，虚着计数已清零。')
      if (modeRef.current === 'ai') {
        setRunState('connecting')
        await createSession(resumed)
        setRunState('paused')
      }
    } catch (error) {
      setRunState(modeRef.current === 'ai' ? 'error' : 'offline')
      setNotice(errorMessage(error, '当前无法恢复落子。'))
    }
  }, [createSession, setRunState, setState])

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
    runState,
    notice,
    capabilities,
    analysisByPlayer,
    legalMoveKeys,
    execute,
    changeMode,
    changeProfile,
    startAI,
    pauseAI,
    stepAI,
    newGame,
    finalizeScoring,
    resumePlay,
  }
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
