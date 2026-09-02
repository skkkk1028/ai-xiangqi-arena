import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineAdapter } from '../engine/adapter'
import {
  mapDifficultyToEngine,
  type DifficultyLevel,
} from '../engine/difficulty'
import { engineRegistry } from '../engine/default-registry'
import { detectEngineSupport } from '../engine/support'
import type { AIEngineConfig, EngineProgress } from '../engine/types'
import { opposite } from '../game/board'
import type {
  BoardState,
  Color,
  EngineProfile,
  GamePhase,
  GameResult,
  Move,
  MoveRecord,
  SearchInfo,
} from '../game/types'
import { GameController } from '../games/core'
import {
  HumanMatchControllerAI,
  decideAiDrawOffer,
  drawOfferEligibility,
  EMPTY_XIANGQI_SEARCH_INFO,
  fullTurnUndoEligibility,
  resolveHumanThinkPlan,
  XiangqiGameEngine,
  XiangqiIllegalEngineMoveError,
  XiangqiNoBestMoveError,
  type XiangqiGameState,
  type XiangqiRecordEntry,
  type XiangqiTurnAnalysis,
  type ActionEligibility,
} from '../games/xiangqi'
import {
  xiangqiDifficultyProfile,
  xiangqiResourceProfileId,
  type XiangqiResourceProfileId,
} from '../games/xiangqi/strength-profile'

export type HumanColorChoice = Color | 'random'
export type HumanModeView = 'inactive' | 'configuration' | 'match'

export interface HumanGameConfig {
  humanColor: Color
  aiColor: Color
  engineId: string
  difficulty: DifficultyLevel
  resourceProfile: XiangqiResourceProfileId
}

export interface HumanMatchState {
  board: BoardState
  turn: Color
  phase: GamePhase
  config: HumanGameConfig
  engineName: string
  history: MoveRecord[]
  lastMove: Move | null
  checkColor: Color | null
  result: GameResult | null
  thinking: boolean
  aiElapsedMs: number
  aiBudgetMs: number
  liveInfo: SearchInfo
  seed: number
}

export interface HumanEngineState {
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported' | 'recovering'
  progress: EngineProgress | null
  profile: EngineProfile | null
  error: string | null
}

export interface HumanNegotiationState {
  drawOffers: number
  undoUsed: boolean
  pending: 'draw' | 'undo' | null
  notice: string | null
}

const EMPTY_INFO: SearchInfo = {
  depth: 0,
  nodes: 0,
  nps: 0,
  elapsedMs: 0,
  score: null,
  wdl: null,
  pv: [],
}

const IDLE_ENGINE: HumanEngineState = {
  phase: 'idle',
  progress: null,
  profile: null,
  error: null,
}

const INITIAL_NEGOTIATION: HumanNegotiationState = {
  drawOffers: 0,
  undoUsed: false,
  pending: null,
  notice: null,
}

type HumanGameController = GameController<
  XiangqiGameState,
  Move,
  Color,
  XiangqiRecordEntry,
  XiangqiTurnAnalysis
>

const xiangqiGame = new XiangqiGameEngine()

function makeInitialState(
  config: HumanGameConfig,
  engine: Readonly<AIEngineConfig>,
  game = xiangqiGame.initializeGame(),
): HumanMatchState {
  return {
    board: game.board,
    turn: game.turn,
    phase: 'running',
    config,
    engineName: engine.name,
    history: [],
    lastMove: game.lastMove,
    checkColor: game.checkColor,
    result: game.result,
    thinking: false,
    aiElapsedMs: 0,
    aiBudgetMs: 0,
    liveInfo: { ...EMPTY_INFO },
    seed: Date.now() >>> 0,
  }
}

export function resolveHumanColor(choice: HumanColorChoice, random = Math.random): Color {
  if (choice !== 'random') return choice
  return random() < 0.5 ? 'red' : 'black'
}

