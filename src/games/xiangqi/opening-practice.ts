import type { Color } from '../../game/types'
import { XiangqiGameEngine, type XiangqiGameState } from './game-engine'
import { reviewPositions } from './review'

export interface OpeningBranch { id: string; name: string; moves: readonly string[]; description: string }
export interface PracticeOpening { id: string; name: string; branches: OpeningBranch[] }
const description = '示范变化，仅供沿谱练习，不代表唯一正确走法或权威定式。'
export const PRACTICE_OPENINGS: PracticeOpening[] = [
  { id: 'central-screen', name: '中炮对屏风马', branches: [
    { id: 'screen-river', name: '过河车示范', description, moves: ['h2e2', 'h9g7', 'h0g2', 'b9c7', 'i0h0', 'i9h9', 'h0h4', 'g6g5', 'c3c4', 'b7b3', 'b0c2', 'a9b9', 'a0b0', 'b3c3', 'h4h6', 'h7h8'] },
    { id: 'screen-pawn', name: '挺七兵示范', description, moves: ['h2e2', 'h9g7', 'h0g2', 'b9c7', 'i0h0', 'i9h9', 'c3c4', 'c6c5', 'b0c2', 'b7a7', 'a0b0', 'a9b9', 'b2b4', 'h7i7', 'g3g4', 'g6g5'] },
  ] },
  { id: 'central-same', name: '中炮对顺炮', branches: [
    { id: 'same-straight', name: '直车挺兵示范', description, moves: ['h2e2', 'h7e7', 'h0g2', 'h9g7', 'i0h0', 'i9h9', 'b0c2', 'b9c7', 'c3c4', 'c6c5', 'b2b4', 'b7b5', 'a0a1', 'a9a8', 'a1d1', 'a8d8'] },
    { id: 'same-rank', name: '横车出动示范', description, moves: ['h2e2', 'h7e7', 'h0g2', 'h9g7', 'i0i1', 'i9h9', 'i1f1', 'b9c7', 'b0c2', 'c6c5', 'c3c4', 'b7b5', 'b2b4', 'a9a8', 'a0a1', 'a8d8'] },
  ] },
]

export type PracticePhase = 'book' | 'deviated' | 'book-end' | 'live' | 'finished'
export interface OpeningSession {
  branch: OpeningBranch
  startPly: number
  human: Color
  position: XiangqiGameState
  phase: PracticePhase
  deviationPly: number | null
}
const game = new XiangqiGameEngine()
function settleBook(session: OpeningSession): OpeningSession {
  let { position } = session
  if (!position.result && position.history.length < session.branch.moves.length && position.turn !== session.human) {
    const action = game.findLegalActionByUcci(position, session.branch.moves[position.history.length])
    if (!action) throw new Error('示范谱包含非法着法。')
    position = game.executeAction(position, action)
  }
  return { ...session, position, phase: position.result ? 'finished' : position.history.length === session.branch.moves.length ? 'book-end' : 'book' }
}
export function startOpening(branch: OpeningBranch, startPly: number, human: Color): OpeningSession {
  if (!Number.isInteger(startPly) || startPly < 0 || startPly > branch.moves.length) throw new Error('练习起点无效。')
  return settleBook({ branch, startPly, human, position: reviewPositions(branch.moves.slice(0, startPly)).at(-1)!, phase: 'book', deviationPly: null })
}
export function playOpening(session: OpeningSession, ucci: string): OpeningSession {
  if (!['book', 'live'].includes(session.phase) || session.position.turn !== session.human) return session
  const action = game.findLegalActionByUcci(session.position, ucci)
  if (!action) return session
  const position = game.executeAction(session.position, action)
  const deviated = session.phase === 'book' && ucci !== session.branch.moves[session.position.history.length]
  const next: OpeningSession = { ...session, position, deviationPly: deviated ? session.position.history.length : session.deviationPly,
    phase: position.result ? 'finished' : deviated ? 'deviated' : session.phase }
  return next.phase === 'book' ? settleBook(next) : next
}
export function retryOpening(session: OpeningSession): OpeningSession {
  return { ...startOpening(session.branch, session.deviationPly ?? session.startPly, session.human), startPly: session.startPly }
}
