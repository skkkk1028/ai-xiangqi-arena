import { useCallback, useEffect, useRef, useState } from 'react'
import { engineRegistry } from '../../engine/default-registry'
import { detectEngineSupport } from '../../engine/support'
import type { EngineProgress } from '../../engine/types'
import { GameController } from '../core/GameController'
import { createChessArchive, restoreChessArchive } from './archive'
import { CHESS_FAIRY_STOCKFISH_ENGINE_ID, CHESS_OBSIDIAN_16_ENGINE_ID, CHESS_STOCKFISH_18_ARENA_ENGINE_ID, CHESS_STOCKFISH_18_ENGINE_ID, CHESS_STOCKFISH_18_NATIVE_ENGINE_ID, CHESS_STOCKFISH_18_SINGLE_ENGINE_ID } from '../../engine/config'
import { ChessAIEngineAdapter, CHESS_PERSONALITIES, CHESS_SEARCH_PROFILES, chessPersonalityForColor } from './ai-engine'
import { ChessGameEngine, createChessState, isChessMoveAction } from './rules'
import { alternateChessSeed, createChessSeed } from './openings'
import type { ChessAction, ChessArenaBudgetId, ChessArenaEngineId, ChessColor, ChessGameState, ChessLiveAnalysis, ChessPersonalityId, ChessSearchBudgetId, ChessSearchProfile, ChessTurnAnalysis } from './types'
import type { EngineProfile } from '../../game/types'
import type { EngineAdapter } from '../../engine/adapter'
import type { MatchArchivePlayer } from '../core'
import { playChessMoveSound } from './audio'
import { ChessArenaNativeAdapter } from './arena-native-adapter'
import { chessLibrary, newChessId } from './library'
import { readChessLiveReturn, writeChessLiveReturn } from './live-return'
import { chessGuessFromStudy, chessGuessPrefix, emptyChessGuessStats, keepChessGuessForStudy, nextChessGuessStats, type ChessGuessState } from './guess'
import type { ChessMoveAction } from './types'

