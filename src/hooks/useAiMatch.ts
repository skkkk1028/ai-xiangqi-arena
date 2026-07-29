import { useCallback, useEffect, useRef, useState } from 'react'
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
  GamePhase,
  GameResult,
  Move,
  MoveRecord,
  SearchResponse,
} from '../game/types'

const MIN_VISIBLE_THINK_MS = 6_000
const MIN_SEARCH_BUDGET_MS = 8_000
const SEARCH_BUDGET_RANGE_MS = 4_001

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
  searchDepth: number
  searchNodes: number
  seed: number
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
    searchDepth: 0,
    searchNodes: 0,
    seed,
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
  const [soundEnabled, setSoundEnabled] = useState(true)
  const stateRef = useRef(state)
  const requestRef = useRef(0)
  const repetitionsRef = useRef(new Map<string, number>())
  const noCaptureRef = useRef(0)
  const resignationRef = useRef<Record<Color, number>>({ red: 0, black: 0 })
  const soundRef = useRef(soundEnabled)

  stateRef.current = state
  soundRef.current = soundEnabled

  const resetTrackers = useCallback((board: BoardState) => {
    repetitionsRef.current = new Map([[positionKey(board, 'red'), 1]])
    noCaptureRef.current = 0
    resignationRef.current = { red: 0, black: 0 }
  }, [])

  const start = useCallback(() => {
    const next = initialState('running')
    resetTrackers(next.board)
    setState(next)
  }, [resetTrackers])

  const newGame = useCallback(() => {
    const next = initialState('running', (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0)
    resetTrackers(next.board)
    setState(next)
  }, [resetTrackers])

  const pause = useCallback(() => {
    setState((current) =>
      current.phase === 'running' ? { ...current, phase: 'paused', thinking: false } : current,
    )
  }, [])

  const resume = useCallback(() => {
    setState((current) =>
      current.phase === 'paused' ? { ...current, phase: 'running' } : current,
    )
  }, [])

  const returnHome = useCallback(() => {
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
          return {
            ...current,
            clocks: nextClocks,
            phase: 'finished',
            thinking: false,
            result: timeoutResult(current.turn),
          }
        }
        return {
          ...current,
          clocks: {
            ...current.clocks,
            [current.turn]: remaining,
            turn: turnElapsed,
          },
        }
      })
    }, 100)
    return () => window.clearInterval(interval)
  }, [state.phase, state.turn])

  useEffect(() => {
    if (state.phase !== 'running' || state.result) return

    const requestId = ++requestRef.current
    const worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' })
    const turnAtRequest = state.turn
    const startedAt = performance.now()
    let commitTimer: number | undefined
    let cancelled = false

    setState((current) => ({ ...current, thinking: true }))

    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const response = event.data
      if (response.type !== 'result' || response.requestId !== requestId || cancelled) return
      const visibleDelay = Math.max(0, MIN_VISIBLE_THINK_MS - (performance.now() - startedAt))

      commitTimer = window.setTimeout(() => {
        const current = stateRef.current
        if (
          cancelled ||
          current.phase !== 'running' ||
          current.result ||
          current.turn !== turnAtRequest
        ) {
          return
        }

        if (!response.move) {
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

        resignationRef.current[current.turn] = updateResignationStreak(
          resignationRef.current[current.turn],
          current.history.length,
          response.score,
        )
        if (resignationRef.current[current.turn] >= RESIGN_STREAK) {
          setState({
            ...current,
            phase: 'finished',
            thinking: false,
            searchDepth: response.depth,
            searchNodes: response.nodes,
            result: {
              winner: opposite(current.turn),
              loser: current.turn,
              reason: 'resignation',
            },
          })
          return
        }

        const move = response.move
        const nextBoard = applyMove(current.board, move)
        const nextTurn = opposite(current.turn)
        const legalReplies = getLegalMoves(nextBoard, nextTurn)
        const checked = isInCheck(nextBoard, nextTurn)
        const history: MoveRecord[] = [
          ...current.history,
          {
            ...move,
            notation: formatMove(move),
            ply: current.history.length + 1,
            evaluation: response.score,
            depth: response.depth,
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
        if (!result && drawReason) {
          result = { winner: null, loser: null, reason: drawReason }
        }

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
          searchDepth: response.depth,
          searchNodes: response.nodes,
          seed: (current.seed + 0x9e3779b9 + history.length * 97) >>> 0,
          clocks: { ...current.clocks, turn: 0 },
        })
      }, visibleDelay)
    }

    const availableTurnTime = Math.max(100, TURN_TIME_MS - state.clocks.turn - 150)
    const availableTotalTime = Math.max(100, state.clocks[state.turn] - 150)
    const preferredBudget =
      MIN_SEARCH_BUDGET_MS + (state.seed % SEARCH_BUDGET_RANGE_MS)
    worker.postMessage({
      type: 'search',
      requestId,
      board: state.board,
      color: state.turn,
      timeBudgetMs: Math.min(preferredBudget, availableTurnTime, availableTotalTime),
      seed: state.seed,
      maxDepth: 12,
    })

    return () => {
      cancelled = true
      worker.terminate()
      if (commitTimer !== undefined) window.clearTimeout(commitTimer)
    }
  }, [state.board, state.phase, state.result, state.seed, state.turn])

  return {
    state,
    soundEnabled,
    setSoundEnabled,
    start,
    pause,
    resume,
    newGame,
    returnHome,
  }
}

export const MATCH_LIMITS = {
  totalTimeMs: TOTAL_TIME_MS,
  turnTimeMs: TURN_TIME_MS,
}
