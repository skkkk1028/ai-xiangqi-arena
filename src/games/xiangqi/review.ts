import type { EngineAdapter } from '../../engine/adapter'
import { formatMove, pieceLabel } from '../../game/notation'
import type { EngineScore, EngineSearchResponse, MoveRecord } from '../../game/types'
import { XiangqiGameEngine, type XiangqiGameState } from './game-engine'

const game = new XiangqiGameEngine()
export const REVIEW_TIME_MS = 1_500

export interface MoveReview {
  bestUcci: string
  bestNotation: string
  playedNotation: string
  bestScore: EngineScore | null
  playedScore: EngineScore | null
  lossCp: number | null
  depth: number
  playedDepth: number
  comparison: 'same-root' | 'after-move'
  notes: string[]
  variation: string[]
}

export function reviewPositions(moves: readonly string[]): XiangqiGameState[] {
  let state = game.initializeGame()
  const positions = [state]
  for (const [index, text] of moves.entries()) {
    const move = game.findLegalActionByUcci(state, text)
    if (!move) throw new Error(`第 ${index + 1} 手不是合法着法：${text}`)
    state = game.executeAction(state, move)
    positions.push(state)
  }
  return positions
}

export function recordedCaptureNotes(history: readonly MoveRecord[], index: number): string[] {
  const move = history[index]
  const reply = history[index + 1]
  const notes: string[] = []
  if (move?.captured) notes.push(`棋谱事实：本手吃掉对方的${pieceLabel(move.captured)}。`)
  if (reply?.captured) notes.push(`棋谱事实：对方下一手 ${reply.notation} 吃掉己方的${pieceLabel(reply.captured)}。是否为合理兑子或弃子需结合分析，不能仅据此判错。`)
  return notes
}

function oppositeScore(score: EngineScore | null): EngineScore | null {
  return score ? { ...score, value: -score.value } : null
}

export function scoreText(score: EngineScore | null): string {
  if (!score) return '无可靠评价'
  if (score.kind === 'mate') return score.value > 0 ? `引擎报告将杀 ${score.value}` : `引擎报告被将杀 ${Math.abs(score.value)}`
  return `${score.value >= 0 ? '+' : ''}${(score.value / 100).toFixed(2)} 兵值`
}

/** Both scores are expressed from the player who made the reviewed move. */
export async function analyzeReviewMove(
  engine: EngineAdapter,
  before: XiangqiGameState,
  playedUcci: string,
  assertCurrent: () => void = () => undefined,
  sharedRoot?: EngineSearchResponse,
): Promise<MoveReview> {
  const played = game.findLegalActionByUcci(before, playedUcci)
  if (!played) throw new Error('待复盘着法不合法。')
  const moves = before.history.map((entry) => entry.ucci)
  assertCurrent()
  const root = sharedRoot ?? await engine.search(moves, REVIEW_TIME_MS, { multiPv: 4 })
  assertCurrent()
  const best = root.bestmove && game.findLegalActionByUcci(before, root.bestmove)
  if (!best || !root.bestmove) throw new Error('分析引擎没有返回合法最佳着。')
  const principal = root.candidates.find((candidate) => candidate.pv[0] === root.bestmove) ?? root.info
  const candidate = root.candidates.find((item) => item.pv[0] === playedUcci && item.depth === principal.depth && item.score)
  let playedScore: EngineScore | null
  let playedDepth: number
  let comparison: MoveReview['comparison'] = 'same-root'
  const after = game.executeAction(before, played)
  if (after.result) {
    playedScore = after.result.reason === 'technical' ? null : after.result.winner
      ? { kind: 'mate', value: after.result.winner === before.turn ? 1 : -1 }
      : { kind: 'cp', value: 0 }
    playedDepth = 0
  } else if (playedUcci === root.bestmove || candidate) {
    playedScore = playedUcci === root.bestmove ? principal.score : candidate!.score
    playedDepth = principal.depth
  } else {
    const response = await engine.search([...moves, playedUcci], REVIEW_TIME_MS, { multiPv: 1 })
    assertCurrent()
    playedScore = oppositeScore(response.info.score)
    playedDepth = response.info.depth
    comparison = 'after-move'
  }
  const bestScore = principal.score
  const lossCp = bestScore?.kind === 'cp' && playedScore?.kind === 'cp' ? bestScore.value - playedScore.value : null
  const notes: string[] = []
  const captured = after.history.at(-1)?.captured
  if (captured) notes.push(`棋谱事实：本手吃掉对方的${pieceLabel(captured)}。`)
  if (after.checkColor === after.turn) notes.push('棋谱事实：本手将军。')
  if (after.result?.reason === 'checkmate') notes.push('棋谱事实：本手形成将杀。')
  if (playedUcci === root.bestmove) notes.push('本手与本次搜索的最佳候选一致。')
  if (lossCp !== null) notes.push(lossCp >= 0
    ? `最佳候选与实战选择的评价差约 ${(lossCp / 100).toFixed(2)} 兵值（行棋方视角）。`
    : '实战着的后续搜索评价更高；有限搜索存在波动，本次不判定为失误。')
  if (playedScore && bestScore?.kind === 'mate' && bestScore.value > 0 && !(playedScore.kind === 'mate' && playedScore.value > 0)) {
    notes.push('可能漏掉将杀：最佳候选报告强制将杀，实战着的本次搜索未报告同方将杀。有限搜索结论，尚不能证明实战着无杀。')
  }
  if (playedScore?.kind === 'mate' && playedScore.value < 0) notes.push('实战着后，引擎报告对方存在强制将杀；请沿变化核对。')
  if (!bestScore || !playedScore) notes.push('评价信息不足，仅展示合法候选，不给出失误等级。')
  if (comparison === 'after-move') notes.push('实战着未进入同深度候选，已在落子后以相同时限补搜并翻转视角；深度可能不同，评价差仅为估计。')
  const variation: string[] = []
  let pvState = before
  for (const text of principal.pv.slice(0, 8)) {
    const action = game.findLegalActionByUcci(pvState, text)
    if (!action) break
    variation.push(formatMove(action))
    pvState = game.executeAction(pvState, action)
  }
  return { bestUcci: root.bestmove, bestNotation: formatMove(best), playedNotation: formatMove(played), bestScore, playedScore, lossCp, depth: principal.depth, playedDepth, comparison, notes, variation }
}

export interface MoveComparisonResult { user: MoveReview; reference?: MoveReview }
export async function compareReviewMoves(engine: EngineAdapter, before: XiangqiGameState, userUcci: string, referenceUcci?: string, assertCurrent: () => void = () => undefined): Promise<MoveComparisonResult> {
  for (const move of [userUcci, referenceUcci]) {
    if (move !== undefined && !game.findLegalActionByUcci(before, move)) throw new Error('待比较着法与局面不一致。')
  }
  assertCurrent()
  const root = await engine.search(before.history.map((move) => move.ucci), REVIEW_TIME_MS, { multiPv: 4 })
  assertCurrent()
  const user = await analyzeReviewMove(engine, before, userUcci, assertCurrent, root)
  const reference = referenceUcci ? referenceUcci === userUcci ? user : await analyzeReviewMove(engine, before, referenceUcci, assertCurrent, root) : undefined
  assertCurrent()
  return { user, reference }
}