const guessRules = new ChessGameEngine()

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const libraryIdRef = useRef<string>(newChessId())
  const createdAtRef = useRef(new Date().toISOString())
  const saveSequenceRef = useRef(0)
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

  const mountedRef = useRef(true)
  const [guess, setGuessValue] = useState<ChessGuessState>({ phase: 'off', round: null, stats: emptyChessGuessStats() })
  const guessRef = useRef(guess)
  const guessIdRef = useRef(0)
  const [guessBusy, setGuessBusy] = useState(false)
  const studyPauseRef = useRef<Promise<ChessGameState> | null>(null)
  const pausePendingRef = useRef(false)
  const publishGuess = useCallback((next: ChessGuessState) => {
    guessRef.current = next
    if (mountedRef.current) setGuessValue(next)
  }, [])
  const closeGuess = useCallback((resetStats = false) => {
    publishGuess({ phase: 'off', round: null, stats: resetStats ? emptyChessGuessStats() : guessRef.current.stats })
  }, [publishGuess])
  const voidGuess = useCallback((reason = 'AI 未完成落子，本题作废，不计入成绩。') => {
    if (guessRef.current.phase === 'off') return
    publishGuess({ ...guessRef.current, phase: 'void', round: null, reason })
    setLiveInfo({})
    setAnalyses({})
  }, [publishGuess])
  const prepareGuess = useCallback(() => {
    if (arena || human || stateRef.current.result) return
    runningRef.current = false
    const before = stateRef.current
    publishGuess({ phase: 'choosing', stats: guessRef.current.stats, round: {
      id: ++guessIdRef.current, generation: generationRef.current, before,
      prefix: chessGuessPrefix(before), selected: null, skipped: false,
    } })
    setLiveInfo({})
    setAnalyses({})
    setRunState('paused')
    setNotice('请选择下一手，提交后 AI 才会行棋。')
  }, [arena, human, publishGuess])
  const toggleGuess = useCallback((enabled: boolean) => {
    if (arena || human || guessRef.current.phase === 'searching' || runState === 'loading') return
    if (!enabled) {
      closeGuess()
      runningRef.current = false
      abortRef.current?.abort()
      if (!stateRef.current.result) setRunState('paused')
      return
    }
    if (stateRef.current.result || recoveringSeatsRef.current.size || pausePendingRef.current) return
    if (loopInFlightRef.current) publishGuess({ ...guessRef.current, phase: 'armed', round: null })
    else prepareGuess()
  }, [arena, closeGuess, human, prepareGuess, publishGuess, runState])
  const selectGuess = useCallback((move: ChessMoveAction) => {
    const current = guessRef.current
    if (current.phase !== 'choosing' || !current.round) return
    const selected = guessRules.getLegalActions(current.round.before).filter(isChessMoveAction).find((action) => guessRules.actionsEqual(action, move))
    if (selected) publishGuess({ ...current, round: { ...current.round, selected } })
  }, [publishGuess])
  const nextGuess = useCallback(() => {
    if (loopInFlightRef.current || pausePendingRef.current || recoveringSeatsRef.current.size) return
    if (guessRef.current.phase === 'revealed' || guessRef.current.phase === 'void') prepareGuess()
  }, [prepareGuess])

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
    const generation = generationRef.current
    const engineId = arenaEngineId ? chessArenaEngineConfigId(arenaEngineId) : chessEngineId(profile, resources)
    const adapter = engineRegistry.createEngine('chess', engineId, {
      assetBase: new URL('./', window.location.origin).href,
      onProgress: (progress) => {
        if (!mountedRef.current || generation !== generationRef.current) return
        setSeats((current) => ({ ...current, [color]: current[color] ? { ...current[color]!, progress } : current[color] }))
      },
      onRuntimeFatal: (runtimeError) => {
        if (!mountedRef.current || generation !== generationRef.current || stateRef.current.result) return
        void recoverSeatRef.current(color, runtimeError)
      },
    }, resources)
    const runtime: SeatRuntime = { color, personality, adapter, profile: null, progress: null, error: null, arenaEngineId }
    const engine = new ChessAIEngineAdapter(adapter, {
      personality,
      profile,
      onInfo: (analysisColor, rootFen, ply, info) => {
        if (!mountedRef.current || generation !== generationRef.current || abortRef.current?.signal.aborted) return
        setLiveInfo((current) => ({ ...current, [analysisColor]: { color: analysisColor, rootFen, ply, info } }))
      },
    })
    return { runtime, engine }
  }, [arena, human])

  const createController = useCallback(async (initial: ChessGameState, signal?: AbortSignal) => {
    const generation = generationRef.current
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
    if (!mountedRef.current || generation !== generationRef.current || controllerRef.current !== controller || signal?.aborted) {
      throw new DOMException('国际象棋会话已取消。', 'AbortError')
    }
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
    const generation = generationRef.current
    voidGuess()
    setGuessBusy(true)
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
      if (!mountedRef.current || generation !== generationRef.current) return
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
      if (!mountedRef.current || generation !== generationRef.current) { created.runtime.adapter.dispose(); return }
      const recovered = { ...created.runtime, profile: created.engine.engineProfile, error: null }
      setSeats((current) => ({ ...current, [color]: recovered }))
      setLiveInfo((current) => ({ ...current, [color]: undefined }))
      setError(null)
      setRunState('paused')
      setNotice(`${color === 'w' ? '白' : '黑'}方 Worker 已重建并重新校验 NNUE；对局仍保持暂停，请点击继续。`)
    } catch (caught) {
      replacement?.runtime.adapter.dispose()
      if (!mountedRef.current || generation !== generationRef.current) return
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
      if (mountedRef.current) setGuessBusy(loopInFlightRef.current || pausePendingRef.current || recoveringSeatsRef.current.size > 0)
    }
  }, [arena, human, makeSeat, voidGuess])
  recoverSeatRef.current = recoverSeat

  const saveArchive = useCallback((next: ChessGameState) => {
    const id = libraryIdRef.current
    const sequence = ++saveSequenceRef.current
    try {
      const controller = controllerRef.current
      const players: MatchArchivePlayer[] = controller?.getPlayers().map((player) => {
        const color = String(player.id) as ChessColor
        const seat = seatsRef.current[color]
        const engineId = seat?.arenaEngineId ?? (activeProfile(false, budgetRef.current).mode === 'professional' ? 'stockfish-18' : 'fairy-stockfish-chess')
        const search = activeProfile(arena || human, budgetRef.current)
        return { seat: color, kind: player.kind, name: player.name, ...(seat?.profile && player.kind === 'ai' ? { engine: arenaRuntimeSnapshot(engineId, seat.profile, search.movetimeMs, search.multiPv) } : {}) }
      }) ?? [
        { seat: 'w', kind: human && humanColorRef.current === 'w' ? 'human' as const : 'ai' as const, name: human && humanColorRef.current === 'w' ? '真人 · 白方' : CHESS_PERSONALITIES[chessPersonalityForColor(next.seed, 'w')].label },
        { seat: 'b', kind: human && humanColorRef.current === 'b' ? 'human' as const : 'ai' as const, name: human && humanColorRef.current === 'b' ? '真人 · 黑方' : CHESS_PERSONALITIES[chessPersonalityForColor(next.seed, 'b')].label },
      ]
      setArchivePlayers(players)
      const storageKey = arena ? 'ai-board-games:latest:chess-arena:v1' : human ? 'ai-board-games:latest:chess-human:v1' : 'ai-board-games:latest:chess:v1'
      const archive = createChessArchive({ state: next, players, createdAt: createdAtRef.current })
      try { localStorage.setItem(storageKey, JSON.stringify(archive)) } catch { /* IndexedDB is authoritative. */ }
      setSaveStatus('saving')
      return chessLibrary.save({
        id, title: `${arena ? '竞技场' : human ? '人机对战' : '观战剧场'} · ${new Date(archive.createdAt).toLocaleString()}`,
        favorite: false, mode: arena ? 'arena' : human ? 'human' : 'theatre', archive,
        configuration: {
          budget: budgetRef.current,
          whiteEngine: arenaEnginesRef.current.w,
          blackEngine: arenaEnginesRef.current.b,
          humanColor: humanColorRef.current,
          humanEngine: humanEngineRef.current,
        },
      }).then(() => { if (libraryIdRef.current === id && saveSequenceRef.current === sequence) setSaveStatus('saved'); return true }, () => { if (libraryIdRef.current === id && saveSequenceRef.current === sequence) setSaveStatus('failed'); return false })
    } catch {
      setSaveStatus('failed')
      return Promise.resolve(false)
    }
  }, [arena, human])

  const playLoop = useCallback(async (single: boolean) => {
    if (loopInFlightRef.current || pausePendingRef.current || recoveringSeatsRef.current.size) return
    if (stateRef.current.result) {
      runningRef.current = false
      setRunState('finished')
      setNotice('对局已经结束；请选择“新局”开始另一盘棋。')
      return
    }
    loopInFlightRef.current = true
    setGuessBusy(true)
    const abort = new AbortController()
    abortRef.current = abort
    const generation = generationRef.current
    let controller = controllerRef.current
    try {
      if (!controller || runState === 'error') {
        if (controller) {
          abortRef.current = null
          const disposal = disposeController()
          abortRef.current = abort
          await disposal
        }
        controller = await createController(stateRef.current, abort.signal)
      }
      if (!mountedRef.current || generation !== generationRef.current || abort.signal.aborted) return
      if (human && isCurrentPlayer(controller.getSnapshot(), humanColorRef.current)) {
        runningRef.current = false
        setRunState('paused')
        setNotice('轮到你行棋；点击棋盘上的棋子和目标格完成一步。')
        return
      }
      runningRef.current = !single
      if (!single) setRunState('running')
      // disposeController may have cleared the ref while replacing a failed session.
      abortRef.current = abort
      do {
        if (abort.signal.aborted) break
        if (guessRef.current.phase === 'armed') { prepareGuess(); break }
        if (['choosing', 'revealed', 'void'].includes(guessRef.current.phase)) break
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
        const prediction = guessRef.current
        const prefix = chessGuessPrefix(stateRef.current)
        const previousHistoryLength = stateRef.current.history.length
        const turn = await controller.playAITurn(abort.signal)
        if (!mountedRef.current || abort.signal.aborted || generation !== generationRef.current) return
        updateSnapshot(controller)
        if (turn.snapshot.state.history.length > previousHistoryLength) {
          playChessMoveSound(turn.snapshot.state.lastMove?.check ? 'check' : turn.snapshot.state.lastMove?.captured ? 'capture' : 'move')
        }
        setAnalyses((current) => ({ ...current, [movingColor]: turn.decision.analysis }))
        saveArchive(turn.snapshot.state)
        if (prediction.phase === 'searching' && prediction.round
          && guessRef.current.phase === 'searching' && guessRef.current.round?.id === prediction.round.id
          && prediction.round.generation === generation && prediction.round.prefix === prefix) {
          const actual = turn.snapshot.state.history.length === previousHistoryLength + 1 ? turn.snapshot.state.lastMove : null
          if (actual) publishGuess({ ...prediction, phase: 'revealed',
            round: { ...prediction.round, actual, analysis: turn.decision.analysis },
            stats: nextChessGuessStats(prediction.stats, prediction.round.skipped ? null : prediction.round.selected, actual) })
          else voidGuess(turn.snapshot.state.result?.termination === 'claim' ? 'AI 申请和棋，本题作废，不计入成绩。' : undefined)
          runningRef.current = false
          if (!turn.snapshot.state.result) setRunState('paused')
          break
        }
        if (['armed'].includes(guessRef.current.phase)) {
          if (turn.snapshot.state.result) closeGuess()
          else prepareGuess()
          break
        }
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
      if (!mountedRef.current || generation !== generationRef.current) return
      if (guessRef.current.phase === 'searching' || guessRef.current.phase === 'armed') voidGuess()
      if ((caught as Error)?.name === 'AbortError') {
        if (stateRef.current.result) setRunState('finished')
        else setRunState('paused')
      } else if (stateRef.current.result || isFinishedControllerError(caught)) {
        runningRef.current = false
        setRunState('finished')
        setNotice('对局已经结束；不会再向引擎发送搜索请求。')
      } else {
        const message = caught instanceof Error ? caught.message : String(caught)
        await recoverSeatRef.current(stateRef.current.turn, new Error(message))
      }
    } finally {
      if (abortRef.current === abort) abortRef.current = null
      loopInFlightRef.current = false
      if (mountedRef.current) setGuessBusy(pausePendingRef.current || recoveringSeatsRef.current.size > 0)
    }
  }, [closeGuess, createController, disposeController, human, prepareGuess, publishGuess, runState, saveArchive, updateSnapshot, voidGuess])

  const submitGuess = useCallback((skip = false) => {
    const current = guessRef.current
    const round = current.round
    if (arena || human || current.phase !== 'choosing' || !round || stateRef.current.result
      || loopInFlightRef.current || pausePendingRef.current || recoveringSeatsRef.current.size
      || round.generation !== generationRef.current || round.prefix !== chessGuessPrefix(stateRef.current)) return
    if (!skip && (!round.selected || !guessRules.getLegalActions(stateRef.current).filter(isChessMoveAction).some((move) => guessRules.actionsEqual(move, round.selected!)))) return
    publishGuess({ ...current, phase: 'searching', round: { ...round, selected: skip ? null : round.selected, skipped: skip } })
    void playLoop(true)
  }, [arena, human, playLoop, publishGuess])

  const start = useCallback(() => {
    if (studyPauseRef.current || pausePendingRef.current || stateRef.current.result || loopInFlightRef.current || guessRef.current.phase !== 'off') return
    void playLoop(false)
  }, [playLoop])
  const step = useCallback(() => {
    if (studyPauseRef.current || pausePendingRef.current || stateRef.current.result || loopInFlightRef.current || guessRef.current.phase !== 'off') return
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
    const generation = generationRef.current
    runningRef.current = false
    abortRef.current?.abort()
    if (guessRef.current.phase === 'searching' || guessRef.current.phase === 'armed') voidGuess()
    pausePendingRef.current = true
    setGuessBusy(true)
    try {
      await controllerRef.current?.cancelPendingTurn('用户暂停国际象棋观战。')
      if (!mountedRef.current || generation !== generationRef.current) return
      setRunState(stateRef.current.result ? 'finished' : 'paused')
      setNotice('已暂停；当前搜索已取消，没有落下半步棋。')
    } finally {
      pausePendingRef.current = false
      if (mountedRef.current) setGuessBusy(loopInFlightRef.current || recoveringSeatsRef.current.size > 0)
    }
  }, [voidGuess])
  const suspendForStudy = useCallback((): Promise<ChessGameState> => {
    if (studyPauseRef.current) return studyPauseRef.current
    runningRef.current = false
    abortRef.current?.abort()
    const generation = generationRef.current
    if (!arena && !human) keepChessGuessForStudy(libraryIdRef.current, guessRef.current.stats)
    closeGuess()
    const task = (async () => {
      if (runState === 'loading') await disposeController()
      await pause()
      // Initialization also owns the controller: wait for that operation to retire.
      while (loopInFlightRef.current || recoveringSeatsRef.current.size) {
        if (!mountedRef.current || generation !== generationRef.current) throw new DOMException('接管已失效。', 'AbortError')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (!mountedRef.current || generation !== generationRef.current) throw new DOMException('接管已失效。', 'AbortError')
      const snapshot = controllerRef.current?.getSnapshot().state ?? stateRef.current
      stateRef.current = snapshot
      setState(snapshot)
      setRunState(snapshot.result ? 'finished' : 'paused')
      return snapshot
    })()
    studyPauseRef.current = task
    void task.finally(() => { if (studyPauseRef.current === task) studyPauseRef.current = null }).catch(() => undefined)
    return task
  }, [arena, closeGuess, human, pause, disposeController, runState])
  const newGame = useCallback(async () => {
    closeGuess(true)
    generationRef.current += 1
    await disposeController()
    libraryIdRef.current = newChessId()
    saveSequenceRef.current += 1
    createdAtRef.current = new Date().toISOString()
    setSaveStatus('idle')
    const candidateSeed = (createChessSeed() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const nextSeed = alternateChessSeed(stateRef.current.seed, candidateSeed)
    setSeed(nextSeed)
    const next = createChessState(nextSeed)
    stateRef.current = next
    setState(next)
    setAnalyses({})
    setLiveInfo({})
    setError(null)
    setArchivePlayers([])
    setRunState('ready')
    setNotice(`新局已就绪：${next.openingName}；不会自动开赛。`)
  }, [closeGuess, disposeController])
  const restore = useCallback(async (savedId?: string, signal?: AbortSignal, fromStudy = false): Promise<boolean> => {
    if (!arena && !human) {
      closeGuess(true)
      runningRef.current = false
      abortRef.current?.abort()
    }
    try {
      const storageKey = arena ? 'ai-board-games:latest:chess-arena:v1' : human ? 'ai-board-games:latest:chess-human:v1' : 'ai-board-games:latest:chess:v1'
      const saved = savedId ? await chessLibrary.get(savedId) : null
      if (signal?.aborted) return false
      const raw = saved ? JSON.stringify(saved.archive) : savedId ? null : localStorage.getItem(storageKey)
      if (!raw) throw new Error('没有可恢复的国际象棋棋局。')
      const parsedArchive = JSON.parse(raw) as import('../core').MatchArchiveV1<'chess'>
      const restored = restoreChessArchive(parsedArchive)
      const mode = arena ? 'arena' : human ? 'human' : 'theatre'
      if (saved && saved.mode !== mode) throw new Error('保存棋局的对局模式不匹配。')
      const existing = saved ?? (await chessLibrary.list().catch(() => [])).find((game) => game.mode === mode && game.archive.initialPosition === parsedArchive.initialPosition && JSON.stringify(game.archive.moves) === JSON.stringify(parsedArchive.moves) && JSON.stringify(game.archive.players) === JSON.stringify(parsedArchive.players))
      if (signal?.aborted) return false
      closeGuess(true)
      generationRef.current += 1
      const generation = generationRef.current
      await disposeController()
      if (signal?.aborted || generation !== generationRef.current) return false
      libraryIdRef.current = existing?.id ?? newChessId()
      saveSequenceRef.current += 1
      createdAtRef.current = existing?.archive.createdAt ?? parsedArchive.createdAt
      const configuration = existing?.configuration
      const savedBudget = configuration?.budget
      if (savedBudget && ['fast', 'standard', 'deep', 'professional', 'professional-deep'].includes(savedBudget)) {
        budgetRef.current = savedBudget as ChessSearchBudgetId
        setBudgetId(budgetRef.current)
      }
      setSeed(restored.seed)
      stateRef.current = restored
      setState(restored)
      setAnalyses({})
      setLiveInfo({})
      setError(null)
      const parsed = parsedArchive as { players?: readonly MatchArchivePlayer[] }
      setArchivePlayers(parsed.players ?? [])
      if (arena || human) {
        if (arena) setArenaEngines((current) => ({
          w: validArenaEngine(configuration?.whiteEngine) ?? archivedArenaEngine(parsed.players, 'w') ?? current.w,
          b: validArenaEngine(configuration?.blackEngine) ?? archivedArenaEngine(parsed.players, 'b') ?? current.b,
        }))
        if (human) {
          const humanSeat = configuration?.humanColor ?? parsed.players?.find((player) => player.kind === 'human')?.seat
          if (humanSeat === 'w' || humanSeat === 'b') { humanColorRef.current = humanSeat; setHumanColor(humanSeat) }
          const ai = parsed.players?.find((player) => player.kind === 'ai')
          const id = validArenaEngine(configuration?.humanEngine) ?? archivedArenaEngine(ai ? [ai] : undefined, ai?.seat as ChessColor)
          if (id) { humanEngineRef.current = id; setHumanEngine(id) }
        }
      }
      const returnedStats = fromStudy && !arena && !human ? chessGuessFromStudy(libraryIdRef.current) : undefined
      if (returnedStats) publishGuess({ phase: 'off', round: null, stats: returnedStats })
      setRunState(restored.result ? 'finished' : 'paused')
      setNotice(`已恢复 ${restored.history.length} 个半回合；逐手验证通过，点击继续观战。`)
      setSaveStatus('saved')
      return true
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : String(caught))
      return false
    }
  }, [arena, closeGuess, disposeController, human, publishGuess])
  const changeBudget = useCallback((id: ChessSearchBudgetId) => {
    if (runState === 'thinking' || runState === 'running' || runState === 'loading' || loopInFlightRef.current || pausePendingRef.current) return
    closeGuess()
    budgetRef.current = id
    setBudgetId(id)
    if (controllerRef.current) {
      void disposeController().then(() => setRunState('ready'))
    }
    setNotice(`已选择${activeProfile(arena || human, id).label}；下一次建立引擎会话时生效。`)
  }, [arena, closeGuess, disposeController, human, runState])

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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      void disposeController()
    }
  }, [disposeController])
  useEffect(() => { void chessLibrary.migrateLatest().catch(() => setSaveStatus('failed')) }, [])
  useEffect(() => {
    const marker = readChessLiveReturn()
    const mode = arena ? 'arena' : human ? 'human' : 'theatre'
    if (!marker || marker.phase !== 'resume' || marker.mode !== mode) return
    const controller = new AbortController()
    void restore(marker.id, controller.signal, true).then((success) => {
      if (success && !controller.signal.aborted) writeChessLiveReturn(null)
    })
    return () => controller.abort()
  }, [arena, human, restore])

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
    guess, guessBusy, toggleGuess, selectGuess, submitGuess, nextGuess, suspendForStudy,
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
    saveStatus,
    libraryId: libraryIdRef.current,
    saveNow: () => saveArchive(stateRef.current),
    start,
    pause,
    step,
    newGame,
    restore: () => restore(),
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

