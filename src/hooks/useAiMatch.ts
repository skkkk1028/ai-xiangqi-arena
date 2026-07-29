import { useCallback, useEffect, useRef, useState } from 'react'
import { UcciEngineClient, type EngineProgress } from '../engine/client'
import { selectOpening } from '../engine/openings'
import { detectEngineSupport } from '../engine/support'
import { matchUcciMove, moveToUcci } from '../engine/ucci'
import { applyMove, createInitialBoard, opposite, positionKey } from '../game/board'
import {
  getSimplifiedDrawReason,
  isClockExpired,
  RESIGN_STREAK,
  TOTAL_TIME_MS,
  TURN_TIME_MS,
  updateResignationStreak,
} from '../game/adjudication'
import { formatMove } from '../game/notation'
import { getLegalMoves, isInCheck } from '../game/rules'
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

const SEARCH_MIN_MS = 12_000
const SEARCH_RANGE_MS = 6_001
const CLOCK_SAFETY_MS = 500

export interface MatchState {
  board: BoardState
  turn: Color
  phase: GamePhase
  clocks: ClockState
  history: MoveRecord[]
  lastMove: Move | null
  checkColor: Color | null
  result: GameResult | null
  thinking: boolean
  liveInfo: SearchInfo
  seed: number
  opening: string[]
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

function initialState(phase: GamePhase = 'ready', seed = Date.now() >>> 0): MatchState {
  return {
    board: createInitialBoard(),
    turn: 'red',
    phase,
    clocks: { red: TOTAL_TIME_MS, black: TOTAL_TIME_MS, turn: 0 },
    history: [],
    lastMove: null,
    checkColor: null,
    result: null,
    thinking: false,
    liveInfo: { ...EMPTY_INFO },
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
    // Audio is optional and can be blocked by browser policy.
  }
}

export function useAiMatch() {
  const [state, setState] = useState<MatchState>(() => initialState())
  const [engineState, setEngineState] = useState<EngineState>({
    phase: 'checking',
    progress: null,
    profile: null,
    error: null,
  })
  const [soundEnabled, setSoundEnabled] = useState(true)
  const stateRef = useRef(state)
  const soundRef = useRef(soundEnabled)
  const clientRef = useRef<UcciEngineClient | null>(null)
  const requestRef = useRef(0)
  const repetitionsRef = useRef(new Map<string, number>())
  const noCaptureRef = useRef(0)
  const resignationRef = useRef<Record<Color, number>>({ red: 0, black: 0 })
  const recoveryRef = useRef(0)

  stateRef.current = state
  soundRef.current = soundEnabled

  const initializeEngine = useCallback(async () => {
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

    clientRef.current?.dispose()
    const client = new UcciEngineClient(
      document.baseURI,
      support.threads,
      support.hashMb,
      (progress) =>
        setEngineState((current) => ({
          ...current,
          phase: progress.phase === 'ready' ? 'ready' : 'loading',
          progress,
        })),
    )
    clientRef.current = client
    setEngineState({ phase: 'loading', progress: null, profile: null, error: null })
    try {
      const profile = await client.init()
      if (clientRef.current !== client) throw new DOMException('引擎已替换。', 'AbortError')
      setEngineState({ phase: 'ready', progress: null, profile, error: null })
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

  useEffect(() => {
    void initializeEngine().catch(() => undefined)
    return () => clientRef.current?.dispose()
  }, [initializeEngine])

  const resetTrackers = useCallback((board: BoardState) => {
    repetitionsRef.current = new Map([[positionKey(board, 'red'), 1]])
    noCaptureRef.current = 0
    resignationRef.current = { red: 0, black: 0 }
    recoveryRef.current = 0
  }, [])

  const start = useCallback(() => {
    if (!clientRef.current || engineState.phase !== 'ready') return
    const next = initialState('running')
    resetTrackers(next.board)
    clientRef.current.newGame()
    setState(next)
  }, [engineState.phase, resetTrackers])

  const newGame = useCallback(() => {
    if (!clientRef.current || engineState.phase !== 'ready') return
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const next = initialState('running', seed)
    resetTrackers(next.board)
    clientRef.current.newGame()
    requestRef.current += 1
    setState(next)
  }, [engineState.phase, resetTrackers])

  const pause = useCallback(() => {
    requestRef.current += 1
    clientRef.current?.stop('对局已暂停。')
    setState((current) =>
      current.phase === 'running' ? { ...current, phase: 'paused', thinking: false } : current,
    )
  }, [])

  const resume = useCallback(() => {
    setState((current) =>
      current.phase === 'paused' ? { ...current, phase: 'running', liveInfo: { ...EMPTY_INFO } } : current,
    )
  }, [])

  const returnHome = useCallback(() => {
    requestRef.current += 1
    clientRef.current?.stop('已返回首页。')
    const next = initialState('ready')
    resetTrackers(next.board)
    setState(next)
  }, [resetTrackers])

  useEffect(() => {
    if (state.phase !== 'running') return
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
          clientRef.current?.stop('棋钟已到时。')
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
  }, [state.phase, state.turn])

  useEffect(() => {
    if (state.phase !== 'running' || state.result || engineState.phase !== 'ready') return
    const client = clientRef.current
    if (!client) return

    const requestId = ++requestRef.current
    const turnAtRequest = state.turn
    const legalMoves = getLegalMoves(state.board, state.turn)
    if (legalMoves.length === 0) {
      const checked = isInCheck(state.board, state.turn)
      setState((current) => ({
        ...current,
        phase: 'finished',
        thinking: false,
        result: {
          winner: opposite(current.turn),
          loser: current.turn,
          reason: checked ? 'checkmate' : 'stalemate',
        },
      }))
      return
    }

    const commitMove = (
      move: Move,
      ucci: string,
      info: SearchInfo,
    ) => {
      const current = stateRef.current
      if (
        requestRef.current !== requestId ||
        current.phase !== 'running' ||
        current.result ||
        current.turn !== turnAtRequest
      ) return

      const forcedMateAgainst = info.score?.kind === 'mate' && info.score.value < 0
      resignationRef.current[current.turn] = updateResignationStreak(
        resignationRef.current[current.turn],
        current.history.length,
        info.wdl?.loss ?? 0,
        forcedMateAgainst,
      )
      if (resignationRef.current[current.turn] >= RESIGN_STREAK) {
        setState({
          ...current,
          phase: 'finished',
          thinking: false,
          liveInfo: info,
          result: {
            winner: opposite(current.turn),
            loser: current.turn,
            reason: 'resignation',
          },
        })
        return
      }

      const nextBoard = applyMove(current.board, move)
      const nextTurn = opposite(current.turn)
      const legalReplies = getLegalMoves(nextBoard, nextTurn)
      const checked = isInCheck(nextBoard, nextTurn)
      const history: MoveRecord[] = [
        ...current.history,
        {
          ...move,
          ucci,
          notation: formatMove(move),
          ply: current.history.length + 1,
          score: info.score,
          wdl: info.wdl,
          depth: info.depth,
        },
      ]

      let result: GameResult | null = null
      if (legalReplies.length === 0) {
        result = {
          winner: current.turn,
          loser: nextTurn,
          reason: checked ? 'checkmate' : 'stalemate',
        }
      }

      noCaptureRef.current = move.captured ? 0 : noCaptureRef.current + 1
      const key = positionKey(nextBoard, nextTurn)
      const repeated = (repetitionsRef.current.get(key) ?? 0) + 1
      repetitionsRef.current.set(key, repeated)
      const drawReason = getSimplifiedDrawReason(repeated, noCaptureRef.current)
      if (!result && drawReason) result = { winner: null, loser: null, reason: drawReason }

      if (soundRef.current) createMoveSound()
      setState({
        ...current,
        board: nextBoard,
        turn: nextTurn,
        history,
        lastMove: move,
        checkColor: checked ? nextTurn : null,
        phase: result ? 'finished' : 'running',
        result,
        thinking: false,
        liveInfo: info,
        seed: (current.seed + 0x9e3779b9 + history.length * 97) >>> 0,
        clocks: { ...current.clocks, turn: 0 },
      })
    }

    const openingUcci = state.opening[state.history.length]
    if (openingUcci) {
      const move = matchUcciMove(state.board, legalMoves, openingUcci)
      if (move) {
        setState((current) => ({ ...current, thinking: true, liveInfo: { ...EMPTY_INFO } }))
        const timer = window.setTimeout(() => commitMove(move, openingUcci, { ...EMPTY_INFO }), 250)
        return () => window.clearTimeout(timer)
      }
    }

    const remainingTotal = state.clocks[state.turn]
    const remainingTurn = TURN_TIME_MS - state.clocks.turn
    const preferred = SEARCH_MIN_MS + (state.seed % SEARCH_RANGE_MS)
    const lowTimeBudget =
      remainingTotal < 45_000 ? Math.min(5_000, remainingTotal - CLOCK_SAFETY_MS) : preferred
    const budget = Math.max(
      50,
      Math.min(preferred, lowTimeBudget, remainingTotal - CLOCK_SAFETY_MS, remainingTurn - CLOCK_SAFETY_MS),
    )

    setState((current) => ({ ...current, thinking: true, liveInfo: { ...EMPTY_INFO } }))
    void client
      .search(
        state.history.map((record) => record.ucci),
        budget,
        (info) => {
          if (requestRef.current === requestId) {
            setState((current) =>
              current.turn === turnAtRequest && current.phase === 'running'
                ? { ...current, liveInfo: info }
                : current,
            )
          }
        },
      )
      .then((response) => {
        if (requestRef.current !== requestId) return
        if (!response.bestmove) {
          const current = stateRef.current
          const checked = isInCheck(current.board, current.turn)
          setState({
            ...current,
            phase: 'finished',
            thinking: false,
            result: {
              winner: opposite(current.turn),
              loser: current.turn,
              reason: checked ? 'checkmate' : 'stalemate',
            },
          })
          return
        }
        const current = stateRef.current
        const currentLegalMoves = getLegalMoves(current.board, current.turn)
        const move = matchUcciMove(current.board, currentLegalMoves, response.bestmove)
        if (!move) {
          setState({
            ...current,
            phase: 'finished',
            thinking: false,
            result: {
              winner: null,
              loser: null,
              reason: 'technical',
              detail: `引擎返回非法或不同步着法：${response.bestmove}`,
            },
          })
          return
        }
        commitMove(move, moveToUcci(move), response.info)
      })
      .catch(async (error) => {
        if (requestRef.current !== requestId || (error instanceof DOMException && error.name === 'AbortError')) return
        const current = stateRef.current
        if (recoveryRef.current === 0) {
          recoveryRef.current = 1
          setState({ ...current, phase: 'paused', thinking: false })
          try {
            await initializeEngine()
            if (stateRef.current.phase === 'paused' && !stateRef.current.result) {
              setState((latest) => ({ ...latest, phase: 'running' }))
            }
            return
          } catch {
            // Fall through to a technical stop after the single permitted restart.
          }
        }
        setState({
          ...stateRef.current,
          phase: 'finished',
          thinking: false,
          result: {
            winner: null,
            loser: null,
            reason: 'technical',
            detail: error instanceof Error ? error.message : '专业引擎异常中止。',
          },
        })
      })

    return () => {
      if (requestRef.current === requestId) {
        requestRef.current += 1
        client.stop('局面或对局状态已改变。')
      }
    }
  }, [
    engineState.phase,
    initializeEngine,
    state.board,
    state.opening,
    state.phase,
    state.result,
    state.seed,
    state.turn,
  ])

  return {
    state,
    engineState,
    soundEnabled,
    setSoundEnabled,
    start,
    pause,
    resume,
    newGame,
    returnHome,
    retryEngine: initializeEngine,
  }
}

export const MATCH_LIMITS = {
  totalTimeMs: TOTAL_TIME_MS,
  turnTimeMs: TURN_TIME_MS,
}
