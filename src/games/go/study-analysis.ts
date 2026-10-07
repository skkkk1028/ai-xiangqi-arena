import { GoGameEngine } from './game-engine'
import { applyGoReplayMove } from './sgf'
import { goRecordToKataGoTuple, gtpToGoMove } from './ai/coordinates'
import { KATAGO_CHINESE_PSK_RULES, type KataGoCapabilities, type KataGoWireAnalysisEvent } from './ai/types'
import type { KataGoTransport } from './ai/KataGoTransport'
import { analysisIdentity, analysisKey, goLibrary, validateGoAnalysis, type GoLibraryGame, type GoSavedAnalysis } from './library'
import type { GoGameState, GoMove } from './types'

export type GoStudyProfile = 'winrate' | 'fast'
export const studyGame = new GoGameEngine()
export function goStudyPositions(source: GoGameState): GoGameState[] {
  let state = studyGame.init()
  const positions = [state]
  for (const record of source.history) {
    state = applyGoReplayMove(studyGame, state, record.kind === 'pass' ? { kind: 'pass' } : record.point!)
    positions.push(state)
  }
  positions[positions.length - 1] = source
  return positions
}
export function encodedPrefix(state: GoGameState): string[] {
  return state.history.map((move) => `${move.color === 'black' ? 'B' : 'W'}:${move.notation}`)
}
export function playableStudyState(state: GoGameState): GoGameState {
  if (state.phase === 'playing') return state
  const review = { ...state, phase: 'scoring' as const, result: null }
  return studyGame.resumePlay(review)
}

export function legalCandidates(state: GoGameState, event: KataGoWireAnalysisEvent) {
  const legal = studyGame.getLegalActions(playableStudyState(state))
  return [...event.candidates].sort((a, b) => a.order - b.order).flatMap((candidate) => {
    try {
      const action = gtpToGoMove(candidate.move)
      if (!legal.some((move) => studyGame.actionsEqual(move, action))) return []
      let position = playableStudyState(state)
      const pv: string[] = []
      for (const notation of candidate.pv.slice(0, 12)) {
        try {
          if (position.phase !== 'playing') break
          const move = gtpToGoMove(notation)
          position = studyGame.applyMove(position, move)
          pv.push(notation)
        } catch { break }
      }
      return [{ ...candidate, action, pv }]
    } catch { return [] }
  })
}

export interface GoMoveComparison {
  before: KataGoWireAnalysisEvent
  after: KataGoWireAnalysisEvent
  best: string | null
  actual: string
  lossPoints: number | null
  lossWinrate: number | null
  notes: string[]
  variation: string[]
  reviewWorthy: boolean
}
export function compareGoMove(beforeState: GoGameState, afterState: GoGameState, before: KataGoWireAnalysisEvent, after: KataGoWireAnalysisEvent): GoMoveComparison {
  const actual = afterState.history.at(-1)!.notation
  const candidates = legalCandidates(beforeState, before)
  const best = candidates[0]
  const actualCandidate = candidates.find((candidate) => studyGame.actionsEqual(candidate.action, gtpToGoMove(actual)))
  const same = analysisIdentity(before) === analysisIdentity(after)
  const selectedWin = actualCandidate?.winrate ?? after.root.winrate
  const selectedScore = actualCandidate ? actualCandidate.scoreLead : after.root.scoreLead
  const sign = beforeState.turn === 'black' ? 1 : -1
  const enough = same && Boolean(best && best.visits > 0) && (!actualCandidate || actualCandidate.visits > 0) && before.root.visits > 0 && after.root.visits > 0
  const lossWinrate = enough ? sign * (best!.winrate - selectedWin) * 100 : null
  const lossPoints = enough && best!.scoreLead !== null && selectedScore !== null ? sign * (best!.scoreLead - selectedScore) : null
  const notes: string[] = []
  const captures = afterState.history.at(-1)!.captures.length
  notes.push(`棋谱事实：本手${actual === 'pass' ? '虚着' : `落在 ${actual}`}，提取对方 ${captures} 子；提子不直接代表好棋。`)
  if (!same) notes.push('模型、后端或搜索配置不同，无法可靠比较；请按同一档位重新分析。')
  if (best?.move.toLowerCase() === actual.toLowerCase()) notes.push('本手与本次搜索的首选一致。')
  if (lossPoints !== null) notes.push(`行棋方视角：相对推荐着预计${lossPoints >= 0 ? '少' : '多'} ${Math.abs(lossPoints).toFixed(1)} 目。`)
  if (lossWinrate !== null) notes.push(`行棋方胜率相对推荐着${lossWinrate >= 0 ? '降低' : '提高'} ${Math.abs(lossWinrate).toFixed(1)} 个百分点。`)
  notes.push(actualCandidate ? '比较采用同一次搜索的候选数据；各候选 visits 可能不同。' : '实战着未进入候选，使用落子后相同档位的局面评价估计；不是严格等量搜索。')
  if (before.timedOut || after.timedOut || before.truncated || after.truncated || before.root.visits < before.requestedVisits || after.root.visits < after.requestedVisits) notes.push('搜索未完成请求 visits 或已超时，结果仅供初步参考。')
  if (before.modelFallback || after.modelFallback || before.backendFallback || after.backendFallback) notes.push('本次使用了模型或计算后端回退，已记录实际模型与后端。')
  if (lossPoints === null) notes.push('没有可比较的预计目差，不推断目数损失。')
  return { before, after, best: best?.move ?? null, actual, lossPoints, lossWinrate, notes, variation: best?.pv ?? [], reviewWorthy: enough && ((lossPoints ?? 0) >= 2 || (lossWinrate ?? 0) >= 10) }
}

