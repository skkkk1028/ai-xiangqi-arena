import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineAdapter } from '../engine/adapter'
import { DEFAULT_ENGINE_ID, engineRegistry } from '../engine/default-registry'
import { selectOpening, type OpeningSelection } from '../engine/openings'
import { detectEngineSupport } from '../engine/support'
import type { AIEngineConfig, EngineProgress } from '../engine/types'
import { opposite } from '../game/board'
import {
  isClockExpired,
  RESIGN_STREAK,
  TOTAL_TIME_MS,
  TURN_TIME_MS,
  updateResignationStreak,
} from '../game/adjudication'
import type {
  BoardState,
  ClockState,
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
  AIMatchControllerAI,
  XiangqiAIResignedError,
  XiangqiGameEngine,
  XiangqiIllegalEngineMoveError,
  XiangqiNoBestMoveError,
  type XiangqiGameState,
  type XiangqiRecordEntry,
  type XiangqiTurnAnalysis,
} from '../games/xiangqi'
import { xiangqiResourceProfileId } from '../games/xiangqi/strength-profile'
import { emptyGuessStats, guessPrefix, nextGuessStats, type GuessState } from '../games/xiangqi/guess'
import { moveToUcci } from '../engine/ucci'
import { replayXiangqiUcci } from '../games/xiangqi/archive'

export type MatchMode = 'fairy-duel' | 'engine-battle'
export type AppView = 'home' | 'engine-selection' | 'match'

export interface MatchPlayer {
  engineId: string
  name: string
  protocol: 'UCCI' | 'UCI'
  skillLevel: number | null
  styleDescription?: string
}

export interface MatchState {
  board: BoardState
  turn: Color
  phase: GamePhase
  mode: MatchMode
  players: Record<Color, MatchPlayer>
  clocks: ClockState
  history: MoveRecord[]
  lastMove: Move | null
  checkColor: Color | null
  result: GameResult | null
  thinking: boolean
  liveInfo: SearchInfo
  liveInfoSide: Color
  seed: number
  opening: OpeningSelection
}

export interface EngineState {
  phase: 'checking' | 'loading' | 'ready' | 'unsupported' | 'error'
  progress: EngineProgress | null
  profile: EngineProfile | null
  error: string | null
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

const CHECKING_ENGINE: EngineState = {
  phase: 'checking',
  progress: null,
  profile: null,
  error: null,
}

type AIMatchGameController = GameController<
  XiangqiGameState,
  Move,
  Color,
  XiangqiRecordEntry,
  XiangqiTurnAnalysis
>

const xiangqiGame = new XiangqiGameEngine()

function playerFromConfig(config: Readonly<AIEngineConfig>): MatchPlayer {
  return {
    engineId: config.id,
    name: config.name,
    protocol: config.protocol,
    skillLevel: config.skillLevel,
    styleDescription: config.styleDescription,
  }
}

function initialState(
  phase: GamePhase = 'ready',
  seed = Date.now() >>> 0,
  mode: MatchMode = 'fairy-duel',
  engineIds: Record<Color, string> = { red: DEFAULT_ENGINE_ID, black: DEFAULT_ENGINE_ID },
  game = xiangqiGame.initializeGame(),
): MatchState {
  const red = engineRegistry.getEngine('xiangqi', engineIds.red)
  const black = engineRegistry.getEngine('xiangqi', engineIds.black)
  if (!red || !black) throw new Error('对局包含未注册的 AI 引擎。')
  return {
    board: game.board,
    turn: game.turn,
    phase,
    mode,
    players: { red: playerFromConfig(red), black: playerFromConfig(black) },
    clocks: { red: TOTAL_TIME_MS, black: TOTAL_TIME_MS, turn: 0 },
    history: [],
    lastMove: game.lastMove,
    checkColor: game.checkColor,
    result: game.result,
    thinking: false,
    liveInfo: { ...EMPTY_INFO },
    liveInfoSide: 'red',
    seed,
    opening: selectOpening(seed),
  }
}

function timeoutResult(loser: Color): GameResult {
  return { winner: opposite(loser), loser, reason: 'timeout' }
}

function createMoveSound() {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const context = new AudioContextCtor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(190, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(120, context.currentTime + 0.08)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.11)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.12)
  } catch {
    // 音效属于可选能力，浏览器策略可能阻止它。
  }
}

