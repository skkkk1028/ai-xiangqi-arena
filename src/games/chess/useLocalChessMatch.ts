import { useCallback, useEffect, useRef, useState } from 'react'
import { playChessMoveSound } from './audio'
import { createChessState, ChessGameEngine } from './rules'
import type { ChessColor, ChessGameState, ChessMoveAction } from './types'

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
  const stateRef = useRef(state)
  const clockRef = useRef(clock)
  const resultRef = useRef(clockResult)
  const runStateRef = useRef(runState)
  const controlRef = useRef(CHESS_LOCAL_TIME_CONTROLS.standard)
  const anchorRef = useRef<number | null>(null)

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
  }, [publishRunState])

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
  }, [publishRunState])

  const pause = useCallback(() => {
    if (runStateRef.current !== 'running') return
    if (!settle()) return
    anchorRef.current = null
    publishRunState('paused')
    setNotice('对局已暂停；双方总时与当前单步时钟均已冻结。')
  }, [publishRunState, settle])

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
      return
    }
    publishClock({ ...clockRef.current, moveRemainingMs: controlRef.current.moveMs })
    anchorRef.current = now
    setNotice(`已记录 ${next.lastMove?.san ?? next.lastMove?.uci}，轮到${next.turn === 'w' ? '白' : '黑'}方。`)
  }, [publishClock, publishRunState, publishState, settle])

  const changeTimeControl = useCallback((id: ChessLocalTimeControlId) => {
    if (runStateRef.current !== 'ready') return
    const control = CHESS_LOCAL_TIME_CONTROLS[id]
    controlRef.current = control
    setTimeControlId(id)
    publishClock(createChessLocalClock(control))
    setNotice(`已选择${control.label}；点击“开始对局”后白方计时。`)
  }, [publishClock])

  const newGame = useCallback(() => {
    anchorRef.current = null
    resultRef.current = null
    setClockResult(null)
    publishState(createLocalState())
    publishClock(createChessLocalClock(controlRef.current))
    publishRunState('ready')
    setNotice('新局已就绪；可重新选择计时档位，白方先行。')
  }, [publishClock, publishRunState, publishState])

  useEffect(() => {
    const interval = window.setInterval(() => { settle() }, 100)
    const syncVisibility = () => { if (document.visibilityState === 'visible') settle() }
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [settle])

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
  }
}

function createLocalState(): ChessGameState {
  return { ...createChessState(0), openingId: 'local-standard', openingName: '标准初始局面' }
}
