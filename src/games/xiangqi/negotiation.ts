import type { Color, MoveRecord, SearchInfo } from '../../game/types'

export const DRAW_OFFER_MIN_PLIES = 50
export const UNDO_MAX_PLIES = 50
export const MAX_DRAW_OFFER_LEAD = 2

export interface ActionEligibility {
  enabled: boolean
  reason: string
}

export function drawOfferEligibility({
  running,
  ownTurn,
  historyLength,
  pending,
  ownOffers,
  opponentOffers,
  maxOffers,
}: {
  running: boolean
  ownTurn: boolean
  historyLength: number
  pending: boolean
  ownOffers: number
  opponentOffers: number
  maxOffers?: number
}): ActionEligibility {
  if (!running) return disabled('仅可在进行中的对局提和')
  if (pending) return disabled('已有对局协商正在处理')
  if (!ownTurn) return disabled('只能在自己的行棋回合提和')
  if (historyLength < DRAW_OFFER_MIN_PLIES) return disabled('第 26 回合起可以提和')
  if (maxOffers !== undefined && ownOffers >= maxOffers) return disabled(`本局最多提和 ${maxOffers} 次`)
  if (ownOffers - opponentOffers >= MAX_DRAW_OFFER_LEAD) {
    return disabled('你的累计提和次数已比对方多两次')
  }
  return enabled('可以提出和棋请求')
}

export function fullTurnUndoEligibility({
  running,
  pending,
  history,
  requester,
  alreadyUsed,
}: {
  running: boolean
  pending: boolean
  history: readonly MoveRecord[]
  requester: Color
  alreadyUsed: boolean
}): ActionEligibility {
  if (!running) return disabled('仅可在进行中的对局申请悔棋')
  if (pending) return disabled('已有对局协商正在处理')
  if (alreadyUsed) return disabled('本局礼让次数已使用')
  if (history.length > UNDO_MAX_PLIES) return disabled('仅前 25 回合允许友谊悔棋')
  if (history.length < 2 || history.at(-2)?.piece.color !== requester) {
    return disabled('你尚未完成可撤销的完整一回合')
  }
  return enabled('撤销你上一着与对方随后一着')
}

export interface AiDrawDecision {
  accepted: boolean
  reason: string
}

/** Engine scores and WDL are interpreted from the side-to-move (the human) perspective. */
export function decideAiDrawOffer(info: SearchInfo): AiDrawDecision {
  if (info.score?.kind === 'mate') {
    return info.score.value > 0
      ? { accepted: true, reason: '搜索显示 AI 将被强制将杀，因此同意和棋。' }
      : { accepted: false, reason: '搜索显示 AI 有强制将杀，因此拒绝和棋。' }
  }
  if (info.wdl) {
    const aiWin = info.wdl.loss
    if (aiWin <= 200 || info.wdl.draw >= 700) {
      return { accepted: true, reason: '当前胜和负概率符合 AI 的和棋接受标准。' }
    }
    return { accepted: false, reason: 'AI 当前胜率或优势高于和棋接受标准。' }
  }
  if (info.score?.kind === 'cp') {
    return info.score.value >= -50
      ? { accepted: true, reason: '当前评价未显示 AI 拥有超过 0.50 的优势，因此同意和棋。' }
      : { accepted: false, reason: '当前评价显示 AI 优势超过 0.50，因此拒绝和棋。' }
  }
  return { accepted: false, reason: '引擎未返回有效评价，AI 按规则拒绝和棋。' }
}

function enabled(reason: string): ActionEligibility {
  return { enabled: true, reason }
}

function disabled(reason: string): ActionEligibility {
  return { enabled: false, reason }
}
