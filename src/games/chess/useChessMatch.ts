import { useCallback, useEffect, useRef, useState } from 'react'
import { engineRegistry } from '../../engine/default-registry'
import { detectEngineSupport } from '../../engine/support'
import type { EngineProgress } from '../../engine/types'
import { GameController } from '../core/GameController'
import { createChessArchive, restoreChessArchive } from './archive'
import { CHESS_FAIRY_STOCKFISH_ENGINE_ID, CHESS_OBSIDIAN_16_ENGINE_ID, CHESS_STOCKFISH_18_ARENA_ENGINE_ID, CHESS_STOCKFISH_18_ENGINE_ID, CHESS_STOCKFISH_18_NATIVE_ENGINE_ID, CHESS_STOCKFISH_18_SINGLE_ENGINE_ID } from '../../engine/config'
import { ChessAIEngineAdapter, CHESS_PERSONALITIES, CHESS_SEARCH_PROFILES, chessPersonalityForColor } from './ai-engine'
import { ChessGameEngine, createChessState } from './rules'
import { alternateChessSeed, createChessSeed } from './openings'
import type { ChessAction, ChessArenaBudgetId, ChessArenaEngineId, ChessColor, ChessGameState, ChessLiveAnalysis, ChessPersonalityId, ChessSearchBudgetId, ChessSearchProfile, ChessTurnAnalysis } from './types'
import type { EngineProfile } from '../../game/types'
import type { EngineAdapter } from '../../engine/adapter'
import type { MatchArchivePlayer } from '../core'
import { playChessMoveSound } from './audio'
import { ChessArenaNativeAdapter } from './arena-native-adapter'

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
  arenaEngineId?: ChessArenaEngineId
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

export const CHESS_ARENA_PROFILES: Record<ChessArenaBudgetId, ChessSearchProfile> = {
  fast: { id: 'fast', label: '快速 · 3 秒', movetimeMs: 3_000, threads: 1, hashMb: 64, multiPv: 1, mode: 'professional' },
  standard: { id: 'standard', label: '标准 · 10 秒', movetimeMs: 10_000, threads: 2, hashMb: 128, multiPv: 1, mode: 'professional' },
  deep: { id: 'deep', label: '深思 · 30 秒', movetimeMs: 30_000, threads: 4, hashMb: 256, multiPv: 1, mode: 'professional' },
}

export interface ChessMatchOptions { mode?: 'theatre' | 'arena' | 'human' }

