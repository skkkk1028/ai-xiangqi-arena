import { ChineseAreaScoringStrategy } from './scoring'
import { GO_BOARD_SIZE, type GoRuleset } from './types'

/**
 * Default ruleset for the platform's Go module.
 *
 * Immediate ko is reported first for a useful error message, while positional
 * superko remains the authoritative rule that rejects every historical board
 * repetition.
 */
export const CHINESE_GO_RULESET: GoRuleset = {
  id: 'chinese',
  name: '中国规则（面积计分）',
  boardSize: GO_BOARD_SIZE,
  komi: 7.5,
  suicideForbidden: true,
  repetition: 'positional-superko',
  scoring: ChineseAreaScoringStrategy,
}
