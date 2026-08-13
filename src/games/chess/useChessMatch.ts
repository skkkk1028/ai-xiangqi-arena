import { useCallback, useEffect, useRef, useState } from 'react'
import { engineRegistry } from '../../engine/default-registry'
import { detectEngineSupport } from '../../engine/support'
import type { EngineProgress } from '../../engine/types'
import { GameController } from '../core/GameController'
import { createChessArchive, restoreChessArchive } from './archive'
import { CHESS_FAIRY_STOCKFISH_ENGINE_ID } from '../../engine/config'
import { ChessAIEngineAdapter, CHESS_PERSONALITIES, CHESS_SEARCH_PROFILES, chessPersonalityForColor } from './ai-engine'
import { ChessGameEngine, createChessState } from './rules'
import { alternateChessSeed, createChessSeed } from './openings'
import type { ChessAction, ChessColor, ChessGameState, ChessLiveAnalysis, ChessPersonalityId, ChessSearchBudgetId, ChessSearchProfile, ChessTurnAnalysis } from './types'
import type { EngineProfile } from '../../game/types'
import type { EngineAdapter } from '../../engine/adapter'
import { playChessMoveSound } from './audio'

declare global {
  interface Window {
    __AI_CHESS_BROWSER_VALIDATION__?: {
      status: 'running' | 'passed' | 'failed'
      halfMoves: number
      model: string
      paused: boolean
      error: string | null
    }
  }
}

export type ChessAIRunState = 'ready' | 'loading' | 'running' | 'thinking' | 'paused' | 'finished' | 'error'

interface SeatRuntime {
  color: ChessColor
  personality: ChessPersonalityId
  adapter: EngineAdapter
  profile: EngineProfile | null
  progress: EngineProgress | null
  error: string | null
}

interface SeatResources {
  threads: number
  hash: number
}

class SeededChessEngine extends ChessGameEngine {
  constructor(private readonly initial: ChessGameState) { super() }
  override initializeGame(): ChessGameState { return this.initial }
}

type ChessController = GameController<ChessGameState, ChessAction, ChessColor, import('./types').ChessMoveRecord, ChessTurnAnalysis>

