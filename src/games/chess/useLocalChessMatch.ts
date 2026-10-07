import { useCallback, useEffect, useRef, useState } from 'react'
import { playChessMoveSound } from './audio'
import { createChessState, ChessGameEngine } from './rules'
import type { ChessColor, ChessGameState, ChessMoveAction } from './types'
import { createChessArchive, restoreChessArchive } from './archive'
import { chessLibrary, newChessId } from './library'
import { readChessLiveReturn, writeChessLiveReturn } from './live-return'

export type ChessLocalTimeControlId = 'rapid' | 'standard' | 'deep'

export interface ChessLocalTimeControl {
  id: ChessLocalTimeControlId
  label: string
  totalMs: number
  moveMs: number
}

export interface ChessLocalClockResult {
  reason: 'total-timeout' | 'move-timeout'
  winner: ChessColor
  loser: ChessColor
}

export interface ChessLocalClock {
  totals: Record<ChessColor, number>
  moveRemainingMs: number
}

export type ChessLocalRunState = 'ready' | 'running' | 'paused' | 'finished'

export const CHESS_LOCAL_TIME_CONTROLS: Record<ChessLocalTimeControlId, ChessLocalTimeControl> = {
  rapid: { id: 'rapid', label: '快棋 · 5 分钟 / 30 秒每步', totalMs: 5 * 60_000, moveMs: 30_000 },
  standard: { id: 'standard', label: '标准 · 15 分钟 / 60 秒每步', totalMs: 15 * 60_000, moveMs: 60_000 },
  deep: { id: 'deep', label: '深思 · 30 分钟 / 120 秒每步', totalMs: 30 * 60_000, moveMs: 120_000 },
}

export function createChessLocalClock(control: ChessLocalTimeControl): ChessLocalClock {
  return { totals: { w: control.totalMs, b: control.totalMs }, moveRemainingMs: control.moveMs }
}

export function advanceChessLocalClock(
  clock: ChessLocalClock,
  color: ChessColor,
  elapsedMs: number,
): { clock: ChessLocalClock; result: ChessLocalClockResult | null } {
  const elapsed = Math.max(0, elapsedMs)
  const totalBefore = clock.totals[color]
  const moveBefore = clock.moveRemainingMs
  const next: ChessLocalClock = {
    totals: { ...clock.totals, [color]: Math.max(0, totalBefore - elapsed) },
    moveRemainingMs: Math.max(0, moveBefore - elapsed),
  }
  if (elapsed < totalBefore && elapsed < moveBefore) return { clock: next, result: null }
  const reason = totalBefore <= moveBefore ? 'total-timeout' : 'move-timeout'
  return {
    clock: next,
    result: { reason, loser: color, winner: color === 'w' ? 'b' : 'w' },
  }
}