function arenaRuntimeSnapshot(engineId: ChessArenaEngineId, profile: EngineProfile, movetimeMs: number, multiPv = 1): import('../core').EngineRuntimeSnapshot {
  return {
    descriptor: {
      id: engineId, gameId: 'chess', name: arenaEngineLabel(engineId), version: profile.version,
      model: profile.network ?? 'embedded NNUE', modelSha256: profile.networkSha256,
      protocol: 'UCI', runtime: engineId === 'fairy-stockfish-chess' ? 'browser-worker' : profile.name.includes('Native') ? 'native-bridge' : 'browser-wasm',
      capabilities: { winRate: Boolean(profile.network), scoreLead: true, multiCandidate: multiPv > 1, streaming: true, cancellation: true, budgetUnits: ['milliseconds'] },
    },
    phase: 'ready', backendLabel: profile.name, threads: profile.threads, hashMb: profile.hashMb,
    budget: { unit: 'milliseconds', requested: movetimeMs },
  }
}

function archivedArenaEngine(players: readonly MatchArchivePlayer[] | undefined, color: ChessColor): ChessArenaEngineId | null {
  const id = players?.find((player) => player.seat === color)?.engine?.descriptor.id
  return validArenaEngine(id)
}

function validArenaEngine(id: string | undefined): ChessArenaEngineId | null {
  return id === 'fairy-stockfish-chess' || id === 'stockfish-18' || id === 'obsidian-16' ? id : null
}
