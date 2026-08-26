import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineAdapter } from '../engine/adapter'
import { DEFAULT_ENGINE_ID, engineRegistry } from '../engine/default-registry'
import { detectEngineSupport } from '../engine/support'
import { isClockExpired, TOTAL_TIME_MS, TURN_TIME_MS } from '../game/adjudication'
import { opposite } from '../game/board'
import type {
  ClockState,
  Color,
  GamePhase,
  GameResult,
  Move,
  MoveRecord,
  SearchInfo,
} from '../game/types'
import { GameController } from '../games/core'
import {
  drawOfferEligibility,
  EMPTY_XIANGQI_SEARCH_INFO,
  fullTurnUndoEligibility,
  XiangqiGameEngine,
  type ActionEligibility,
  type XiangqiGameState,
  type XiangqiRecordEntry,
} from '../games/xiangqi'

export type LocalMatchView = 'inactive' | 'match'

export interface LocalNegotiationRequest {
  kind: 'draw' | 'undo'
  requester: Color
}

export interface LocalEvaluationState {
  phase: 'idle' | 'loading' | 'ready' | 'searching' | 'error'
  error: string | null
}

export interface LocalXiangqiState {
  game: XiangqiGameState
  history: MoveRecord[]
  phase: GamePhase
  clocks: ClockState
  evaluation: SearchInfo
  evaluationPerspective: Color
  evaluationState: LocalEvaluationState
  drawOffers: Record<Color, number>
  undoUsed: Record<Color, boolean>
  pending: LocalNegotiationRequest | null
  notice: string | null
}

type LocalController = GameController<XiangqiGameState, Move, Color, XiangqiRecordEntry, unknown>

const xiangqiGame = new XiangqiGameEngine()
const EMPTY_INFO = EMPTY_XIANGQI_SEARCH_INFO

function createController(): LocalController {
  return new GameController(xiangqiGame, [
    { id: 'red', name: '红方玩家', kind: 'human' },
    { id: 'black', name: '黑方玩家', kind: 'human' },
  ])
}

function initialState(game = xiangqiGame.initializeGame()): LocalXiangqiState {
  return {
    game,
    history: [],
    phase: 'ready',
    clocks: { red: TOTAL_TIME_MS, black: TOTAL_TIME_MS, turn: 0 },
    evaluation: { ...EMPTY_INFO },
    evaluationPerspective: game.turn,
    evaluationState: { phase: 'idle', error: null },
    drawOffers: { red: 0, black: 0 },
    undoUsed: { red: false, black: false },
    pending: null,
    notice: null,
  }
}

function toMoveRecord(record: XiangqiRecordEntry): MoveRecord {
  return { ...record, score: null, wdl: null, depth: 0 }
}

function advanceClock(current: LocalXiangqiState, delta: number): LocalXiangqiState {
  if (current.phase !== 'running' || current.game.result || delta <= 0) return current
  const turn = current.game.turn
  const clocks = {
    ...current.clocks,
    [turn]: Math.max(0, current.clocks[turn] - delta),
    turn: Math.min(TURN_TIME_MS, current.clocks.turn + delta),
  }
  if (!isClockExpired(clocks, turn)) return { ...current, clocks }
  return {
    ...current,
    clocks,
    phase: 'finished',
    pending: null,
    game: {
      ...current.game,
      result: {
        winner: opposite(turn),
        loser: turn,
        reason: 'timeout',
        detail: clocks[turn] <= 0 ? '总用时耗尽。' : '单步用时超过 60 秒。',
      },
    },
  }
}

