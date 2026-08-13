import { UCI_MOVE_PATTERN } from '../../engine/parsers/uci-parser'
import { actionToUci, parseChessUci } from './rules'
import type { ChessMoveAction } from './types'

export { UCI_MOVE_PATTERN }
export { actionToUci as chessActionToUci, parseChessUci }

export function isValidChessUci(value: string): boolean {
  return UCI_MOVE_PATTERN.test(value)
}

export function chessActionFromUci(value: string): ChessMoveAction {
  const action = parseChessUci(value)
  if (!action) throw new Error(`无效的国际象棋 UCI：${value}`)
  return action
}
