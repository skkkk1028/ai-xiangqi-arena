import { useCallback, useEffect, useRef, useState } from 'react'
import type { KataGoTransport } from './ai'
import type { GoGameState } from './types'
import { GoWinRateAnalyzer, type GoWinRatePoint } from './win-rate-analysis'

export type GoWinRateAnalysisStatus = 'idle' | 'loading' | 'analyzing' | 'ready' | 'error'

interface UseGoWinRateAnalysisOptions {
  createTransport: () => Promise<KataGoTransport>
}

const MAX_POSTGAME_POSITIONS = 400

/** Explicit, bounded analysis queue. It never starts merely because a move was played. */
export function useGoWinRateAnalysis({ createTransport }: UseGoWinRateAnalysisOptions) {
  const [history, setHistory] = useState<GoWinRatePoint[]>([])
  const [status, setStatus] = useState<GoWinRateAnalysisStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const analyzerRef = useRef<GoWinRateAnalyzer | null>(null)
  const ownedTransportRef = useRef<KataGoTransport | null>(null)
  const queueRef = useRef<GoGameState[]>([])
  const queuedMoveNumbersRef = useRef(new Set<number>())
  const processingRef = useRef(false)
  const activeAbortRef = useRef<AbortController | null>(null)
  const ownedCreationAllowedRef = useRef(true)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const initializationRef = useRef<Promise<GoWinRateAnalyzer> | null>(null)
  const initializationAbortRef = useRef<AbortController | null>(null)

  const publishStatus = useCallback((next: GoWinRateAnalysisStatus) => {
    if (mountedRef.current) setStatus(next)
  }, [])

  const ensureAnalyzer = useCallback(async () => {
    if (analyzerRef.current) return analyzerRef.current
    if (initializationRef.current) return initializationRef.current
    if (!ownedCreationAllowedRef.current) throw new DOMException('等待共享 KataGo 分析实例。', 'AbortError')
    publishStatus('loading')
    const controller = new AbortController()
    initializationAbortRef.current = controller
    const operation = (async () => {
      const transport = await createTransport()
      try {
        controller.signal.throwIfAborted()
        await transport.initialize(controller.signal)
        if (!mountedRef.current || controller.signal.aborted) throw new DOMException('胜率分析已释放。', 'AbortError')
        ownedTransportRef.current = transport
        const analyzer = new GoWinRateAnalyzer(transport)
        analyzerRef.current = analyzer
        return analyzer
      } catch (error) { await transport.dispose(); throw error }
    })()
    initializationRef.current = operation
    try { return await operation } finally { if (initializationRef.current === operation) initializationRef.current = null }
  }, [createTransport, publishStatus])

  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      while (mountedRef.current && queueRef.current.length > 0) {
        const generation = generationRef.current
        const position = queueRef.current[0]
        try {
          const analyzer = await ensureAnalyzer()
          if (generation !== generationRef.current) continue
          const controller = new AbortController()
          activeAbortRef.current = controller
          publishStatus('analyzing')
          if (mountedRef.current) setError(null)
          const point = await analyzer.analyze(position, controller.signal)
          if (generation !== generationRef.current) continue
          queueRef.current.shift()
          queuedMoveNumbersRef.current.delete(point.moveNumber)
          if (mountedRef.current) {
            setHistory((current) => insertPoint(current, point))
            setStatus('ready')
          }
        } catch (analysisError) {
          if (generation !== generationRef.current) continue
          if (isCancellation(analysisError)) {
            await delay(280)
            continue
          }
          if (mountedRef.current) {
            setStatus('error')
            setError(errorMessage(analysisError))
          }
          break
        } finally {
          activeAbortRef.current = null
        }
      }
    } finally {
      processingRef.current = false
    }
  }, [ensureAnalyzer, publishStatus])

  const enqueue = useCallback((position: GoGameState) => {
    const moveNumber = position.history.length
    if (moveNumber === 0 || queuedMoveNumbersRef.current.has(moveNumber)) return
    if (history.some((point) => point.moveNumber === moveNumber)) return
    queuedMoveNumbersRef.current.add(moveNumber)
    queueRef.current.push(position)
    void processQueue()
  }, [history, processQueue])

  const enqueuePostgame = useCallback((positions: readonly GoGameState[]) => {
    const sampled = samplePositions(
      positions.filter((position) => position.history.length > 0),
      MAX_POSTGAME_POSITIONS,
    )
    for (const position of sampled) {
      const moveNumber = position.history.length
      if (queuedMoveNumbersRef.current.has(moveNumber)) continue
      queuedMoveNumbersRef.current.add(moveNumber)
      queueRef.current.push(position)
    }
    void processQueue()
  }, [processQueue])

  const attachTransport = useCallback(async (transport: KataGoTransport) => {
    activeAbortRef.current?.abort()
    ownedCreationAllowedRef.current = false
    const owned = ownedTransportRef.current
    ownedTransportRef.current = null
    analyzerRef.current = new GoWinRateAnalyzer(transport)
    if (owned && owned !== transport) await owned.dispose()
    void processQueue()
  }, [processQueue])

  const detachTransport = useCallback(async (allowOwnedCreation = true) => {
    activeAbortRef.current?.abort()
    initializationAbortRef.current?.abort()
    await initializationRef.current?.catch(() => undefined)
    ownedCreationAllowedRef.current = allowOwnedCreation
    analyzerRef.current = null
    const owned = ownedTransportRef.current
    ownedTransportRef.current = null
    if (owned) await owned.dispose()
  }, [])

  const reset = useCallback(() => {
    generationRef.current += 1
    activeAbortRef.current?.abort()
    initializationAbortRef.current?.abort()
    queueRef.current = []
    queuedMoveNumbersRef.current.clear()
    if (mountedRef.current) {
      setHistory([])
      setStatus('idle')
      setError(null)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      activeAbortRef.current?.abort()
      initializationAbortRef.current?.abort()
      queueRef.current = []
      queuedMoveNumbersRef.current.clear()
      const owned = ownedTransportRef.current
      ownedTransportRef.current = null
      analyzerRef.current = null
      if (owned) void owned.dispose()
    }
  }, [])

  return {
    history,
    status,
    error,
    enqueue,
    enqueuePostgame,
    reset,
    attachTransport,
    detachTransport,
  }
}

function samplePositions(positions: readonly GoGameState[], limit: number): readonly GoGameState[] {
  if (positions.length <= limit) return positions
  const selected = new Map<number, GoGameState>()
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index / (limit - 1)) * (positions.length - 1))
    const position = positions[sourceIndex]
    selected.set(position.history.length, position)
  }
  return [...selected.values()]
}

function insertPoint(current: GoWinRatePoint[], point: GoWinRatePoint): GoWinRatePoint[] {
  const withoutSameMove = current.filter((item) => item.moveNumber !== point.moveNumber)
  return [...withoutSameMove, point].sort((left, right) => left.moveNumber - right.moveNumber)
}

function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && (error.name === 'KataGoCanceledError' || error.message.includes('canceled'))
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'KataGo 胜率分析失败。'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