export function useLocalXiangqiMatch() {
  const [view, setView] = useState<LocalMatchView>('inactive')
  const [state, setState] = useState<LocalXiangqiState>(() => initialState())
  const stateRef = useRef(state)
  const viewRef = useRef(view)
  const controllerRef = useRef<LocalController | null>(null)
  const evaluatorRef = useRef<EngineAdapter | null>(null)
  const evaluationRequestRef = useRef(0)
  const [evaluationGeneration, setEvaluationGeneration] = useState(0)
  const lastClockTickRef = useRef(performance.now())

  stateRef.current = state
  viewRef.current = view

  const initializeEvaluator = useCallback(async () => {
    evaluationRequestRef.current += 1
    evaluatorRef.current?.dispose()
    evaluatorRef.current = null
    setState((current) => ({
      ...current,
      evaluationState: { phase: 'loading', error: null },
    }))
    const support = detectEngineSupport()
    if (!support.supported) {
      setState((current) => ({
        ...current,
        evaluationState: { phase: 'error', error: support.reason ?? '当前浏览器不支持评分引擎。' },
      }))
      return
    }
    let evaluator!: EngineAdapter
    evaluator = engineRegistry.createEngine(
      'xiangqi',
      DEFAULT_ENGINE_ID,
      {
        assetBase: document.baseURI,
        onProgress: () => undefined,
        onRuntimeFatal: (error) => {
          if (evaluatorRef.current !== evaluator) return
          setState((current) => ({
            ...current,
            evaluationState: { phase: 'error', error: error.message },
          }))
        },
      },
      { threads: support.threads, hash: support.hashMb },
    )
    evaluatorRef.current = evaluator
    try {
      await evaluator.init()
      if (evaluatorRef.current !== evaluator || viewRef.current !== 'match') return
      setState((current) => ({ ...current, evaluationState: { phase: 'ready', error: null } }))
      setEvaluationGeneration((generation) => generation + 1)
    } catch (error) {
      if (evaluatorRef.current !== evaluator) return
      setState((current) => ({
        ...current,
        evaluationState: {
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }, [])

  const open = useCallback(async () => {
    const controller = createController()
    controllerRef.current = controller
    const snapshot = await controller.start()
    setState(initialState(snapshot.state))
    setView('match')
    lastClockTickRef.current = performance.now()
    void initializeEvaluator()
  }, [initializeEvaluator])

  const close = useCallback(() => {
    evaluationRequestRef.current += 1
    evaluatorRef.current?.dispose()
    evaluatorRef.current = null
    controllerRef.current = null
    setState(initialState())
    setView('inactive')
  }, [])

  const startMatch = useCallback(() => {
    lastClockTickRef.current = performance.now()
    setState((current) => current.phase === 'ready' ? { ...current, phase: 'running', notice: null } : current)
  }, [])

  const settleClock = useCallback((now = performance.now()) => {
    const delta = Math.max(0, now - lastClockTickRef.current)
    lastClockTickRef.current = now
    if (!delta) return
    setState((current) => advanceClock(current, delta))
  }, [])

  useEffect(() => {
    if (view !== 'match' || state.phase !== 'running') return
    lastClockTickRef.current = performance.now()
    const timer = window.setInterval(() => settleClock(), 100)
    const onVisibility = () => settleClock()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [settleClock, state.phase, view])

  useEffect(() => {
    if (view !== 'match' || !evaluatorRef.current || state.evaluationState.phase === 'error') return
    const evaluator = evaluatorRef.current
    const requestId = ++evaluationRequestRef.current
    const perspective = state.game.turn
    setState((current) => ({
      ...current,
      evaluationPerspective: perspective,
      evaluationState: { phase: 'searching', error: null },
    }))
    void evaluator.search(state.history.map((move) => move.ucci), 1_000, { multiPv: 1 })
      .then((response) => {
        if (evaluationRequestRef.current !== requestId || evaluatorRef.current !== evaluator) return
        setState((current) => ({
          ...current,
          evaluation: { ...response.info, pv: [] },
          evaluationPerspective: perspective,
          evaluationState: { phase: 'ready', error: null },
        }))
      })
      .catch((error) => {
        if (evaluationRequestRef.current !== requestId || (error instanceof DOMException && error.name === 'AbortError')) return
        setState((current) => ({
          ...current,
          evaluationState: {
            phase: 'error',
            error: error instanceof Error ? error.message : String(error),
          },
        }))
      })
    return () => {
      if (evaluationRequestRef.current === requestId) {
        evaluationRequestRef.current += 1
        evaluator.stop('局面已经改变。')
      }
    }
  }, [evaluationGeneration, state.history, view])

  const playMove = useCallback((from: Move['from'], to: Move['to']) => {
    const current = stateRef.current
    if (current.phase !== 'running' || current.game.result || current.pending) return false
    const move = controllerRef.current?.getLegalActions().find((candidate) =>
      candidate.from.row === from.row && candidate.from.col === from.col &&
      candidate.to.row === to.row && candidate.to.col === to.col)
    if (!move) return false
    try {
      const game = controllerRef.current!.play(move).state
      const record = game.history.at(-1)
      if (!record) return false
      lastClockTickRef.current = performance.now()
      setState((value) => ({
        ...value,
        game,
        history: [...value.history, toMoveRecord(record)],
        phase: game.result ? 'finished' : 'running',
        clocks: { ...value.clocks, turn: 0 },
        notice: null,
      }))
      return true
    } catch {
      return false
    }
  }, [])

  const pause = useCallback(() => {
    settleClock()
    setState((current) => current.phase === 'running' && !current.pending
      ? { ...current, phase: 'paused' }
      : current)
  }, [settleClock])

  const resume = useCallback(() => {
    lastClockTickRef.current = performance.now()
    setState((current) => current.phase === 'paused' ? { ...current, phase: 'running' } : current)
  }, [])

  const newGame = useCallback(() => {
    if (stateRef.current.pending) return
    const controller = createController()
    controllerRef.current = controller
    void controller.start().then((snapshot) => {
      if (controllerRef.current !== controller) return
      setState(initialState(snapshot.state))
      evaluatorRef.current?.newGame()
      lastClockTickRef.current = performance.now()
    })
  }, [])

  const resign = useCallback(() => {
    settleClock()
    setState((current) => {
      if (current.phase !== 'running' || current.game.result || current.pending) return current
      const loser = current.game.turn
      return {
        ...current,
        phase: 'finished',
        game: { ...current.game, result: { winner: opposite(loser), loser, reason: 'resignation' } },
      }
    })
  }, [settleClock])

  const offerDraw = useCallback(() => {
    settleClock()
    setState((current) => {
      const requester = current.game.turn
      const eligible = drawOfferEligibility({
        running: current.phase === 'running' && !current.game.result,
        ownTurn: true,
        historyLength: current.history.length,
        pending: Boolean(current.pending),
        ownOffers: current.drawOffers[requester],
        opponentOffers: current.drawOffers[opposite(requester)],
      })
      if (!eligible.enabled) return current
      return {
        ...current,
        drawOffers: { ...current.drawOffers, [requester]: current.drawOffers[requester] + 1 },
        pending: { kind: 'draw', requester },
        notice: null,
      }
    })
  }, [settleClock])

  const requestUndo = useCallback(() => {
    settleClock()
    setState((current) => {
      const requester = current.game.turn
      const eligible = fullTurnUndoEligibility({
        running: current.phase === 'running' && !current.game.result,
        pending: Boolean(current.pending),
        history: current.history,
        requester,
        alreadyUsed: current.undoUsed[requester],
      })
      return eligible.enabled
        ? { ...current, pending: { kind: 'undo', requester }, notice: null }
        : current
    })
  }, [settleClock])

  const rejectNegotiation = useCallback(() => {
    setState((current) => current.pending
      ? { ...current, pending: null, notice: current.pending.kind === 'draw' ? '对方拒绝了和棋请求。' : '对方拒绝了悔棋请求。' }
      : current)
  }, [])

  const acceptNegotiation = useCallback(() => {
    const now = performance.now()
    const delta = Math.max(0, now - lastClockTickRef.current)
    lastClockTickRef.current = now
    const current = advanceClock(stateRef.current, delta)
    if (current !== stateRef.current) setState(current)
    const pending = current.pending
    if (!pending || current.phase !== 'running' || current.game.result) return
    if (pending.kind === 'draw') {
      setState({
        ...current,
        pending: null,
        phase: 'finished',
        game: { ...current.game, result: { winner: null, loser: null, reason: 'agreement' } },
      })
      return
    }
    const retained = current.history.slice(0, -2)
    const controller = createController()
    controllerRef.current = controller
    const requestId = ++evaluationRequestRef.current
    void controller.start().then(() => {
      for (const record of retained) {
        const action = xiangqiGame.findLegalActionByUcci(controller.getSnapshot().state, record.ucci)
        if (!action) throw new Error(`无法重放着法 ${record.ucci}`)
        controller.play(action)
      }
      if (controllerRef.current !== controller || evaluationRequestRef.current !== requestId) return
      const game = controller.getSnapshot().state
      const completedAt = performance.now()
      const latest = advanceClock(current, Math.max(0, completedAt - lastClockTickRef.current))
      lastClockTickRef.current = completedAt
      if (!latest.pending || latest.pending.kind !== 'undo' || latest.phase !== 'running' || latest.game.result) {
        setState(latest)
        return
      }
      setState({
        ...latest,
        game,
        history: retained,
        pending: null,
        clocks: { ...latest.clocks, turn: 0 },
        undoUsed: { ...latest.undoUsed, [pending.requester]: true },
        notice: '对方同意友谊悔棋，已撤销最近一个完整回合。',
        evaluationPerspective: game.turn,
      })
    }).catch((error) => {
      setState((value) => ({ ...value, pending: null, notice: error instanceof Error ? error.message : '悔棋重放失败。' }))
    })
  }, [])

  useEffect(() => () => {
    evaluationRequestRef.current += 1
    evaluatorRef.current?.dispose()
  }, [])

  const turn = state.game.turn
  const running = state.phase === 'running' && !state.game.result
  const resignEligibility: ActionEligibility = running && !state.pending
    ? { enabled: true, reason: `${turn === 'red' ? '红方' : '黑方'}认输后立即判负` }
    : { enabled: false, reason: state.pending ? '已有对局协商正在处理' : '对局未在进行中' }
  const drawEligibility = drawOfferEligibility({
    running,
    ownTurn: true,
    historyLength: state.history.length,
    pending: Boolean(state.pending),
    ownOffers: state.drawOffers[turn],
    opponentOffers: state.drawOffers[opposite(turn)],
  })
  const undoEligibility = fullTurnUndoEligibility({
    running,
    pending: Boolean(state.pending),
    history: state.history,
    requester: turn,
    alreadyUsed: state.undoUsed[turn],
  })
  const legalMoves = running && !state.pending ? controllerRef.current?.getLegalActions() ?? [] : []

  return {
    view,
    state,
    legalMoves,
    resignEligibility,
    drawEligibility,
    undoEligibility,
    open,
    close,
    startMatch,
    playMove,
    pause,
    resume,
    newGame,
    resign,
    offerDraw,
    requestUndo,
    acceptNegotiation,
    rejectNegotiation,
    retryEvaluator: initializeEvaluator,
  }
}
