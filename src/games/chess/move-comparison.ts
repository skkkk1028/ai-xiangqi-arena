import type { EngineScore } from '../../game/types'
import { ChessStudyEngine, validateStudyResponse, type StudyTier } from './study-engine'
import { ChessGameEngine, parseChessUci, isChessMoveAction } from './rules'
import type { ChessGameState } from './types'
export type StudySearch = Awaited<ReturnType<ChessStudyEngine['search']>>
export interface MoveEvidence { uci: string; san: string; method: 'root' | 'after' | 'terminal'; score: EngineScore | null; depth: number; pv: string[]; search?: StudySearch; terminal?: string }
export interface ChessMoveComparisonResult { root: StudySearch; selected: MoveEvidence; reference?: MoveEvidence; best?: MoveEvidence; tier: StudyTier }
const rules = new ChessGameEngine()
const validScore = (score: EngineScore | null | undefined): score is EngineScore => Boolean(score && ['cp', 'mate'].includes(score.kind) && Number.isFinite(score.value))
export async function compareChessMoves(before: ChessGameState, selected: string, reference?: string, tier: StudyTier = 'quick', signal?: AbortSignal): Promise<ChessMoveComparisonResult> {
  const actions = [selected, ...(reference ? [reference] : [])].map((uci) => {
    const parsed = parseChessUci(uci)
    const legal = parsed && rules.getLegalActions(before).filter(isChessMoveAction).find((a) => rules.actionsEqual(a, parsed))
    if (!legal) throw new Error('比较着法与出题局面不一致。')
    return legal
  })
  const engine = new ChessStudyEngine(true)
  const cancel = () => engine.dispose()
  signal?.addEventListener('abort', cancel, {once: true})
  const check = () => { if (signal?.aborted) throw new DOMException('分析已取消。', 'AbortError') }
  try {
    check()
    const prefix = before.history.map((m) => m.uci)
    const root = await engine.search(before.initialFen, prefix, tier, 4, signal); check()
    root.response = validateStudyResponse(before.fen, root.response)
    const principal = root.response.candidates.find((c) => c.multipv === 1)
    const bestMove = root.response.bestmove
    const evidence = async (uci: string): Promise<MoveEvidence> => {
      check()
      const action = actions[[selected, reference].indexOf(uci)] ?? parseChessUci(uci)!
      const after = rules.executeAction(before, action)
      const basic = {uci, san: after.lastMove!.san}
      if (after.result) return {...basic, method: 'terminal', score: null, depth: 0, pv: [uci], terminal: after.result.reason}
      const candidate = root.response.candidates.find((c) => c.pv[0] === uci && c.depth > 0 && c.depth === principal?.depth && validScore(c.score))
      if (candidate) return {...basic, method: 'root', score: candidate.score, depth: candidate.depth, pv: candidate.pv, search: root}
      const search = await engine.search(before.initialFen, [...prefix, uci], tier, 1, signal); check()
      search.response = validateStudyResponse(after.fen, search.response)
      const info = search.response.info
      return {...basic, method: 'after', score: validScore(info.score) ? {...info.score, value: -info.score.value} : null, depth: info.depth, pv: [uci, ...info.pv], search}
    }
    const chosen = await evidence(selected)
    const compared = reference ? reference === selected ? chosen : await evidence(reference) : undefined
    let best: MoveEvidence | undefined
    if (bestMove && principal?.pv[0] === bestMove && validScore(principal.score)) {
      const move = parseChessUci(bestMove)!
      best = {uci: bestMove, san: rules.executeAction(before, move).lastMove!.san, method: 'root', score: principal.score, depth: principal.depth, pv: principal.pv, search: root}
    }
    return {root, selected: chosen, reference: compared, best, tier}
  } finally { signal?.removeEventListener('abort', cancel); engine.dispose() }
}
export function comparisonDifference(evidence: MoveEvidence, best?: MoveEvidence): number | null {
  if (!best || evidence.score?.kind !== 'cp' || best.score?.kind !== 'cp' || evidence.depth <= 0 || best.depth <= 0 || !evidence.search || !best.search
    || evidence.search.timedOut || best.search.timedOut || evidence.search.engine.fallback || best.search.engine.fallback
    || JSON.stringify(evidence.search.engine) !== JSON.stringify(best.search.engine)) return null
  return (evidence.score.value - best.score.value) / 100
}