export function useChessMatch() {
  const [seed, setSeed] = useState(() => createChessSeed())
  const [budgetId, setBudgetId] = useState<ChessSearchBudgetId>('standard')
  const [state, setState] = useState(() => createChessState(seed))
  const [runState, setRunState] = useState<ChessAIRunState>('ready')
  const [analyses, setAnalyses] = useState<Partial<Record<ChessColor, ChessTurnAnalysis>>>({})
  const [liveInfo, setLiveInfo] = useState<Partial<Record<ChessColor, ChessLiveAnalysis>>>({})
  const [seats, setSeats] = useState<Record<ChessColor, SeatRuntime | null>>({ w: null, b: null })
  const [notice, setNotice] = useState('新局已就绪，不会自动开赛；点击“开始观战”后才会加载国际象棋 NNUE。')
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<ChessController | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const runningRef = useRef(false)
  const loopInFlightRef = useRef(false)
  const stateRef = useRef(state)
  const budgetRef = useRef(budgetId)
  const seatsRef = useRef(seats)
  const recoveringSeatsRef = useRef(new Set<ChessColor>())
  const recoverSeatRef = useRef<(color: ChessColor, runtimeError: Error) => Promise<void>>(async () => undefined)
  stateRef.current = state
  budgetRef.current = budgetId
  seatsRef.current = seats

  const updateSnapshot = useCallback((controller: ChessController) => {
    const snapshot = controller.getSnapshot()
    stateRef.current = snapshot.state
    setState(snapshot.state)
    if (snapshot.status.phase === 'finished') {
      runningRef.current = false
      setRunState('finished')
    }
  }, [])

  const disposeController = useCallback(async () => {
    runningRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
    const controller = controllerRef.current
    controllerRef.current = null
    if (controller) await controller.dispose()
    setSeats({ w: null, b: null })
  }, [])

  const makeSeat = useCallback((
    color: ChessColor,
    personality: ChessPersonalityId,
    profile: ChessSearchProfile,
    resources: SeatResources,
  ) => {
    const adapter = engineRegistry.createEngine('chess', CHESS_FAIRY_STOCKFISH_ENGINE_ID, {
      assetBase: new URL('./', window.location.origin).href,
      onProgress: (progress) => setSeats((current) => ({
        ...current,
        [color]: current[color] ? { ...current[color]!, progress } : current[color],
      })),
      onRuntimeFatal: (runtimeError) => {
        if (stateRef.current.result) return
        void recoverSeatRef.current(color, runtimeError)
      },
    }, resources)
    const runtime: SeatRuntime = { color, personality, adapter, profile: null, progress: null, error: null }
    const engine = new ChessAIEngineAdapter(adapter, {
      personality,
      profile,
      onInfo: (analysisColor, rootFen, ply, info) => setLiveInfo((current) => ({
        ...current,
        [analysisColor]: { color: analysisColor, rootFen, ply, info },
      })),
    })
    return { runtime, engine }
  }, [])

  const createController = useCallback(async (initial: ChessGameState) => {
    const profile = CHESS_SEARCH_PROFILES[budgetRef.current]
    const support = detectEngineSupport()
    if (!support.supported) {
      throw new Error(support.reason ?? '当前浏览器不支持国际象棋 Worker 所需的 WebAssembly 隔离环境。')
    }
    const resources = deviceResources(support.mobile)
    const whitePersonality = chessPersonalityForColor(initial.seed, 'w')
    const blackPersonality = chessPersonalityForColor(initial.seed, 'b')
    const seatMap: Record<ChessColor, SeatRuntime> = {} as Record<ChessColor, SeatRuntime>
    const white = makeSeat('w', whitePersonality, profile, resources)
    const black = makeSeat('b', blackPersonality, profile, resources)
    seatMap.w = white.runtime
    seatMap.b = black.runtime
    setSeats(seatMap)
    const controller = new GameController(new SeededChessEngine(initial), [
      { id: 'w', name: CHESS_PERSONALITIES[whitePersonality].label, kind: 'ai', engine: white.engine },
      { id: 'b', name: CHESS_PERSONALITIES[blackPersonality].label, kind: 'ai', engine: black.engine },
    ])
    controllerRef.current = controller
    setRunState('loading')
    const snapshot = await controller.start()
    const players = controller.getPlayers()
    setSeats((current) => ({
      w: { ...current.w!, profile: (players[0]?.kind === 'ai' ? (players[0].engine as ChessAIEngineAdapter).engineProfile : null) },
      b: { ...current.b!, profile: (players[1]?.kind === 'ai' ? (players[1].engine as ChessAIEngineAdapter).engineProfile : null) },
    }))
    setState(snapshot.state)
    setRunState('ready')
    setNotice(`已建立双 Worker 会话；${profile.label}，${resources.threads} 线程 / ${resources.hash} MB Hash。`)
    return controller
  }, [makeSeat])

  const recoverSeat = useCallback(async (color: ChessColor, runtimeError: Error) => {
    if (stateRef.current.result) {
      runningRef.current = false
      setRunState('finished')
      return
    }
    if (recoveringSeatsRef.current.has(color)) return
    recoveringSeatsRef.current.add(color)
    runningRef.current = false
    abortRef.current?.abort()
    setRunState('loading')
    setError(runtimeError.message)
    setNotice(`${color === 'w' ? '白' : '黑'}方引擎故障，正在自动重建该席位…`)
    setSeats((current) => ({
      ...current,
      [color]: current[color] ? { ...current[color]!, error: runtimeError.message } : current[color],
    }))

    let replacement: ReturnType<typeof makeSeat> | null = null
    try {
      const controller = controllerRef.current
      const previous = seatsRef.current[color]
      if (!controller || !previous) throw new Error('故障席位缺少可恢复的控制器状态。')
      await controller.cancelPendingTurn('国际象棋故障席位正在重建。')
      const profile = CHESS_SEARCH_PROFILES[budgetRef.current]
      const resources = previous.profile
        ? { threads: previous.profile.threads, hash: previous.profile.hashMb }
        : deviceResources(detectEngineSupport().mobile)
      const created = makeSeat(color, previous.personality, profile, resources)
      replacement = created
      setSeats((current) => ({ ...current, [color]: { ...created.runtime, error: runtimeError.message } }))
      await controller.replaceAIPlayer({
        id: color,
        name: CHESS_PERSONALITIES[previous.personality].label,
        kind: 'ai',
        engine: created.engine,
      })
      const recovered = { ...created.runtime, profile: created.engine.engineProfile, error: null }
      setSeats((current) => ({ ...current, [color]: recovered }))
      setLiveInfo((current) => ({ ...current, [color]: undefined }))
      setError(null)
      setRunState('paused')
      setNotice(`${color === 'w' ? '白' : '黑'}方 Worker 已重建并重新校验 NNUE；对局仍保持暂停，请点击继续。`)
    } catch (caught) {
      replacement?.runtime.adapter.dispose()
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      setRunState('error')
      setNotice(`故障席位重建失败：${message}`)
      setSeats((current) => ({
        ...current,
        [color]: current[color] ? { ...current[color]!, error: message } : current[color],
      }))
    } finally {
      recoveringSeatsRef.current.delete(color)
    }
  }, [makeSeat])
  recoverSeatRef.current = recoverSeat

  const saveArchive = useCallback((next: ChessGameState) => {
    try {
      const controller = controllerRef.current
      const players = controller?.getPlayers().map((player) => ({ seat: String(player.id), kind: player.kind, name: player.name })) ?? [
        { seat: 'w', kind: 'ai' as const, name: CHESS_PERSONALITIES[chessPersonalityForColor(next.seed, 'w')].label },
        { seat: 'b', kind: 'ai' as const, name: CHESS_PERSONALITIES[chessPersonalityForColor(next.seed, 'b')].label },
      ]
      localStorage.setItem('ai-board-games:latest:chess:v1', JSON.stringify(createChessArchive({ state: next, players })))
    } catch {
      // Storage is an optional convenience; it never blocks a running match.
    }
  }, [])

  const playLoop = useCallback(async (single: boolean) => {
    if (loopInFlightRef.current) return
    if (stateRef.current.result) {
      runningRef.current = false
      setRunState('finished')
      setNotice('对局已经结束；请选择“新局”开始另一盘棋。')
      return
    }
    loopInFlightRef.current = true
    const generation = generationRef.current
    let controller = controllerRef.current
    try {
      if (!controller || runState === 'error') {
        if (controller) await disposeController()
        controller = await createController(stateRef.current)
      }
      runningRef.current = !single
      if (!single) setRunState('running')
      const abort = new AbortController()
      abortRef.current = abort
      do {
        if (abort.signal.aborted) break
        if (stateRef.current.result || controller.getSnapshot().status.phase === 'finished') {
          runningRef.current = false
          setRunState('finished')
          break
        }
        setRunState('thinking')
        const movingColor = stateRef.current.turn
        const previousHistoryLength = stateRef.current.history.length
        const turn = await controller.playAITurn(abort.signal)
        if (generation !== generationRef.current) return
        updateSnapshot(controller)
        if (turn.snapshot.state.history.length > previousHistoryLength) {
          playChessMoveSound(turn.snapshot.state.lastMove?.check ? 'check' : turn.snapshot.state.lastMove?.captured ? 'capture' : 'move')
        }
        setAnalyses((current) => ({ ...current, [movingColor]: turn.decision.analysis }))
        saveArchive(turn.snapshot.state)
        if (turn.snapshot.status.phase === 'finished') break
        if (single) { setRunState('paused'); break }
        setRunState('running')
      } while (runningRef.current)
      if (!single && controller.getSnapshot().status.phase === 'playing' && !runningRef.current) setRunState('paused')
    } catch (caught) {
      if (generation !== generationRef.current) return
      if ((caught as Error)?.name === 'AbortError') {
        if (stateRef.current.result) setRunState('finished')
        else if (!single) setRunState('paused')
      } else if (stateRef.current.result || isFinishedControllerError(caught)) {
        runningRef.current = false
        setRunState('finished')
        setNotice('对局已经结束；不会再向引擎发送搜索请求。')
      } else {
        const message = caught instanceof Error ? caught.message : String(caught)
        await recoverSeatRef.current(stateRef.current.turn, new Error(message))
      }
    } finally {
      abortRef.current = null
      loopInFlightRef.current = false
    }
  }, [createController, disposeController, runState, saveArchive, updateSnapshot])

  const start = useCallback(() => {
    if (stateRef.current.result || loopInFlightRef.current) return
    void playLoop(false)
  }, [playLoop])
  const step = useCallback(() => {
    if (stateRef.current.result || loopInFlightRef.current) return
    void playLoop(true)
  }, [playLoop])
  const pause = useCallback(async () => {
    runningRef.current = false
    abortRef.current?.abort()
    await controllerRef.current?.cancelPendingTurn('用户暂停国际象棋观战。')
    setRunState('paused')
    setNotice('已暂停；当前搜索已取消，没有落下半步棋。')
  }, [])
  const newGame = useCallback(async () => {
    generationRef.current += 1
    await disposeController()
    const candidateSeed = (createChessSeed() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const nextSeed = alternateChessSeed(stateRef.current.seed, candidateSeed)
    setSeed(nextSeed)
    const next = createChessState(nextSeed)
    setState(next)
    setAnalyses({})
    setLiveInfo({})
    setError(null)
    setRunState('ready')
    setNotice(`新局已就绪：${next.openingName}；不会自动开赛。`)
  }, [disposeController])
  const restore = useCallback(async () => {
    try {
      const raw = localStorage.getItem('ai-board-games:latest:chess:v1')
      if (!raw) throw new Error('没有可恢复的国际象棋棋局。')
      const restored = restoreChessArchive(JSON.parse(raw))
      generationRef.current += 1
      await disposeController()
      setSeed(restored.seed)
      setState(restored)
      setAnalyses({})
      setLiveInfo({})
      setError(null)
      setRunState(restored.result ? 'finished' : 'paused')
      setNotice(`已恢复 ${restored.history.length} 个半回合；逐手验证通过，点击继续观战。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [disposeController])
  const changeBudget = useCallback((id: ChessSearchBudgetId) => {
    if (runState === 'thinking' || runState === 'running') return
    setBudgetId(id)
    if (controllerRef.current) {
      void disposeController().then(() => setRunState('ready'))
    }
    setNotice(`已选择${CHESS_SEARCH_PROFILES[id].label}；下一次建立 Worker 会话时生效。`)
  }, [disposeController, runState])

  useEffect(() => () => { void disposeController() }, [disposeController])

  useEffect(() => {
    window.__AI_CHESS_BROWSER_VALIDATION__ = {
      status: error ? 'failed' : state.history.length >= 20 ? 'passed' : 'running',
      halfMoves: state.history.length,
      model: 'nn-3475407dc199.nnue',
      paused: runState === 'paused',
      error,
    }
  }, [error, runState, state.history.length])

  return {
    state,
    seed,
    budgetId,
    profile: CHESS_SEARCH_PROFILES[budgetId],
    runState,
    analyses,
    liveInfo,
    seats,
    notice,
    error,
    start,
    pause,
    step,
    newGame,
    restore,
    changeBudget,
  }
}

function deviceResources(mobile: boolean): SeatResources {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return mobile || memory === undefined || memory < 4
    ? { threads: 1, hash: 32 }
    : { threads: 2, hash: 64 }
}

function isFinishedControllerError(value: unknown): boolean {
  return value instanceof Error && value.message === '棋局已经结束。'
}