export function useChessMatch(options: ChessMatchOptions = {}) {
  const arena = options.mode === 'arena'
  const human = options.mode === 'human'
  const [seed, setSeed] = useState(() => createChessSeed())
  const [budgetId, setBudgetId] = useState<ChessSearchBudgetId>('standard')
  const [arenaEngines, setArenaEngines] = useState<Record<ChessColor, ChessArenaEngineId>>({ w: 'stockfish-18', b: 'obsidian-16' })
  const [humanColor, setHumanColor] = useState<ChessColor>('w')
  const [humanEngine, setHumanEngine] = useState<ChessArenaEngineId>('stockfish-18')
  const [archivePlayers, setArchivePlayers] = useState<readonly MatchArchivePlayer[]>([])
  const [state, setState] = useState(() => createChessState(seed))
  const [runState, setRunState] = useState<ChessAIRunState>('ready')
  const [analyses, setAnalyses] = useState<Partial<Record<ChessColor, ChessTurnAnalysis>>>({})
  const [liveInfo, setLiveInfo] = useState<Partial<Record<ChessColor, ChessLiveAnalysis>>>({})
  const [seats, setSeats] = useState<Record<ChessColor, SeatRuntime | null>>({ w: null, b: null })
  const [notice, setNotice] = useState(human
    ? '人机对战已就绪；选择执子方、对手引擎与思考强度后点击“开始对战”。'
    : arena
      ? '竞技场已就绪；选择双方引擎与统一资源后点击“开始对战”。Obsidian 需要本地预览桥接。'
      : '新局已就绪，不会自动开赛；点击“开始观战”后才会加载国际象棋 NNUE。')
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<ChessController | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const runningRef = useRef(false)
  const loopInFlightRef = useRef(false)
  const stateRef = useRef(state)
  const budgetRef = useRef(budgetId)
  const arenaEnginesRef = useRef(arenaEngines)
  const humanColorRef = useRef(humanColor)
  const humanEngineRef = useRef(humanEngine)
  const seatsRef = useRef(seats)
  const recoveringSeatsRef = useRef(new Set<ChessColor>())
  const recoverSeatRef = useRef<(color: ChessColor, runtimeError: Error) => Promise<void>>(async () => undefined)
  stateRef.current = state
  budgetRef.current = budgetId
  arenaEnginesRef.current = arenaEngines
  humanColorRef.current = humanColor
  humanEngineRef.current = humanEngine
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
    const arenaEngineId = human
      ? humanEngineRef.current
      : arena
        ? arenaEnginesRef.current[color]
        : undefined
    const engineId = arenaEngineId ? chessArenaEngineConfigId(arenaEngineId) : chessEngineId(profile, resources)
    const adapter = engineRegistry.createEngine('chess', engineId, {
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
    const runtime: SeatRuntime = { color, personality, adapter, profile: null, progress: null, error: null, arenaEngineId }
    const engine = new ChessAIEngineAdapter(adapter, {
      personality,
      profile,
      onInfo: (analysisColor, rootFen, ply, info) => setLiveInfo((current) => ({
        ...current,
        [analysisColor]: { color: analysisColor, rootFen, ply, info },
      })),
    })
    return { runtime, engine }
  }, [arena, human])

  const createController = useCallback(async (initial: ChessGameState) => {
    const profile = activeProfile(arena || human, budgetRef.current)
    const support = detectEngineSupport()
    if (profile.mode === 'personality' && !support.supported) {
      throw new Error(support.reason ?? '当前浏览器不支持国际象棋 Worker 所需的 WebAssembly 隔离环境。')
    }
    if (profile.mode === 'professional' && typeof WebAssembly !== 'object') {
      throw new Error('当前浏览器不支持专业模式所需的 WebAssembly。')
    }
    const resources = deviceResources(profile, support.mobile, support.supported)
    const seatMap: Record<ChessColor, SeatRuntime | null> = { w: null, b: null }
    const players: Array<import('../core').GamePlayer<ChessGameState, ChessAction, ChessColor, import('./types').ChessMoveRecord, ChessTurnAnalysis>> = []
    for (const color of ['w', 'b'] as const) {
      if (human && color === humanColorRef.current) {
        players.push({ id: color, name: `真人 · ${color === 'w' ? '白方' : '黑方'}`, kind: 'human' })
        continue
      }
      const personality = chessPersonalityForColor(initial.seed, color)
      const created = makeSeat(color, personality, profile, resources)
      seatMap[color] = created.runtime
      players.push({
        id: color,
        name: arena || human ? arenaEngineLabel(created.runtime.arenaEngineId!) : CHESS_PERSONALITIES[personality].label,
        kind: 'ai',
        engine: created.engine,
      })
    }
    setSeats(seatMap)
    const controller = new GameController(new SeededChessEngine(initial), players)
    controllerRef.current = controller
    setRunState('loading')
    const snapshot = await controller.start()
    const startedPlayers = controller.getPlayers()
    setSeats((current) => ({
      w: current.w ? { ...current.w, profile: profileForPlayer(startedPlayers, 'w') } : null,
      b: current.b ? { ...current.b, profile: profileForPlayer(startedPlayers, 'b') } : null,
    }))
    setState(snapshot.state)
    setRunState('ready')
    const runtime = human
      ? `${arenaEngineLabel(humanEngineRef.current)} 对手`
      : arena
      ? `${arenaEngineLabel(arenaEnginesRef.current.w)} VS ${arenaEngineLabel(arenaEnginesRef.current.b)}`
      : profile.mode === 'professional'
      ? resources.threads > 1 ? 'Stockfish 18 完整多线程' : 'Stockfish 18 完整单线程'
      : 'Fairy-Stockfish 个性模式'
    setNotice(`${human ? '已建立人机引擎会话' : '已建立双 Worker 会话'}；${profile.label} · ${runtime} · ${resources.threads} 线程 / ${resources.hash} MB Hash。`)
    return controller
  }, [arena, human, makeSeat])

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
      const profile = activeProfile(arena || human, budgetRef.current)
      const resources = previous.profile
        ? { threads: previous.profile.threads, hash: previous.profile.hashMb }
        : deviceResources(profile, detectEngineSupport().mobile, detectEngineSupport().supported)
      if (arena && previous.adapter instanceof ChessArenaNativeAdapter) {
        await previous.adapter.releaseSession()
      }
      const created = makeSeat(color, previous.personality, profile, resources)
      replacement = created
      setSeats((current) => ({ ...current, [color]: { ...created.runtime, error: runtimeError.message } }))
      await controller.replaceAIPlayer({
        id: color,
        name: (arena || human) && previous.arenaEngineId ? arenaEngineLabel(previous.arenaEngineId) : CHESS_PERSONALITIES[previous.personality].label,
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
  }, [arena, human, makeSeat])
  recoverSeatRef.current = recoverSeat

  const saveArchive = useCallback((next: ChessGameState) => {
    try {
      const controller = controllerRef.current
      const players: MatchArchivePlayer[] = controller?.getPlayers().map((player) => {
        const color = String(player.id) as ChessColor
        const seat = seatsRef.current[color]
        return { seat: color, kind: player.kind, name: player.name, ...((arena || human) && seat?.profile && seat.arenaEngineId ? { engine: arenaRuntimeSnapshot(seat.arenaEngineId, seat.profile, activeProfile(true, budgetRef.current).movetimeMs) } : {}) }
      }) ?? [
        { seat: 'w', kind: human && humanColorRef.current === 'w' ? 'human' as const : 'ai' as const, name: human && humanColorRef.current === 'w' ? '真人 · 白方' : CHESS_PERSONALITIES[chessPersonalityForColor(next.seed, 'w')].label },
        { seat: 'b', kind: human && humanColorRef.current === 'b' ? 'human' as const : 'ai' as const, name: human && humanColorRef.current === 'b' ? '真人 · 黑方' : CHESS_PERSONALITIES[chessPersonalityForColor(next.seed, 'b')].label },
      ]
      if (arena || human) setArchivePlayers(players)
      const storageKey = arena ? 'ai-board-games:latest:chess-arena:v1' : human ? 'ai-board-games:latest:chess-human:v1' : 'ai-board-games:latest:chess:v1'
      localStorage.setItem(storageKey, JSON.stringify(createChessArchive({ state: next, players })))
    } catch {
      // Storage is an optional convenience; it never blocks a running match.
    }
  }, [arena, human])

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
      if (human && isCurrentPlayer(controller.getSnapshot(), humanColorRef.current)) {
        runningRef.current = false
        setRunState('paused')
        setNotice('轮到你行棋；点击棋盘上的棋子和目标格完成一步。')
        return
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
        if (human && isCurrentPlayer(controller.getSnapshot(), humanColorRef.current)) {
          runningRef.current = false
          setRunState('paused')
          setNotice('轮到你行棋；点击棋盘上的棋子和目标格完成一步。')
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
        if (human && isCurrentPlayer(turn.snapshot, humanColorRef.current)) {
          runningRef.current = false
          setRunState('paused')
          setNotice('轮到你行棋；点击棋盘上的棋子和目标格完成一步。')
          break
        }
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
  }, [createController, disposeController, human, runState, saveArchive, updateSnapshot])

  const start = useCallback(() => {
    if (stateRef.current.result || loopInFlightRef.current) return
    void playLoop(false)
  }, [playLoop])
  const step = useCallback(() => {
    if (stateRef.current.result || loopInFlightRef.current) return
    void playLoop(true)
  }, [playLoop])
  const playHumanMove = useCallback(async (action: import('./types').ChessMoveAction) => {
    if (!human || stateRef.current.result || loopInFlightRef.current) return
    const generation = generationRef.current
    let controller = controllerRef.current
    try {
      if (!controller || runState === 'error') {
        if (controller) await disposeController()
        controller = await createController(stateRef.current)
      }
      const snapshot = controller.getSnapshot()
      if (snapshot.status.phase !== 'playing' || snapshot.status.currentPlayer !== humanColorRef.current) return
      const previousHistoryLength = stateRef.current.history.length
      const next = controller.play(action)
      if (generation !== generationRef.current) return
      updateSnapshot(controller)
      if (next.state.history.length > previousHistoryLength) {
        playChessMoveSound(next.state.lastMove?.check ? 'check' : next.state.lastMove?.captured ? 'capture' : 'move')
      }
      saveArchive(next.state)
      if (next.status.phase === 'finished') {
        setRunState('finished')
        return
      }
      setNotice('你的着法已记录，AI 正在思考。')
      void playLoop(false)
    } catch (caught) {
      if (generation !== generationRef.current) return
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      setRunState('paused')
      setNotice(`这一步没有执行：${message}`)
    }
  }, [createController, disposeController, human, playLoop, runState, saveArchive, updateSnapshot])
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
    setArchivePlayers([])
    setRunState('ready')
    setNotice(`新局已就绪：${next.openingName}；不会自动开赛。`)
  }, [disposeController])
  const restore = useCallback(async () => {
    try {
      const storageKey = arena ? 'ai-board-games:latest:chess-arena:v1' : human ? 'ai-board-games:latest:chess-human:v1' : 'ai-board-games:latest:chess:v1'
      const raw = localStorage.getItem(storageKey)
      if (!raw) throw new Error('没有可恢复的国际象棋棋局。')
      const restored = restoreChessArchive(JSON.parse(raw))
      generationRef.current += 1
      await disposeController()
      setSeed(restored.seed)
      setState(restored)
      setAnalyses({})
      setLiveInfo({})
      setError(null)
      if (arena || human) {
        const parsed = JSON.parse(raw) as { players?: readonly MatchArchivePlayer[] }
        setArchivePlayers(parsed.players ?? [])
        if (arena) setArenaEngines((current) => ({
          w: archivedArenaEngine(parsed.players, 'w') ?? current.w,
          b: archivedArenaEngine(parsed.players, 'b') ?? current.b,
        }))
        if (human) {
          const humanSeat = parsed.players?.find((player) => player.kind === 'human')?.seat
          if (humanSeat === 'w' || humanSeat === 'b') setHumanColor(humanSeat)
          const ai = parsed.players?.find((player) => player.kind === 'ai')
          const id = archivedArenaEngine(ai ? [ai] : undefined, ai?.seat as ChessColor)
          if (id) setHumanEngine(id)
        }
      }
      setRunState(restored.result ? 'finished' : 'paused')
      setNotice(`已恢复 ${restored.history.length} 个半回合；逐手验证通过，点击继续观战。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [arena, disposeController, human])
  const changeBudget = useCallback((id: ChessSearchBudgetId) => {
    if (runState === 'thinking' || runState === 'running') return
    setBudgetId(id)
    if (controllerRef.current) {
      void disposeController().then(() => setRunState('ready'))
    }
    setNotice(`已选择${activeProfile(arena || human, id).label}；下一次建立引擎会话时生效。`)
  }, [arena, disposeController, human, runState])

  const changeArenaEngine = useCallback((color: ChessColor, engineId: ChessArenaEngineId) => {
    if (!arena || runState === 'thinking' || runState === 'running' || controllerRef.current) return
    setArenaEngines((current) => ({ ...current, [color]: engineId }))
    setNotice(`已为${color === 'w' ? '白' : '黑'}方选择 ${arenaEngineLabel(engineId)}；开赛后配置锁定。`)
  }, [arena, runState])
  const changeHumanColor = useCallback((color: ChessColor) => {
    if (!human || runState === 'thinking' || runState === 'running' || controllerRef.current || stateRef.current.history.length > 0) return
    setHumanColor(color)
    setNotice(`已选择${color === 'w' ? '白' : '黑'}方；开赛后执子方锁定。`)
  }, [human, runState])
  const changeHumanEngine = useCallback((engineId: ChessArenaEngineId) => {
    if (!human || runState === 'thinking' || runState === 'running' || controllerRef.current || stateRef.current.history.length > 0) return
    setHumanEngine(engineId)
    setNotice(`已选择 ${arenaEngineLabel(engineId)} 作为对手；开赛后引擎锁定。`)
  }, [human, runState])

  useEffect(() => () => { void disposeController() }, [disposeController])

  useEffect(() => {
    window.__AI_CHESS_BROWSER_VALIDATION__ = {
      status: error ? 'failed' : state.history.length >= 20 ? 'passed' : 'running',
      halfMoves: state.history.length,
      model: activeProfile(arena || human, budgetId).mode === 'professional' ? 'PV1 neutral engine arena' : 'nn-3475407dc199.nnue',
      paused: runState === 'paused',
      error,
    }
  }, [arena, budgetId, error, human, runState, state.history.length])

  return {
    state,
    seed,
    budgetId,
    profile: activeProfile(arena || human, budgetId),
    arena,
    human,
    arenaEngines,
    humanColor,
    humanEngine,
    archivePlayers,
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
    changeArenaEngine,
    changeHumanColor,
    changeHumanEngine,
    playHumanMove,
  }
}

function profileForPlayer(
  players: readonly import('../core').GamePlayer<ChessGameState, ChessAction, ChessColor, import('./types').ChessMoveRecord, ChessTurnAnalysis>[],
  color: ChessColor,
): EngineProfile | null {
  const player = players.find((candidate) => candidate.id === color)
  return player?.kind === 'ai' ? (player.engine as ChessAIEngineAdapter).engineProfile : null
}

function isCurrentPlayer(snapshot: { status: import('../core').GameStatus<ChessColor> }, color: ChessColor): boolean {
  return snapshot.status.phase === 'playing' && snapshot.status.currentPlayer === color
}

function deviceResources(profile: ChessSearchProfile, mobile: boolean, multithreadSupported: boolean): SeatResources {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (profile.mode === 'professional') {
    const cores = navigator.hardwareConcurrency || 2
    if (profile.id === 'fast') return { threads: 1, hash: 64 }
    if (!multithreadSupported || mobile || memory === undefined || memory < 8 || cores < 4) {
      return { threads: 1, hash: 64 }
    }
    return { threads: Math.min(4, Math.max(2, cores - 2)), hash: profile.id === 'professional-deep' ? 256 : 128 }
  }
  return mobile || memory === undefined || memory < 4
    ? { threads: 1, hash: 32 }
    : { threads: 2, hash: 64 }
}

function chessEngineId(profile: ChessSearchProfile, resources: SeatResources): string {
  if (profile.mode === 'personality') return CHESS_FAIRY_STOCKFISH_ENGINE_ID
  if (import.meta.env.VITE_CHESS_NATIVE_BRIDGE === '1') return CHESS_STOCKFISH_18_NATIVE_ENGINE_ID
  return resources.threads > 1 ? CHESS_STOCKFISH_18_ENGINE_ID : CHESS_STOCKFISH_18_SINGLE_ENGINE_ID
}

function activeProfile(arena: boolean, budgetId: ChessSearchBudgetId): ChessSearchProfile {
  return arena ? CHESS_ARENA_PROFILES[budgetId as ChessArenaBudgetId] ?? CHESS_ARENA_PROFILES.standard : CHESS_SEARCH_PROFILES[budgetId]
}

function chessArenaEngineConfigId(id: ChessArenaEngineId): string {
  if (id === 'fairy-stockfish-chess') return CHESS_FAIRY_STOCKFISH_ENGINE_ID
  if (id === 'obsidian-16') return CHESS_OBSIDIAN_16_ENGINE_ID
  return CHESS_STOCKFISH_18_ARENA_ENGINE_ID
}

export function arenaEngineLabel(id: ChessArenaEngineId): string {
  if (id === 'fairy-stockfish-chess') return 'Fairy-Stockfish Chess NNUE'
  if (id === 'obsidian-16') return 'Obsidian 16.0'
  return 'Stockfish 18'
}

function isFinishedControllerError(value: unknown): boolean {
  return value instanceof Error && value.message === '棋局已经结束。'
}

function arenaRuntimeSnapshot(engineId: ChessArenaEngineId, profile: EngineProfile, movetimeMs: number): import('../core').EngineRuntimeSnapshot {
  return {
    descriptor: {
      id: engineId, gameId: 'chess', name: arenaEngineLabel(engineId), version: profile.version,
      model: profile.network ?? 'embedded NNUE', modelSha256: profile.networkSha256,
      protocol: 'UCI', runtime: engineId === 'fairy-stockfish-chess' ? 'browser-worker' : profile.name.includes('Native') ? 'native-bridge' : 'browser-wasm',
      capabilities: { winRate: Boolean(profile.network), scoreLead: true, multiCandidate: false, streaming: true, cancellation: true, budgetUnits: ['milliseconds'] },
    },
    phase: 'ready', backendLabel: profile.name, threads: profile.threads, hashMb: profile.hashMb,
    budget: { unit: 'milliseconds', requested: movetimeMs },
  }
}

function archivedArenaEngine(players: readonly MatchArchivePlayer[] | undefined, color: ChessColor): ChessArenaEngineId | null {
  const id = players?.find((player) => player.seat === color)?.engine?.descriptor.id
  return id === 'fairy-stockfish-chess' || id === 'stockfish-18' || id === 'obsidian-16' ? id : null
}
