import type { BoardState, GameResult, MoveRecord, PieceType } from '../../game/types'
import type { MatchArchivePlayer, MatchArchiveV1 } from '../core'
import { XiangqiGameEngine, type XiangqiGameState } from './game-engine'

const PIECE_FEN: Record<PieceType, string> = {
  general: 'k', advisor: 'a', elephant: 'b', horse: 'n', chariot: 'r', cannon: 'c', soldier: 'p',
}

export function exportXiangqiFen(state: XiangqiGameState): string {
  return `${boardFen(state.board)} ${state.turn === 'red' ? 'w' : 'b'} - - ${state.noCapturePlies} ${Math.floor(state.history.length / 2) + 1}`
}

export function replayXiangqiUcci(moves: readonly string[]): XiangqiGameState {
  const engine = new XiangqiGameEngine()
  let state = engine.initializeGame()
  for (const [index, text] of moves.entries()) {
    const action = engine.findLegalActionByUcci(state, text)
    if (!action) throw new Error(`象棋档案第 ${index + 1} 手不是合法 UCCI 着法：${text}`)
    state = engine.executeAction(state, action)
  }
  return state
}

export function createXiangqiArchive({
  history,
  players,
  result,
  now = new Date(),
}: {
  history: readonly MoveRecord[]
  players: readonly MatchArchivePlayer[]
  result: GameResult | null
  now?: Date
}): MatchArchiveV1<'xiangqi'> {
  const moves = history.map((move) => move.ucci)
  const engine = new XiangqiGameEngine()
  const current = replayXiangqiUcci(moves)
  const timestamp = now.toISOString()
  return {
    version: 1,
    game: 'xiangqi',
    ruleset: 'project10-xiangqi-current',
    createdAt: timestamp,
    updatedAt: timestamp,
    status: result ? 'finished' : 'playing',
    players,
    moves,
    result: result ? {
      winner: result.winner,
      loser: result.loser,
      reason: result.reason,
      detail: result.detail ?? null,
    } : null,
    initialPosition: exportXiangqiFen(engine.initializeGame()),
    metadata: {
      currentFen: exportXiangqiFen(current),
      moveFormat: 'ucci',
    },
  }
}

function boardFen(board: BoardState): string {
  return board.map((row) => {
    let empty = 0
    let result = ''
    for (const piece of row) {
      if (!piece) {
        empty += 1
        continue
      }
      if (empty) result += empty
      empty = 0
      const symbol = PIECE_FEN[piece.type]
      result += piece.color === 'red' ? symbol.toUpperCase() : symbol
    }
    if (empty) result += empty
    return result
  }).join('/')
}
