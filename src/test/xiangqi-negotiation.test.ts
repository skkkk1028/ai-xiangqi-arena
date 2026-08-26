import { describe, expect, it } from 'vitest'
import type { MoveRecord, SearchInfo } from '../game/types'
import {
  decideAiDrawOffer,
  drawOfferEligibility,
  fullTurnUndoEligibility,
} from '../games/xiangqi'

const info = (partial: Partial<SearchInfo>): SearchInfo => ({
  depth: 10,
  nodes: 1_000,
  nps: 10_000,
  elapsedMs: 100,
  score: null,
  wdl: null,
  pv: [],
  ...partial,
})

describe('象棋对局协商规则', () => {
  it('提和在第 26 回合开放，并限制累计次数差', () => {
    expect(drawOfferEligibility({
      running: true,
      ownTurn: true,
      historyLength: 49,
      pending: false,
      ownOffers: 0,
      opponentOffers: 0,
    }).enabled).toBe(false)
    expect(drawOfferEligibility({
      running: true,
      ownTurn: true,
      historyLength: 50,
      pending: false,
      ownOffers: 1,
      opponentOffers: 0,
    }).enabled).toBe(true)
    expect(drawOfferEligibility({
      running: true,
      ownTurn: true,
      historyLength: 50,
      pending: false,
      ownOffers: 2,
      opponentOffers: 0,
    }).enabled).toBe(false)
  })

  it('完整回合悔棋只允许撤销申请方上一着和对手应手', () => {
    const history = [
      { piece: { id: 'r', color: 'red', type: 'soldier' } },
      { piece: { id: 'b', color: 'black', type: 'soldier' } },
    ] as MoveRecord[]
    expect(fullTurnUndoEligibility({ running: true, pending: false, history, requester: 'red', alreadyUsed: false }).enabled).toBe(true)
    expect(fullTurnUndoEligibility({ running: true, pending: false, history, requester: 'black', alreadyUsed: false }).enabled).toBe(false)
    expect(fullTurnUndoEligibility({ running: true, pending: false, history, requester: 'red', alreadyUsed: true }).reason).toContain('已使用')
  })

  it('AI 提和策略覆盖强制将杀、WDL、普通评分和无评价', () => {
    expect(decideAiDrawOffer(info({ score: { kind: 'mate', value: 3 } })).accepted).toBe(true)
    expect(decideAiDrawOffer(info({ score: { kind: 'mate', value: -3 } })).accepted).toBe(false)
    expect(decideAiDrawOffer(info({ wdl: { win: 100, draw: 750, loss: 150 } })).accepted).toBe(true)
    expect(decideAiDrawOffer(info({ wdl: { win: 100, draw: 200, loss: 700 } })).accepted).toBe(false)
    expect(decideAiDrawOffer(info({ score: { kind: 'cp', value: -50 } })).accepted).toBe(true)
    expect(decideAiDrawOffer(info({ score: { kind: 'cp', value: -51 } })).accepted).toBe(false)
    expect(decideAiDrawOffer(info({})).accepted).toBe(false)
  })
})
