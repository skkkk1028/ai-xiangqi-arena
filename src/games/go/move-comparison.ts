import type { GoGameState, GoMove } from './types'
import type { KataGoTransport } from './ai/KataGoTransport'
import type { KataGoWireAnalysisEvent } from './ai/types'
import { goMoveToGtp } from './ai/coordinates'
import { analysisIdentity } from './library'
import { canonicalStudyMove, legalCandidates, searchGoPosition, studyGame, type GoStudyProfile } from './study-analysis'

export interface GoMoveEvidence {
  move: string
  method: 'candidate' | 'after'
  event: KataGoWireAnalysisEvent
  winrate: number | null
  scoreLead: number | null
  lossWinrate: number | null
  lossPoints: number | null
  visits: number
  variation: readonly string[]
  notes: string[]
}
export interface GoTwoMoveComparison { root: KataGoWireAnalysisEvent; best: string | null; selected: GoMoveEvidence; reference?: GoMoveEvidence }
export async function compareGoMoves(before: GoGameState, selected: GoMove, reference: GoMove | undefined, profile: GoStudyProfile, signal: AbortSignal, transport: KataGoTransport): Promise<GoTwoMoveComparison> {
  signal.throwIfAborted()
  if (before.phase !== 'playing') throw new Error('请先显式恢复行棋，再重走和分析。')
  const user = canonicalStudyMove(before, selected)
  const actual = reference ? canonicalStudyMove(before, reference) : undefined
  const root = await searchGoPosition(transport, before, profile, signal)
  const candidates = legalCandidates(before, root)
  const best = candidates[0]
  const sign = before.turn === 'black' ? 1 : -1
  const evidence = async (move: GoMove): Promise<GoMoveEvidence> => {
    const candidate = candidates.find((item) => studyGame.actionsEqual(item.action, move) && item.visits > 0)
    const after = studyGame.applyMove(before, move)
    const event = candidate ? root : await searchGoPosition(transport, after, profile, signal)
    signal.throwIfAborted()
    const visits = candidate?.visits ?? event.root.visits
    const comparable = analysisIdentity(root) === analysisIdentity(event) && root.root.visits > 0 && visits > 0
    const winrate = comparable ? (before.turn === 'black' ? (candidate?.winrate ?? event.root.winrate) : 1 - (candidate?.winrate ?? event.root.winrate)) : null
    const rawScore = candidate ? candidate.scoreLead : event.root.scoreLead
    const scoreLead = comparable && rawScore !== null ? sign * rawScore : null
    const lossPoints = best && best.visits > 0 && scoreLead !== null && best.scoreLead !== null ? sign * best.scoreLead - scoreLead : null
    const lossWinrate = best && best.visits > 0 && winrate !== null ? ((before.turn === 'black' ? best.winrate : 1 - best.winrate) - winrate) * 100 : null
    const notes: string[] = []
    if (!comparable) notes.push('模型、后端、搜索配置不同或有效统计不足，无法可靠比较。')
    if (lossPoints === null) notes.push('没有可比较的预计目差，不推断目数损失。')
    if ([root,event].some(e=>e.timedOut || e.truncated || e.root.visits < e.requestedVisits)) notes.push('搜索未完成预算或已超时，仅供初步参考。')
    if ([root,event].some(e=>e.modelFallback || e.backendFallback)) notes.push('发生模型或后端回退，以显示的实际配置为准。')
    if (after.phase === 'scoring') notes.push('第二次虚着后的计分尚未确认，搜索估计不是最终结算。')
    return { move: goMoveToGtp(move), method: candidate ? 'candidate' : 'after', event, winrate, scoreLead, lossPoints, lossWinrate, visits,
      variation: candidate?.pv ?? legalCandidates(after,event)[0]?.pv ?? [], notes }
  }
  const own = await evidence(user)
  const other = actual ? studyGame.actionsEqual(user,actual) ? own : await evidence(actual) : undefined
  return {root, best: best?.move ?? null, selected:own, reference:other}
}