export function useHumanVsEngine() {
  const [view, setView] = useState<HumanModeView>('inactive')
  const [state, setState] = useState<HumanMatchState | null>(null)
  const [engineState, setEngineState] = useState<HumanEngineState>(IDLE_ENGINE)
  const [engineGeneration, setEngineGeneration] = useState(0)
  const [negotiation, setNegotiation] = useState<HumanNegotiationState>(INITIAL_NEGOTIATION)
  const clientRef = useRef<EngineAdapter | null>(null)
  const controllerRef = useRef<HumanGameController | null>(null)
  const stateRef = useRef(state)
  const viewRef = useRef(view)
  const requestRef = useRef(0)
  const recoveryAttemptsRef = useRef(0)
  const negotiationRef = useRef(negotiation)
  const recoverRef = useRef<() => Promise<void>>(async () => undefined)

  stateRef.current = state
  viewRef.current = view
  negotiationRef.current = negotiation

  const disposeEngine = useCallback(() => {
    requestRef.current += 1
    controllerRef.current = null
    clientRef.current?.dispose()
    clientRef.current = null
  }, [])

  const initializeEngine = useCallback(async (
    engineId: string,
    difficulty: DifficultyLevel,
    recovering = false,
  ) => {
    const config = engineRegistry.getEngine('xiangqi', engineId)
    if (!config) throw new Error('选择了未注册的 AI 引擎。')
    const support = detectEngineSupport()
    if (!support.supported) {
      setEngineState({
        phase: 'unsupported',
        progress: null,
        profile: null,
        error: support.reason,
      })
      throw new Error(support.reason ?? '当前浏览器不支持专业引擎。')
    }
    const resourceProfile = xiangqiResourceProfileId({
      threads: support.threads,
      hashMb: support.hashMb,
    })
    const mapped = mapDifficultyToEngine(xiangqiDifficultyProfile(engineId, difficulty, resourceProfile), config, {
      threads: support.threads,
      hashMb: support.hashMb,
    })
    setEngineState({
      phase: recovering ? 'recovering' : 'loading',
      progress: null,
      profile: null,
      error: null,
    })
    let client!: EngineAdapter
    client = engineRegistry.createEngine(
      'xiangqi',
      engineId,
      {
        assetBase: document.baseURI,
        onProgress: (progress) => {
          if (clientRef.current !== client) return
          setEngineState((current) => ({ ...current, progress }))
        },
        onRuntimeFatal: () => {
          if (clientRef.current === client && viewRef.current === 'match') {
            void recoverRef.current()
          }
        },
      },
      { threads: mapped.threads, hash: mapped.hash },
    )
    clientRef.current = client
    try {
      const profile = await client.init()
      if (clientRef.current !== client) throw new DOMException('引擎已替换。', 'AbortError')
      setEngineState({ phase: 'ready', progress: null, profile, error: null })
      setEngineGeneration((generation) => generation + 1)
      return client
    } catch (error) {
      if (clientRef.current === client) {
        setEngineState({
          phase: 'error',
          progress: null,
          profile: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }, [])

  const resetTrackers = useCallback(() => {
    recoveryAttemptsRef.current = 0
  }, [])

  const createController = useCallback((config: HumanGameConfig): HumanGameController => {
    const ai = new HumanMatchControllerAI({
      getAdapter: () => clientRef.current,
      getAdapters: () => [clientRef.current],
      getContext: () => {
        const current = stateRef.current
        if (!current) throw new Error('人机对局 UI 状态尚未就绪。')
        return {
          engineId: current.config.engineId,
          difficulty: current.config.difficulty,
          seed: current.seed,
          requestToken: requestRef.current,
        }
      },
      onInfo: (player, info, requestToken) => {
        if (requestRef.current !== requestToken) return
        setState((current) =>
          current?.turn === player && current.phase === 'running'
            ? { ...current, liveInfo: info }
            : current,
        )
      },
    })
    return new GameController(xiangqiGame, [
      config.humanColor === 'red'
        ? { id: 'red', name: '真人玩家', kind: 'human' as const }
        : { id: 'red', name: 'AI', kind: 'ai' as const, engine: ai },
      config.humanColor === 'black'
        ? { id: 'black', name: '真人玩家', kind: 'human' as const }
        : { id: 'black', name: 'AI', kind: 'ai' as const, engine: ai },
    ])
  }, [])

  const openConfiguration = useCallback(() => {
    setState(null)
    setEngineState(IDLE_ENGINE)
    setNegotiation(INITIAL_NEGOTIATION)
    setView('configuration')
  }, [])

  const close = useCallback(() => {
    disposeEngine()
    setState(null)
    setEngineState(IDLE_ENGINE)
    setNegotiation(INITIAL_NEGOTIATION)
    setView('inactive')
  }, [disposeEngine])

  const start = useCallback(async (
    choice: HumanColorChoice,
    engineId: string,
    difficulty: DifficultyLevel,
  ) => {
    requestRef.current += 1
    clientRef.current?.dispose()
    clientRef.current = null
    const engine = engineRegistry.getEngine('xiangqi', engineId)
    if (!engine) throw new Error('选择了未注册的 AI 引擎。')
    const support = detectEngineSupport()
    const humanColor = resolveHumanColor(choice)
    const config: HumanGameConfig = {
      humanColor,
      aiColor: opposite(humanColor),
      engineId,
      difficulty,
      resourceProfile: xiangqiResourceProfileId(support),
    }
    await initializeEngine(engineId, difficulty)
    const controller = createController(config)
    controllerRef.current = controller
    const snapshot = await controller.start()
    const next = makeInitialState(config, engine, snapshot.state)
    resetTrackers()
    setNegotiation(INITIAL_NEGOTIATION)
    setState(next)
    setView('match')
  }, [createController, initializeEngine, resetTrackers])

  const recover = useCallback(async () => {
    const current = stateRef.current
    if (!current || viewRef.current !== 'match' || current.result) return
    if (recoveryAttemptsRef.current >= 1) {
      setState({
        ...current,
        phase: 'finished',
        thinking: false,
        result: { winner: null, loser: null, reason: 'technical', detail: 'AI Worker 恢复失败。' },
      })
      return
    }
    recoveryAttemptsRef.current += 1
    requestRef.current += 1
    setState({ ...current, phase: 'paused', thinking: false })
    const previous = clientRef.current
    clientRef.current = null
    previous?.dispose()
    try {
      const client = await initializeEngine(current.config.engineId, current.config.difficulty, true)
      client.newGame()
      if (viewRef.current === 'match') {
        setState((latest) => latest && !latest.result
          ? { ...latest, phase: 'running', thinking: false }
          : latest)
      }
    } catch (error) {
      const latest = stateRef.current
      if (!latest) return
      setState({
        ...latest,
        phase: 'finished',
        thinking: false,
        result: {
          winner: null,
          loser: null,
          reason: 'technical',
          detail: error instanceof Error ? error.message : 'AI Worker 恢复失败。',
        },
      })
    }
  }, [initializeEngine])
  recoverRef.current = recover

  const syncControllerMove = useCallback((
    current: HumanMatchState,
    game: XiangqiGameState,
    info: SearchInfo,
  ) => {
    const record = game.history.at(-1)
    if (!record || game.history.length !== current.history.length + 1) return false
    const history: MoveRecord[] = [
      ...current.history,
      {
        ...record,
        score: info.score,
        wdl: info.wdl,
        depth: info.depth,
      },
    ]
    requestRef.current += 1
    setState({
      ...current,
      board: game.board,
      turn: game.turn,
      history,
      lastMove: game.lastMove,
      checkColor: game.checkColor,
      result: game.result,
      phase: game.result ? 'finished' : 'running',
      thinking: false,
      aiElapsedMs: 0,
      aiBudgetMs: 0,
      liveInfo: info,
      seed: (current.seed + 0x9e3779b9 + history.length * 97) >>> 0,
    })
    return true
  }, [])

  const commitMove = useCallback((expectedTurn: Color, move: Move, info: SearchInfo) => {
    const current = stateRef.current
    if (!current || current.phase !== 'running' || current.result || current.turn !== expectedTurn) {
      return false
    }
    const controller = controllerRef.current
    if (!controller) return false
    try {
      return syncControllerMove(current, controller.play(move).state, info)
    } catch {
      return false
    }
  }, [syncControllerMove])

  const playHumanMove = useCallback((from: { row: number; col: number }, to: { row: number; col: number }) => {
    const current = stateRef.current
    if (
      !current ||
      current.phase !== 'running' ||
      current.thinking ||
      negotiationRef.current.pending !== null ||
      current.turn !== current.config.humanColor
    ) return false
    const move = controllerRef.current?.getLegalActions().find(
      (candidate) =>
        candidate.from.row === from.row &&
        candidate.from.col === from.col &&
        candidate.to.row === to.row &&
        candidate.to.col === to.col,
    )
    if (!move) return false
    return commitMove(current.turn, move, { ...EMPTY_INFO })
  }, [commitMove])

  useEffect(() => {
    if (!state?.thinking || state.phase !== 'running' || state.turn !== state.config.aiColor) return
    const started = performance.now() - state.aiElapsedMs
    const timer = window.setInterval(() => {
      setState((current) => current?.thinking
        ? { ...current, aiElapsedMs: performance.now() - started }
        : current)
    }, 100)
    return () => window.clearInterval(timer)
  }, [state?.config.aiColor, state?.phase, state?.thinking, state?.turn])

  useEffect(() => {
    if (
      view !== 'match' ||
      !state ||
      state.phase !== 'running' ||
      state.result ||
      negotiation.pending ||
      state.turn !== state.config.aiColor ||
      engineState.phase !== 'ready'
    ) return
    const controller = controllerRef.current
    if (!clientRef.current || !controller) return
    const turn = state.turn
    const requestId = ++requestRef.current
    const { budget } = resolveHumanThinkPlan({
      engineId: state.config.engineId,
      difficulty: state.config.difficulty,
      seed: state.seed,
      requestToken: requestId,
    })
    setState({
      ...state,
      thinking: true,
      aiElapsedMs: 0,
      aiBudgetMs: budget,
      liveInfo: { ...EMPTY_INFO },
    })

    void controller.playAITurn().then(({ snapshot, decision }) => {
      if (requestRef.current !== requestId) return
      const current = stateRef.current
      if (!current || !decision.analysis) return
      syncControllerMove(current, snapshot.state, decision.analysis.info)
    }).catch((error) => {
      if (
        requestRef.current !== requestId ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) return
      const current = stateRef.current
      if (error instanceof XiangqiNoBestMoveError && current) {
        setState({
          ...current,
          phase: 'finished',
          thinking: false,
          result: error.result,
        })
        return
      }
      if (error instanceof XiangqiIllegalEngineMoveError && current) {
        setState({
          ...current,
          phase: 'finished',
          thinking: false,
          result: {
            winner: null,
            loser: null,
            reason: 'technical',
            detail: `AI 返回非法或不同步着法：${error.moveText}`,
          },
        })
        return
      }
      if (error instanceof Error && error.message.includes('搜索超过')) {
        if (current && current.turn === current.config.aiColor) {
          setState({
            ...current,
            phase: 'finished',
            thinking: false,
            result: {
              winner: current.config.humanColor,
              loser: current.config.aiColor,
              reason: 'timeout',
              detail: 'AI 未在所选难度的搜索时限内完成行棋。',
            },
          })
        }
        return
      }
      void recoverRef.current()
    })

    return () => {
      if (requestRef.current === requestId) {
        requestRef.current += 1
        void controller.cancelPendingTurn('人机对局状态已改变。')
      }
    }
  }, [
    engineGeneration,
    engineState.phase,
    state?.board,
    state?.config.aiColor,
    state?.config.difficulty,
    state?.config.engineId,
    state?.history,
    state?.phase,
    state?.result,
    state?.seed,
    state?.turn,
    negotiation.pending,
    syncControllerMove,
    view,
  ])

  const pause = useCallback(() => {
    if (negotiationRef.current.pending) return
    requestRef.current += 1
    void controllerRef.current?.cancelPendingTurn('人机对局已暂停。')
    setState((current) => current?.phase === 'running'
      ? { ...current, phase: 'paused', thinking: false }
      : current)
  }, [])

  const resume = useCallback(() => {
    setState((current) => current?.phase === 'paused'
      ? { ...current, phase: 'running', thinking: false }
      : current)
  }, [])

  const newGame = useCallback(() => {
    if (negotiationRef.current.pending) return
    const current = stateRef.current
    const engine = current ? engineRegistry.getEngine('xiangqi', current.config.engineId) : undefined
    if (!current || !engine) return
    const requestId = ++requestRef.current
    const controller = createController(current.config)
    controllerRef.current = controller
    void controller.start().then((snapshot) => {
      if (requestRef.current !== requestId || controllerRef.current !== controller) return
      const next = makeInitialState(current.config, engine, snapshot.state)
      resetTrackers()
      setNegotiation(INITIAL_NEGOTIATION)
      setState(next)
    }).catch(() => undefined)
  }, [createController, resetTrackers])

  useEffect(() => () => disposeEngine(), [disposeEngine])

  const resign = useCallback(() => {
    const current = stateRef.current
    if (!current || current.phase !== 'running' || current.result || negotiationRef.current.pending) return
    requestRef.current += 1
    void controllerRef.current?.cancelPendingTurn('真人已认输。')
    clientRef.current?.stop('真人已认输。')
    setState({
      ...current,
      phase: 'finished',
      thinking: false,
      result: {
        winner: current.config.aiColor,
        loser: current.config.humanColor,
        reason: 'resignation',
      },
    })
    setNegotiation((value) => ({ ...value, pending: null, notice: '真人已认输。' }))
  }, [])

  const offerDraw = useCallback(() => {
    const current = stateRef.current
    const currentNegotiation = negotiationRef.current
    if (!current || !clientRef.current) return
    const eligible = drawOfferEligibility({
      running: current.phase === 'running' && !current.result,
      ownTurn: current.turn === current.config.humanColor && !current.thinking,
      historyLength: current.history.length,
      pending: Boolean(currentNegotiation.pending),
      ownOffers: currentNegotiation.drawOffers,
      opponentOffers: 0,
      maxOffers: 2,
    })
    if (!eligible.enabled) return
    const adapter = clientRef.current
    const requestId = ++requestRef.current
    const plan = resolveHumanThinkPlan({
      engineId: current.config.engineId,
      difficulty: current.config.difficulty,
      seed: current.seed,
      requestToken: requestId,
    })
    setNegotiation({
      ...currentNegotiation,
      drawOffers: currentNegotiation.drawOffers + 1,
      pending: 'draw',
      notice: null,
    })
    void adapter.search(current.history.map((move) => move.ucci), plan.budget, {
      multiPv: 1,
      maxDepth: plan.mapped.maxDepth,
      maxNodes: plan.mapped.maxNodes,
    }).then((response) => {
      if (requestRef.current !== requestId || clientRef.current !== adapter) return
      const latest = stateRef.current
      if (!latest || latest.phase !== 'running' || latest.result) return
      const decision = decideAiDrawOffer(response.info)
      setNegotiation((value) => ({ ...value, pending: null, notice: decision.reason }))
      if (decision.accepted) {
        setState({
          ...latest,
          phase: 'finished',
          thinking: false,
          result: { winner: null, loser: null, reason: 'agreement', detail: decision.reason },
        })
      }
    }).catch((error) => {
      if (requestRef.current !== requestId || (error instanceof DOMException && error.name === 'AbortError')) return
      setNegotiation((value) => ({
        ...value,
        pending: null,
        notice: `AI 未取得有效评价，拒绝和棋。${error instanceof Error ? `（${error.message}）` : ''}`,
      }))
    })
  }, [])

  const requestUndo = useCallback(() => {
    const current = stateRef.current
    const currentNegotiation = negotiationRef.current
    if (!current) return
    const eligible = fullTurnUndoEligibility({
      running: current.phase === 'running' && !current.result && !current.thinking && current.turn === current.config.humanColor,
      pending: Boolean(currentNegotiation.pending),
      history: current.history,
      requester: current.config.humanColor,
      alreadyUsed: currentNegotiation.undoUsed,
    })
    if (!eligible.enabled) return
    const retained = current.history.slice(0, -2)
    const requestId = ++requestRef.current
    setNegotiation({ ...currentNegotiation, pending: 'undo', notice: null })
    void controllerRef.current?.cancelPendingTurn('正在执行友谊悔棋。')
    const controller = createController(current.config)
    controllerRef.current = controller
    void controller.start().then(() => {
      for (const record of retained) {
        const action = xiangqiGame.findLegalActionByUcci(controller.getSnapshot().state, record.ucci)
        if (!action) throw new Error(`无法重放着法 ${record.ucci}`)
        controller.play(action)
      }
      if (requestRef.current !== requestId || controllerRef.current !== controller) return
      const game = controller.getSnapshot().state
      setState({
        ...current,
        board: game.board,
        turn: game.turn,
        history: retained,
        lastMove: game.lastMove,
        checkColor: game.checkColor,
        result: game.result,
        phase: game.result ? 'finished' : 'running',
        thinking: false,
        aiElapsedMs: 0,
        aiBudgetMs: 0,
        liveInfo: { ...EMPTY_XIANGQI_SEARCH_INFO },
        seed: (current.seed + 0x9e3779b9) >>> 0,
      })
      setNegotiation({ drawOffers: currentNegotiation.drawOffers, undoUsed: true, pending: null, notice: 'AI 同意本局一次礼让，已撤销最近一个完整回合。' })
    }).catch((error) => {
      if (requestRef.current !== requestId) return
      setNegotiation({ ...currentNegotiation, pending: null, notice: error instanceof Error ? error.message : '悔棋重放失败。' })
    })
  }, [createController])

  const runningHumanTurn = Boolean(state && state.phase === 'running' && !state.result && state.turn === state.config.humanColor && !state.thinking)
  const resignEligibility: ActionEligibility = state?.phase === 'running' && !state.result && !negotiation.pending
    ? { enabled: true, reason: state.thinking ? 'AI 搜索中也可以认输' : '确认后立即判 AI 获胜' }
    : { enabled: false, reason: negotiation.pending ? '已有对局协商正在处理' : '对局未在进行中' }
  const drawEligibility = drawOfferEligibility({
    running: Boolean(state && state.phase === 'running' && !state.result),
    ownTurn: runningHumanTurn,
    historyLength: state?.history.length ?? 0,
    pending: Boolean(negotiation.pending),
    ownOffers: negotiation.drawOffers,
    opponentOffers: 0,
    maxOffers: 2,
  })
  const undoEligibility = fullTurnUndoEligibility({
    running: Boolean(state && state.phase === 'running' && !state.result && !state.thinking),
    pending: Boolean(negotiation.pending),
    history: state?.history ?? [],
    requester: state?.config.humanColor ?? 'red',
    alreadyUsed: negotiation.undoUsed,
  })

  const legalMoves = state &&
    state.phase === 'running' &&
    !state.thinking &&
    !negotiation.pending &&
    state.turn === state.config.humanColor
    ? controllerRef.current?.getLegalActions() ?? []
    : []

  return {
    view,
    state,
    engineState,
    engines: engineRegistry.listEngines('xiangqi'),
    legalMoves,
    openConfiguration,
    close,
    start,
    playHumanMove,
    pause,
    resume,
    newGame,
    negotiation,
    resignEligibility,
    drawEligibility,
    undoEligibility,
    resign,
    offerDraw,
    requestUndo,
  }
}