export function useLocalChessMatch() {
  const engineRef = useRef(new ChessGameEngine())
  const [timeControlId, setTimeControlId] = useState<ChessLocalTimeControlId>('standard')
  const [state, setState] = useState<ChessGameState>(() => createLocalState())
  const [clock, setClock] = useState<ChessLocalClock>(() => createChessLocalClock(CHESS_LOCAL_TIME_CONTROLS.standard))
  const [clockResult, setClockResult] = useState<ChessLocalClockResult | null>(null)
  const [runState, setRunState] = useState<ChessLocalRunState>('ready')
  const [notice, setNotice] = useState('选择计时档位后开始对局；白方先行。')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const libraryIdRef = useRef<string>(newChessId())
  const createdAtRef = useRef(new Date().toISOString())
  const saveSequenceRef = useRef(0)
  const stateRef = useRef(state)
  const clockRef = useRef(clock)
  const resultRef = useRef(clockResult)
  const runStateRef = useRef(runState)
  const controlRef = useRef(CHESS_LOCAL_TIME_CONTROLS.standard)
  const anchorRef = useRef<number | null>(null)
  const controlIdRef = useRef(timeControlId)

  const saveSnapshot = useCallback(() => {
    const id = libraryIdRef.current
    const sequence = ++saveSequenceRef.current
    const archive = createChessArchive({ state: stateRef.current, createdAt: createdAtRef.current, players: [
      { seat: 'w', kind: 'human', name: '白方玩家' }, { seat: 'b', kind: 'human', name: '黑方玩家' },
    ] })
    setSaveStatus('saving')
    return chessLibrary.save({
      id, title: `双人对战 · ${new Date(archive.createdAt).toLocaleString()}`, favorite: false,
      mode: 'local', archive, configuration: { timeControl: controlIdRef.current },
      clock: { controlId: controlIdRef.current, totals: { ...clockRef.current.totals }, moveRemainingMs: clockRef.current.moveRemainingMs, runState: runStateRef.current, result: resultRef.current },
    }).then(() => { if (libraryIdRef.current === id && saveSequenceRef.current === sequence) setSaveStatus('saved'); return true }, () => { if (libraryIdRef.current === id && saveSequenceRef.current === sequence) setSaveStatus('failed'); return false })
  }, [])

  const publishState = useCallback((next: ChessGameState) => {
    stateRef.current = next
    setState(next)
  }, [])
  const publishClock = useCallback((next: ChessLocalClock) => {
    clockRef.current = next
    setClock(next)
  }, [])
  const publishRunState = useCallback((next: ChessLocalRunState) => {
    runStateRef.current = next
    setRunState(next)
  }, [])

  const finishOnTime = useCallback((result: ChessLocalClockResult) => {
    resultRef.current = result
    setClockResult(result)
    anchorRef.current = null
    publishRunState('finished')
    setNotice(`${result.loser === 'w' ? '白' : '黑'}方${result.reason === 'total-timeout' ? '总用时' : '单步用时'}耗尽，${result.winner === 'w' ? '白' : '黑'}方获胜。`)
    saveSnapshot()
  }, [publishRunState, saveSnapshot])

  const settle = useCallback((now = performance.now()): boolean => {
    const anchor = anchorRef.current
    if (runStateRef.current !== 'running' || anchor === null || resultRef.current || stateRef.current.result) return true
    const advanced = advanceChessLocalClock(clockRef.current, stateRef.current.turn, now - anchor)
    anchorRef.current = now
    publishClock(advanced.clock)
    if (advanced.result) {
      finishOnTime(advanced.result)
      return false
    }
    return true
  }, [finishOnTime, publishClock])

  const start = useCallback(() => {
    if (runStateRef.current === 'finished' || stateRef.current.result || resultRef.current) return
    const previous = runStateRef.current
    anchorRef.current = performance.now()
    publishRunState('running')
    setNotice(previous === 'paused' ? '对局已继续，当前方时钟恢复计时。' : '对局开始，白方先行。')
    saveSnapshot()
  }, [publishRunState, saveSnapshot])

  const pause = useCallback(() => {
    if (runStateRef.current !== 'running') return
    if (!settle()) return
    anchorRef.current = null
    publishRunState('paused')
    setNotice('对局已暂停；双方总时与当前单步时钟均已冻结。')
    saveSnapshot()
  }, [publishRunState, saveSnapshot, settle])

  const playMove = useCallback((action: ChessMoveAction) => {
    if (runStateRef.current !== 'running' || resultRef.current || stateRef.current.result) return
    const now = performance.now()
    if (!settle(now)) return
    const legal = engineRef.current.getLegalActions(stateRef.current)
      .find((candidate) => candidate.kind !== 'claim-draw' && engineRef.current.actionsEqual(candidate, action))
    if (!legal) {
      setNotice('该着法不合法，棋局与时钟继续运行。')
      return
    }
    const next = engineRef.current.executeAction(stateRef.current, legal)
    publishState(next)
    playChessMoveSound(next.lastMove?.check ? 'check' : next.lastMove?.captured ? 'capture' : 'move')
    if (next.result) {
      anchorRef.current = null
      publishRunState('finished')
      setNotice('棋盘终局已成立，对局和双方时钟均已停止。')
      saveSnapshot()
      return
    }
    publishClock({ ...clockRef.current, moveRemainingMs: controlRef.current.moveMs })
    anchorRef.current = now
    setNotice(`已记录 ${next.lastMove?.san ?? next.lastMove?.uci}，轮到${next.turn === 'w' ? '白' : '黑'}方。`)
    saveSnapshot()
  }, [publishClock, publishRunState, publishState, saveSnapshot, settle])

  const changeTimeControl = useCallback((id: ChessLocalTimeControlId) => {
    if (runStateRef.current !== 'ready') return
    const control = CHESS_LOCAL_TIME_CONTROLS[id]
    controlRef.current = control
    controlIdRef.current = id
    setTimeControlId(id)
    publishClock(createChessLocalClock(control))
    setNotice(`已选择${control.label}；点击“开始对局”后白方计时。`)
  }, [publishClock])

  const newGame = useCallback(() => {
    if (runStateRef.current === 'running') settle()
    if (runStateRef.current !== 'ready') void saveSnapshot()
    libraryIdRef.current = newChessId()
    saveSequenceRef.current += 1
    createdAtRef.current = new Date().toISOString()
    setSaveStatus('idle')
    anchorRef.current = null
    resultRef.current = null
    setClockResult(null)
    publishState(createLocalState())
    publishClock(createChessLocalClock(controlRef.current))
    publishRunState('ready')
    setNotice('新局已就绪；可重新选择计时档位，白方先行。')
  }, [publishClock, publishRunState, publishState, saveSnapshot, settle])

  const restoreSaved = useCallback(async (id: string, signal: AbortSignal): Promise<boolean> => {
    try {
      const saved = await chessLibrary.get(id)
      if (signal.aborted) return false
      if (!saved || saved.mode !== 'local' || !saved.clock) throw new Error('找不到可恢复的双人对局与时钟。')
      const restored = restoreChessArchive(saved.archive)
      const control = CHESS_LOCAL_TIME_CONTROLS[saved.clock.controlId]
      if (!control) throw new Error('保存的计时档位无效。')
      const nextClock = { totals: { ...saved.clock.totals }, moveRemainingMs: saved.clock.moveRemainingMs }
      libraryIdRef.current = saved.id
      createdAtRef.current = saved.archive.createdAt
      saveSequenceRef.current += 1
      controlRef.current = control
      controlIdRef.current = control.id
      setTimeControlId(control.id)
      anchorRef.current = null
      resultRef.current = saved.clock.result
      setClockResult(saved.clock.result)
      publishState(restored)
      publishClock(nextClock)
      publishRunState(restored.result || saved.clock.result ? 'finished' : 'paused')
      setSaveStatus('saved')
      setNotice(`已恢复 ${restored.history.length} 个半回合，时钟保持暂停；点击“继续对局”后恢复计时。`)
      return true
    } catch (reason) {
      if (!signal.aborted) setNotice(`恢复双人对局失败：${reason instanceof Error ? reason.message : String(reason)}`)
      return false
    }
  }, [publishClock, publishRunState, publishState])

  useEffect(() => {
    const interval = window.setInterval(() => { settle() }, 100)
    const autosave = window.setInterval(() => { if (runStateRef.current === 'running') void saveSnapshot() }, 5_000)
    const syncVisibility = () => { settle(); if (document.visibilityState === 'hidden' && runStateRef.current === 'running') void saveSnapshot() }
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      window.clearInterval(interval)
      window.clearInterval(autosave)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [saveSnapshot, settle])
  useEffect(() => { void chessLibrary.migrateLatest().catch(() => setSaveStatus('failed')) }, [])
  useEffect(() => {
    const marker = readChessLiveReturn()
    if (!marker || marker.phase !== 'resume' || marker.mode !== 'local') return
    const controller = new AbortController()
    void restoreSaved(marker.id, controller.signal).then((success) => {
      if (success && !controller.signal.aborted) writeChessLiveReturn(null)
    })
    return () => controller.abort()
  }, [restoreSaved])

  return {
    state,
    clock,
    clockResult,
    runState,
    notice,
    timeControlId,
    timeControl: CHESS_LOCAL_TIME_CONTROLS[timeControlId],
    start,
    pause,
    playMove,
    newGame,
    changeTimeControl,
    saveStatus,
    libraryId: libraryIdRef.current,
    saveNow: saveSnapshot,
  }
}

function createLocalState(): ChessGameState {
  return { ...createChessState(0), openingId: 'local-standard', openingName: '标准初始局面' }
}
