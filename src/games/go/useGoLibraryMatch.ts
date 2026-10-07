import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MatchArchivePlayer } from '../core'
import { goEngineDescriptor, goAIEngineName } from './ai/go-ai'
import { createGoArchive } from './sgf'
import { goLibrary, newGoId, type GoLibraryGame } from './library'
import type { useGoMatch } from './useGoMatch'

export function useGoLibraryMatch(match: ReturnType<typeof useGoMatch>) {
  const identity = useRef({ id: newGoId(), createdAt: new Date().toISOString() })
  const previous = useRef(match.state)
  const request = useRef(0)
  const [status, setStatus] = useState('尚无棋谱')
  const [error, setError] = useState<string | null>(null)
  if (previous.current !== match.state) {
    const before = previous.current.history
    const next = match.state.history
    if (next.length < before.length || before.some((move, index) => next[index]?.notation !== move.notation || next[index]?.color !== move.color)) {
      identity.current = { id: newGoId(), createdAt: new Date().toISOString() }
    }
    previous.current = match.state
  }
  const record = useMemo<GoLibraryGame>(() => {
    const players: MatchArchivePlayer[] = (['black', 'white'] as const).map((seat) => {
      const human = match.mode === 'local' || (match.mode === 'human' && match.humanColor === seat)
      const engineId = match.mode === 'battle' ? match.battleEngines[seat] : 'katago'
      const detail = match.engineDetails[engineId]
      return {
        seat, kind: human ? 'human' : 'ai', name: human ? `${seat === 'black' ? '黑' : '白'}方玩家` : goAIEngineName(engineId),
        ...(!human && detail ? { engine: { descriptor: goEngineDescriptor(engineId, detail), phase: 'ready' as const, backendLabel: detail.runtimeLabel, budget: { unit: detail.budgetUnit, requested: detail.budget } } } : {}),
      }
    })
    return {
      id: identity.current.id, title: `围棋 ${new Date(identity.current.createdAt).toLocaleString()}`, favorite: false,
      archive: createGoArchive(match.state, new Date(), { players, createdAt: identity.current.createdAt }),
      mode: { local: '本地双人', human: '真人 vs AI', ai: 'AI 自对弈', battle: 'AI 互对弈' }[match.mode],
      configuration: { mode: match.mode, profile: match.profile, humanColor: match.humanColor },
    }
  }, [match.state, match.mode, match.profile, match.humanColor, match.battleEngines, match.engineDetails])
  const save = useCallback(async () => {
    const token = ++request.current
    if (!record.archive.moves.length) { setStatus('尚无棋谱'); setError(null); return }
    setStatus('保存中')
    setError(null)
    try {
      await goLibrary.save(record)
      if (token === request.current) setStatus('已保存')
    } catch (caught) {
      if (token === request.current) {
        setStatus('保存失败')
        setError(caught instanceof Error ? caught.message : '无法写入本机棋谱库，可下载档案备份。')
      }
    }
  }, [record])
  useEffect(() => { void save() }, [save])
  useEffect(() => () => { request.current += 1 }, [])
  return { record, status, error, save }
}