/** Search one position without reading or writing the persistent study library. */
export async function searchGoPosition(transport: KataGoTransport, state: GoGameState, profile: GoStudyProfile, signal: AbortSignal): Promise<KataGoWireAnalysisEvent> {
  signal.throwIfAborted()
  await transport.initialize(signal)
  signal.throwIfAborted()
  const requestId = `study-${crypto.randomUUID()}`
  const event = await transport.analyze({ requestId, gameId: 'go', player: state.turn, profile, boardSize: 19, komi: 7.5,
    rules: KATAGO_CHINESE_PSK_RULES, moves: state.history.map((move) => goRecordToKataGoTuple(move)),
  }, { signal, analysisGroup: 'background' })
  signal.throwIfAborted()
  validateGoAnalysis(event)
  if (event.profile !== profile || event.requestId !== requestId) throw new Error('分析结果与请求不一致。')
  return event
}

export class GoStudyAnalyzer {
  constructor(private readonly transport: KataGoTransport, private readonly cache: GoSavedAnalysis[], private readonly onSaved: (entry: GoSavedAnalysis) => void) {}

  async position(game: GoLibraryGame, state: GoGameState, profile: GoStudyProfile, signal: AbortSignal): Promise<KataGoWireAnalysisEvent> {
    signal.throwIfAborted()
    const capabilities = await this.transport.initialize(signal)
    signal.throwIfAborted()
    const prefix = encodedPrefix(state)
    const hit = [...this.cache].reverse().find((entry) => entry.ruleset === game.archive.ruleset && JSON.stringify(entry.prefix) === JSON.stringify(prefix) && matchesCapabilities(entry.event, capabilities, profile))
    if (hit) {
      // The retry shares the exact historical prefix, so use the same search
      // for its recommendation instead of comparing two independent searches.
      const entry = hit.gameId === game.id ? hit : { ...hit, gameId: game.id, key: analysisKey(game.id, game.archive.ruleset, prefix, hit.event) }
      if (entry !== hit) { this.cache.push(entry); this.onSaved(entry) }
      await goLibrary.saveAnalysis(entry); signal.throwIfAborted(); return entry.event
    }
    const event = await this.transport.analyze({
      requestId: `study-${crypto.randomUUID()}`, gameId: 'go', player: state.turn, profile, boardSize: 19, komi: 7.5,
      rules: KATAGO_CHINESE_PSK_RULES, moves: state.history.map((move) => goRecordToKataGoTuple(move)),
    }, { signal, analysisGroup: 'background' })
    signal.throwIfAborted()
    validateGoAnalysis(event)
    const entry: GoSavedAnalysis = { key: analysisKey(game.id, game.archive.ruleset, prefix, event), gameId: game.id, prefix, ruleset: game.archive.ruleset, profile, createdAt: new Date().toISOString(), event }
    this.cache.push(entry)
    this.onSaved(entry)
    await goLibrary.saveAnalysis(entry)
    signal.throwIfAborted()
    return event
  }

  async move(game: GoLibraryGame, before: GoGameState, after: GoGameState, profile: GoStudyProfile, signal: AbortSignal): Promise<GoMoveComparison> {
    const first = await this.position(game, before, profile, signal)
    const second = await this.position(game, after, profile, signal)
    return compareGoMove(before, after, first, second)
  }
}
function matchesCapabilities(event: KataGoWireAnalysisEvent, capabilities: KataGoCapabilities, profile: GoStudyProfile) {
  return event.profile === profile && event.engineVersion === capabilities.engineVersion && event.modelName === capabilities.modelName
    && event.runtimeBackend === capabilities.runtimeBackend && event.modelFallback === capabilities.modelFallback && event.backendFallback === capabilities.backendFallback
    && event.requestedVisits === capabilities.profiles[profile]?.maxVisits
}

export function canonicalStudyMove(state: GoGameState, action: GoMove): GoMove {
  const move = studyGame.getLegalActions(state).find((candidate) => studyGame.actionsEqual(candidate, action))
  if (!move) throw new Error('该着法不合法（可能为自杀或超级劫禁手）。')
  return move
}