function uniqueClients(clients: Record<Color, EngineAdapter | null>): EngineAdapter[] {
  return [...new Set(Object.values(clients).filter((client): client is EngineAdapter => Boolean(client)))]
}

export function useAiMatch() {
  const [guess, setGuess] = useState<GuessState>({ phase: 'off', round: null, stats: emptyGuessStats() })
  const guessRef = useRef(guess)
  const publishGuess = useCallback((next: GuessState) => { guessRef.current = next; setGuess(next) }, [])
  const prepareGuess = useCallback((game: XiangqiGameState, reset = false) => {
    const current = guessRef.current
    publishGuess({ phase: current.phase === 'off' ? 'off' : 'choosing',
      round: current.phase === 'off' ? null : { before: game, prefix: guessPrefix(game), selected: null, submitted: false },
      stats: reset ? emptyGuessStats() : current.stats })
  }, [publishGuess])
  const [view, setView] = useState<AppView>('home')
  const [state, setState] = useState<MatchState>(() => initialState())
  const [engineStates, setEngineStates] = useState<Record<Color, EngineState>>({
    red: CHECKING_ENGINE,
    black: CHECKING_ENGINE,
  })
  const [soundEnabled, setSoundEnabled] = useState(true)
  const stateRef = useRef(state)
  const viewRef = useRef(view)
  const engineStatesRef = useRef(engineStates)
  const soundRef = useRef(soundEnabled)
  const clientsRef = useRef<Record<Color, EngineAdapter | null>>({ red: null, black: null })
  const controllerRef = useRef<AIMatchGameController | null>(null)
  const engineIdsRef = useRef<Record<Color, string>>({ red: DEFAULT_ENGINE_ID, black: DEFAULT_ENGINE_ID })
  const practiceSuspendedRef = useRef(false)
  const suspensionRef = useRef<Promise<XiangqiGameState> | null>(null)
  const requestRef = useRef(0)
  const resignationRef = useRef<Record<Color, number>>({ red: 0, black: 0 })
  const recoveryRef = useRef(0)
  const recoverRef = useRef<(color: Color) => Promise<void>>(async () => undefined)

  stateRef.current = state
  viewRef.current = view
  engineStatesRef.current = engineStates
  soundRef.current = soundEnabled

  const setSlotState = useCallback((color: Color, next: EngineState) => {
    setEngineStates((current) => ({ ...current, [color]: next }))
  }, [])

  const disposeAll = useCallback(() => {
    for (const client of uniqueClients(clientsRef.current)) client.dispose()
    clientsRef.current = { red: null, black: null }
  }, [])

  const initializeSlot = useCallback(
    async (color: Color, engineId: string): Promise<EngineAdapter> => {
      const support = detectEngineSupport()
      if (!support.supported) {
        const unsupported: EngineState = {
          phase: 'unsupported',
          progress: null,
          profile: null,
          error: support.reason,
        }
        setSlotState(color, unsupported)
        throw new Error(support.reason ?? '当前浏览器不支持专业引擎。')
      }
      let client!: EngineAdapter
      client = engineRegistry.createEngine(
        'xiangqi',
        engineId,
        {
          assetBase: document.baseURI,
          onProgress: (progress) => {
            if (clientsRef.current[color] !== client) return
            setSlotState(color, { phase: 'loading', progress, profile: null, error: null })
          },
          onRuntimeFatal: (error) => {
            if (clientsRef.current[color] !== client) return
            setSlotState(color, { phase: 'error', progress: null, profile: null, error: error.message })
            if (viewRef.current === 'match') void recoverRef.current(color)
          },
        },
        { threads: support.threads, hash: support.hashMb },
      )
      clientsRef.current[color] = client
      engineIdsRef.current[color] = engineId
      setSlotState(color, { phase: 'loading', progress: null, profile: null, error: null })
      try {
        const profile = await client.init()
        if (clientsRef.current[color] !== client) throw new DOMException('引擎已替换。', 'AbortError')
        setSlotState(color, { phase: 'ready', progress: null, profile, error: null })
        return client
      } catch (error) {
        if (clientsRef.current[color] === client) {
          setSlotState(color, {
            phase: 'error',
            progress: null,
            profile: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        throw error
      }
    },
    [setSlotState],
  )

  const initializeHomeEngine = useCallback(async () => {
    disposeAll()
    setEngineStates({ red: CHECKING_ENGINE, black: CHECKING_ENGINE })
    const client = await initializeSlot('red', DEFAULT_ENGINE_ID)
    clientsRef.current.black = client
    engineIdsRef.current.black = DEFAULT_ENGINE_ID
    setEngineStates((current) => ({ ...current, black: current.red }))
    return client
  }, [disposeAll, initializeSlot])

  const initializeBattleEngines = useCallback(
    async (redId: string, blackId: string) => {
      if (redId === blackId) throw new Error('AI 引擎对战必须选择不同引擎或不同核心配置。')
      if (!engineRegistry.getEngine('xiangqi', redId) || !engineRegistry.getEngine('xiangqi', blackId)) {
        throw new Error('选择了未注册的 AI 引擎。')
      }
      requestRef.current += 1
      disposeAll()
      setEngineStates({ red: CHECKING_ENGINE, black: CHECKING_ENGINE })
      try {
        await Promise.all([initializeSlot('red', redId), initializeSlot('black', blackId)])
      } catch (error) {
        for (const client of uniqueClients(clientsRef.current)) client.stop('引擎对战初始化失败。')
        throw error
      }
    },
    [disposeAll, initializeSlot],
  )

  const recoverEngine = useCallback(
    async (color: Color) => {
      const current = stateRef.current
      if (viewRef.current !== 'match' || current.result) return
      if (recoveryRef.current > 0) {
        setState({
          ...current,
          phase: 'finished',
          thinking: false,
          result: { winner: null, loser: null, reason: 'technical', detail: '引擎异常恢复失败。' },
        })
        return
      }
      recoveryRef.current = 1
      requestRef.current += 1
      setState({ ...current, phase: 'paused', thinking: false })
      try {
        if (current.mode === 'fairy-duel') {
          await initializeHomeEngine()
        } else {
          const previous = clientsRef.current[color]
          clientsRef.current[color] = null
          previous?.dispose()
          await initializeSlot(color, engineIdsRef.current[color])
        }
        if (viewRef.current === 'match') {
          setState((latest) => latest.phase === 'paused' && !latest.result
            ? { ...latest, phase: practiceSuspendedRef.current || ['choosing', 'revealed', 'void'].includes(guessRef.current.phase) ? 'paused' : 'running' }
            : latest)
        }
      } catch (error) {
        const latest = stateRef.current
        setState({
          ...latest,
          phase: 'finished',
          thinking: false,
          result: {
            winner: null,
            loser: null,
            reason: 'technical',
            detail: error instanceof Error ? error.message : '引擎恢复失败。',
          },
        })
      }
    },
    [initializeHomeEngine, initializeSlot],
  )
  recoverRef.current = recoverEngine

  useEffect(() => {
    void initializeHomeEngine().catch(() => undefined)
    return () => disposeAll()
  }, [disposeAll, initializeHomeEngine])

  const resetTrackers = useCallback(() => {
    resignationRef.current = { red: 0, black: 0 }
    recoveryRef.current = 0
  }, [])

  const createController = useCallback((): AIMatchGameController => {
    const ai = new AIMatchControllerAI({
      getAdapter: (player) => clientsRef.current[player],
      getAdapters: () => [clientsRef.current.red, clientsRef.current.black],
      getContext: (player) => {
        const current = stateRef.current
        return {
          mode: current.mode,
          engineId: current.players[player].engineId,
          resourceProfile: xiangqiResourceProfileId({
            threads: engineStatesRef.current[player].profile?.threads ?? 1,
            hashMb: engineStatesRef.current[player].profile?.hashMb ?? 64,
          }),
          seed: current.seed,
          openingMoves: current.opening.moves,
          clocks: current.clocks,
          profile: engineStatesRef.current[player].profile,
          requestToken: requestRef.current,
        }
      },
      onInfo: (player, info, requestToken) => {
        if (requestRef.current !== requestToken) return
        setState((current) =>
          current.turn === player && current.phase === 'running'
            ? { ...current, liveInfo: info, liveInfoSide: player }
            : current,
        )
      },
      shouldResign: (player, info) => {
        const current = stateRef.current
        const forcedMateAgainst = info.score?.kind === 'mate' && info.score.value < 0
        resignationRef.current[player] = updateResignationStreak(
          resignationRef.current[player],
          current.history.length,
          info.wdl?.loss ?? 0,
          forcedMateAgainst,
        )
        return resignationRef.current[player] >= RESIGN_STREAK
      },
    })
    return new GameController(xiangqiGame, [
      { id: 'red', name: '红方 AI', kind: 'ai', engine: ai },
      { id: 'black', name: '黑方 AI', kind: 'ai', engine: ai },
    ])
  }, [])

  const start = useCallback(async () => {
    if (!clientsRef.current.red || engineStates.red.phase !== 'ready') return
    const controller = createController()
    controllerRef.current = controller
    const snapshot = await controller.start()
    const next = initialState('running', Date.now() >>> 0, 'fairy-duel', {
      red: DEFAULT_ENGINE_ID,
      black: DEFAULT_ENGINE_ID,
    }, snapshot.state)
    prepareGuess(snapshot.state, true)
    if (guessRef.current.phase === 'choosing') next.phase = 'paused'
    resetTrackers()
    setState(next)
    setView('match')
  }, [createController, engineStates.red.phase, prepareGuess, resetTrackers])

  const openEngineSelection = useCallback(() => setView('engine-selection'), [])
  const closeEngineSelection = useCallback(() => setView('home'), [])

  const startEngineBattle = useCallback(
    async (redId: string, blackId: string) => {
      await initializeBattleEngines(redId, blackId)
      const controller = createController()
      controllerRef.current = controller
      const snapshot = await controller.start()
      const next = initialState('running', Date.now() >>> 0, 'engine-battle', {
        red: redId,
        black: blackId,
      }, snapshot.state)
      prepareGuess(snapshot.state, true)
      if (guessRef.current.phase === 'choosing') next.phase = 'paused'
      resetTrackers()
      setState(next)
      setView('match')
    },
    [createController, initializeBattleEngines, prepareGuess, resetTrackers],
  )

  const newGame = useCallback(() => {
    practiceSuspendedRef.current = false
    const current = stateRef.current
    if (viewRef.current !== 'match') return
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const requestId = ++requestRef.current
    void controllerRef.current?.cancelPendingTurn('开始新对局。')
    const controller = createController()
    controllerRef.current = controller
    void controller.start().then((snapshot) => {
      if (requestRef.current !== requestId || controllerRef.current !== controller) return
      const next = initialState('running', seed, current.mode, {
        red: current.players.red.engineId,
        black: current.players.black.engineId,
      }, snapshot.state)
      prepareGuess(snapshot.state, true)
      if (guessRef.current.phase === 'choosing') next.phase = 'paused'
      resetTrackers()
      setState(next)
    }).catch(() => undefined)
  }, [createController, prepareGuess, resetTrackers])

  const pause = useCallback(() => {
    requestRef.current += 1
    void controllerRef.current?.cancelPendingTurn('对局已暂停。')
    setState((current) =>
      current.phase === 'running' ? { ...current, phase: 'paused', thinking: false } : current,
    )
  }, [])

  const suspendForPractice = useCallback((): Promise<XiangqiGameState> => {
    if (suspensionRef.current) return suspensionRef.current
    practiceSuspendedRef.current = true
    requestRef.current += 1
    const controller = controllerRef.current
    const next = { ...stateRef.current, phase: stateRef.current.result ? 'finished' as const : 'paused' as const, thinking: false }
    stateRef.current = next
    setState(next)
    publishGuess({ phase: 'off', round: null, stats: guessRef.current.stats })
    const pending = (async () => {
      await controller?.cancelPendingTurn('正在进入局面练习。')
      if (controllerRef.current !== controller) throw new DOMException('原对局已改变。', 'AbortError')
      return controller?.getSnapshot().state ?? replayXiangqiUcci(next.history.map((move) => move.ucci))
    })()
    suspensionRef.current = pending
    void pending.finally(() => { if (suspensionRef.current === pending) suspensionRef.current = null }).catch(() => undefined)
    return pending
  }, [publishGuess])

  const resume = useCallback(() => {
    if (suspensionRef.current) return
    practiceSuspendedRef.current = false
    if (['choosing', 'revealed', 'void'].includes(guessRef.current.phase)) return
    setState((current) =>
      current.phase === 'paused'
        ? { ...current, phase: 'running', liveInfo: { ...EMPTY_INFO }, liveInfoSide: current.turn }
        : current,
    )
  }, [])

  const toggleGuess = useCallback((enabled: boolean) => {
    const current = stateRef.current
    if (!enabled) {
      publishGuess({ ...guessRef.current, phase: 'off', round: null })
      if (viewRef.current === 'match') pause()
      return
    }
    if (current.result && viewRef.current === 'match') return
    publishGuess({ ...guessRef.current, phase: 'armed', round: null })
    if (viewRef.current === 'match' && current.phase === 'paused' && controllerRef.current) {
      prepareGuess(controllerRef.current.getSnapshot().state)
    }
  }, [pause, prepareGuess, publishGuess])

  const selectGuess = useCallback((move: Move) => {
    const current = guessRef.current
    if (current.phase !== 'choosing' || !current.round) return
    const legal = xiangqiGame.getLegalActions(current.round.before).find((item) => xiangqiGame.actionsEqual(item, move))
    if (legal) publishGuess({ ...current, round: { ...current.round, selected: legal } })
  }, [publishGuess])

  const submitGuess = useCallback((skip = false) => {
    const current = guessRef.current
    const game = controllerRef.current?.getSnapshot().state
    if (current.phase !== 'choosing' || !current.round || (!skip && !current.round.selected)
      || !game || guessPrefix(game) !== current.round.prefix || game.result) return
    publishGuess({ ...current, phase: 'searching', round: { ...current.round, selected: skip ? null : current.round.selected, submitted: true } })
    setState((latest) => ({ ...latest, phase: 'running', liveInfo: { ...EMPTY_INFO } }))
  }, [publishGuess])

  const nextGuess = useCallback(() => {
    const game = controllerRef.current?.getSnapshot().state
    if (guessRef.current.phase !== 'revealed' || !game || game.result) return
    prepareGuess(game)
  }, [prepareGuess])

  const returnHome = useCallback(() => {
    practiceSuspendedRef.current = false
    publishGuess({ phase: 'off', round: null, stats: emptyGuessStats() })
    requestRef.current += 1
    controllerRef.current = null
    disposeAll()
    const next = initialState('ready')
    resetTrackers()
    setState(next)
    setView('home')
    void initializeHomeEngine().catch(() => undefined)
  }, [disposeAll, initializeHomeEngine, publishGuess, resetTrackers])

  const releaseEngines = useCallback(() => {
    requestRef.current += 1
    controllerRef.current = null
    disposeAll()
    publishGuess({ phase: 'off', round: null, stats: emptyGuessStats() })
  }, [disposeAll, publishGuess])

  useEffect(() => {
    if (state.phase !== 'running' || view !== 'match') return
    let lastTick = performance.now()
    const interval = window.setInterval(() => {
      const now = performance.now()
      const delta = now - lastTick
      lastTick = now
      setState((current) => {
        if (current.phase !== 'running' || current.result) return current
        const remaining = current.clocks[current.turn] - delta
        const turnElapsed = current.clocks.turn + delta
        const nextClocks = {
          ...current.clocks,
          [current.turn]: Math.max(0, remaining),
          turn: Math.min(TURN_TIME_MS, turnElapsed),
        }
        if (isClockExpired(nextClocks, current.turn)) {
          requestRef.current += 1
          void controllerRef.current?.cancelPendingTurn('棋钟已到时。')
          return {
            ...current,
            clocks: nextClocks,
            phase: 'finished',
            thinking: false,
            result: timeoutResult(current.turn),
          }
        }
        return { ...current, clocks: nextClocks }
      })
    }, 100)
    return () => window.clearInterval(interval)
  }, [state.phase, state.turn, view])

  const syncControllerMove = useCallback((
    current: MatchState,
    game: XiangqiGameState,
    info: SearchInfo,
    turnAtRequest: Color,
    source: 'opening' | 'engine',
  ) => {
    const record = game.history.at(-1)
    if (!record || game.history.length !== current.history.length + 1) return false
    const prediction = guessRef.current
    if (prediction.phase === 'searching' && prediction.round?.prefix === JSON.stringify(current.history.map((move) => move.ucci))) {
      publishGuess({ ...prediction, phase: 'revealed', round: { ...prediction.round, actual: record, source },
        stats: nextGuessStats(prediction.stats, prediction.round.selected ? moveToUcci(prediction.round.selected) : null, record.ucci) })
    } else if (prediction.phase === 'armed' && !game.result) prepareGuess(game)
    const history: MoveRecord[] = [
      ...current.history,
      {
        ...record,
        score: info.score,
        wdl: info.wdl,
        depth: info.depth,
      },
    ]
    if (soundRef.current) createMoveSound()
    setState({
      ...current,
      board: game.board,
      turn: game.turn,
      history,
      lastMove: game.lastMove,
      checkColor: game.checkColor,
      phase: game.result ? 'finished' : guessRef.current.phase === 'off' ? 'running' : 'paused',
      result: game.result,
      thinking: false,
      liveInfo: info,
      liveInfoSide: turnAtRequest,
      seed: (current.seed + 0x9e3779b9 + history.length * 97) >>> 0,
      clocks: { ...current.clocks, turn: 0 },
    })
    return true
  }, [prepareGuess, publishGuess])

  useEffect(() => {
    if (view !== 'match' || state.phase !== 'running' || state.result) return
    if (['choosing', 'revealed', 'void'].includes(guessRef.current.phase)) return
    if (engineStates[state.turn].phase !== 'ready') return
    const controller = controllerRef.current
    if (!clientsRef.current[state.turn] || !controller) return

    const requestId = ++requestRef.current
    const turnAtRequest = state.turn
    const openingUcci = state.opening.moves[state.history.length]
    const usesOpening = Boolean(
      openingUcci &&
      xiangqiGame.findLegalActionByUcci(controller.getSnapshot().state, openingUcci),
    )

    setState((current) => ({
      ...current,
      thinking: true,
      liveInfo: { ...EMPTY_INFO },
      liveInfoSide: turnAtRequest,
    }))
    void controller.playAITurn().then(({ snapshot, decision }) => {
      if (requestRef.current !== requestId || !decision.analysis) return
      const current = stateRef.current
      if (
        current.phase !== 'running' ||
        current.result ||
        current.turn !== turnAtRequest
      ) return
      syncControllerMove(current, snapshot.state, decision.analysis.info, turnAtRequest, decision.analysis.source)
    }).catch((error) => {
      if (
        requestRef.current !== requestId ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) return
      const current = stateRef.current
      if (error instanceof XiangqiAIResignedError) {
        setState({
          ...current,
          phase: 'finished',
          thinking: false,
          liveInfo: error.info,
          liveInfoSide: turnAtRequest,
          result: { winner: opposite(error.player), loser: error.player, reason: 'resignation' },
        })
        return
      }
      if (error instanceof XiangqiNoBestMoveError) {
        setState({ ...current, phase: 'finished', thinking: false, result: error.result })
        return
      }
      if (error instanceof XiangqiIllegalEngineMoveError) {
        setState({
          ...current,
          phase: 'finished',
          thinking: false,
          result: {
            winner: null,
            loser: null,
            reason: 'technical',
            detail: `引擎返回非法或不同步着法：${error.moveText}`,
          },
        })
        return
      }
      void recoverRef.current(turnAtRequest)
    })

    return () => {
      if (requestRef.current === requestId) {
        if (usesOpening) {
          controller.invalidatePendingTurn()
        } else {
          requestRef.current += 1
          void controller.cancelPendingTurn('局面或对局状态已改变。')
        }
      }
    }
  }, [
    engineStates,
    state.board,
    state.history,
    state.opening,
    state.phase,
    state.result,
    state.seed,
    state.turn,
    syncControllerMove,
    view,
  ])

  useEffect(() => {
    if (state.result && ['searching', 'armed', 'choosing'].includes(guessRef.current.phase)) {
      publishGuess({ ...guessRef.current, phase: 'void' })
    }
  }, [state.result, publishGuess])

  return {
    guess,
    toggleGuess,
    selectGuess,
    submitGuess,
    nextGuess,
    view,
    state,
    engineState: engineStates.red,
    engineStates,
    engineConfigs: engineRegistry.listEngines('xiangqi'),
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
    retryEngine: initializeHomeEngine,
  }
}

export const MATCH_LIMITS = {
  totalTimeMs: TOTAL_TIME_MS,
  turnTimeMs: TURN_TIME_MS,
}
