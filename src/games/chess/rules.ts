import { Chess, type Move as ChessJsMove } from 'chess.js'
import type { GameEngine, GameStatus } from '../core'
import { CHESS_INITIAL_FEN, CHESS_MAX_PLIES, type ChessAction, type ChessClaimReason, type ChessColor, type ChessDrawClaimAction, type ChessGameResult, type ChessGameState, type ChessMoveAction, type ChessMoveRecord, type ChessPromotion, type ChessSquare } from './types'
import { selectChessOpening } from './openings'

function asSquare(value: string): ChessSquare {
  return value as ChessSquare
}

export function actionToUci(action: ChessMoveAction): string {
  return `${action.from}${action.to}${action.promotion ?? ''}`
}

export function isChessMoveAction(action: ChessAction): action is ChessMoveAction {
  return action.kind !== 'claim-draw'
}

export function parseChessUci(value: string): ChessMoveAction | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(value.trim().toLowerCase())
  if (!match) return null
  return {
    from: asSquare(match[1]),
    to: asSquare(match[2]),
    ...(match[3] ? { promotion: match[3] as ChessPromotion } : {}),
  }
}

export function createChessState(seed = 0, initialFen = CHESS_INITIAL_FEN): ChessGameState {
  const opening = selectChessOpening(seed)
  return {
    phase: 'playing',
    initialFen,
    fen: initialFen,
    turn: new Chess(initialFen).turn(),
    history: [],
    lastMove: null,
    result: null,
    seed: seed >>> 0,
    openingId: opening.id,
    openingName: opening.name,
  }
}

/** Replays every move from the archive; FEN alone is deliberately insufficient. */
export function replayChessState(
  moves: readonly string[],
  options: { initialFen?: string; seed?: number; openingId?: string; openingName?: string } = {},
): ChessGameState {
  const engine = new ChessGameEngine()
  let state = createChessState(options.seed ?? 0, options.initialFen ?? CHESS_INITIAL_FEN)
  if (options.openingId) state = { ...state, openingId: options.openingId, openingName: options.openingName ?? state.openingName }
  for (const [index, value] of moves.entries()) {
    const action = parseChessUci(value)
    if (!action) throw new Error(`国际象棋档案第 ${index + 1} 手 UCI 无效：${value}`)
    const legal = engine.getLegalActions(state).find((candidate) => engine.actionsEqual(candidate, action))
    if (!legal) throw new Error(`国际象棋档案第 ${index + 1} 手不是当前局面的合法着法：${value}`)
    state = engine.executeAction(state, legal)
  }
  return state
}

export class ChessGameEngine implements GameEngine<ChessGameState, ChessAction, ChessColor, ChessMoveRecord> {
  readonly id = 'chess'
  readonly name = '国际象棋'

  initializeGame(): ChessGameState {
    return createChessState()
  }

  getCurrentPlayer(state: ChessGameState): ChessColor {
    return state.turn
  }

  getLegalActions(state: ChessGameState): readonly ChessAction[] {
    if (state.result) return []
    const chess = replayChess(state)
    const moves = chess.moves({ verbose: true }).map((move) => moveToAction(move))
    return [...moves, ...legalDrawClaims(state, moves)]
  }

  actionsEqual(left: ChessAction, right: ChessAction): boolean {
    if (isChessMoveAction(left) && isChessMoveAction(right)) return actionToUci(left) === actionToUci(right)
    if (isChessMoveAction(left) || isChessMoveAction(right)) return false
    return left.reason === right.reason
      && intendedMoveUci(left) === intendedMoveUci(right)
  }

  executeAction(state: ChessGameState, requested: ChessAction): ChessGameState {
    if (state.result) throw new Error('国际象棋对局已经结束。')
    if (!isChessMoveAction(requested)) return executeDrawClaim(state, requested)
    const chess = replayChess(state)
    const legal = chess.moves({ verbose: true }).find((move) => this.actionsEqual(moveToAction(move), requested))
    if (!legal) throw new Error('国际象棋着法不合法。')
    const moved = chess.move({
      from: legal.from,
      to: legal.to,
      ...(legal.promotion ? { promotion: legal.promotion } : {}),
    })
    const record: ChessMoveRecord = {
      ...moveToAction(moved),
      ply: state.history.length + 1,
      color: moved.color,
      uci: actionToUci(moveToAction(moved)),
      san: moved.san,
      fen: chess.fen(),
      ...(moved.captured ? { captured: moved.captured } : {}),
      check: chess.isCheck(),
      mate: chess.isCheckmate(),
    }
    const result = adjudicate(chess, state.history.length + 1)
    return {
      ...state,
      phase: result?.reason === 'technical-stop' ? 'technical' : result ? 'finished' : 'playing',
      fen: chess.fen(),
      turn: chess.turn(),
      history: [...state.history, record],
      lastMove: record,
      result,
    }
  }

  isFinished(state: ChessGameState): boolean {
    return state.result !== null
  }

  getStatus(state: ChessGameState): GameStatus<ChessColor> {
    if (!state.result) return { phase: 'playing', currentPlayer: state.turn }
    return { phase: 'finished', winner: state.result.winner, reason: state.result.reason }
  }

  getRecord(state: ChessGameState): readonly ChessMoveRecord[] {
    return state.history
  }
}

export function replayChess(state: ChessGameState): Chess {
  const chess = new Chess(state.initialFen)
  for (const record of state.history) {
    const action = parseChessUci(record.uci)
    if (!action) throw new Error(`棋谱包含无效 UCI：${record.uci}`)
    chess.move({
      from: action.from,
      to: action.to,
      ...(action.promotion ? { promotion: action.promotion } : {}),
    })
  }
  if (chess.fen() !== state.fen) throw new Error('棋谱与当前 FEN 不一致，档案可能被篡改。')
  return chess
}

function moveToAction(move: ChessJsMove): ChessMoveAction {
  return {
    from: asSquare(move.from),
    to: asSquare(move.to),
    ...(move.promotion ? { promotion: move.promotion as ChessPromotion } : {}),
  }
}

function adjudicate(chess: Chess, ply: number): ChessGameResult | null {
  if (chess.isCheckmate()) {
    const loser = chess.turn()
    return result('checkmate', 'board', opposite(loser), loser)
  }
  if (chess.isStalemate()) return result('stalemate', 'board')
  if (chess.isInsufficientMaterial()) return result('insufficient-material', 'board')
  if (positionOccurrenceCount(chess) >= 5) return result('fivefold-repetition', 'automatic')
  if (halfmoveClock(chess) >= 150) return result('seventy-five-move', 'automatic')
  if (ply >= CHESS_MAX_PLIES) return result('technical-stop', 'technical')
  return null
}

export function canClaimThreefold(state: ChessGameState, intendedMove?: ChessMoveAction): boolean {
  const { chess, counts } = analyzeRepetitions(state)
  if (intendedMove && !applyLegalMove(chess, intendedMove)) return false
  const prior = counts.get(positionKey(chess)) ?? 0
  return intendedMove ? prior + 1 >= 3 : prior >= 3
}

export function canClaimFiftyMove(state: ChessGameState, intendedMove?: ChessMoveAction): boolean {
  const chess = replayChess(state)
  if (intendedMove && !applyLegalMove(chess, intendedMove)) return false
  return halfmoveClock(chess) >= 100
}

export function wouldTriggerAutomaticDraw(state: ChessGameState, move: ChessMoveAction): boolean {
  const chess = replayChess(state)
  if (!applyLegalMove(chess, move)) return false
  return positionOccurrenceCount(chess) >= 5 || halfmoveClock(chess) >= 150
}

function legalDrawClaims(state: ChessGameState, moves: readonly ChessMoveAction[]): ChessDrawClaimAction[] {
  const { chess, counts } = analyzeRepetitions(state)
  const claims: ChessDrawClaimAction[] = []
  const currentThreefold = (counts.get(positionKey(chess)) ?? 0) >= 3
  const currentFiftyMove = halfmoveClock(chess) >= 100
  if (currentThreefold) claims.push({ kind: 'claim-draw', reason: 'threefold-repetition' })
  if (currentFiftyMove) claims.push({ kind: 'claim-draw', reason: 'fifty-move' })
  for (const move of moves) {
    if (!applyLegalMove(chess, move)) continue
    if (!currentThreefold && (counts.get(positionKey(chess)) ?? 0) + 1 >= 3) {
      claims.push({ kind: 'claim-draw', reason: 'threefold-repetition', intendedMove: move })
    }
    if (!currentFiftyMove && halfmoveClock(chess) >= 100) {
      claims.push({ kind: 'claim-draw', reason: 'fifty-move', intendedMove: move })
    }
    chess.undo()
  }
  return claims
}

function executeDrawClaim(state: ChessGameState, claim: ChessDrawClaimAction): ChessGameState {
  const valid = claim.reason === 'threefold-repetition'
    ? canClaimThreefold(state, claim.intendedMove)
    : canClaimFiftyMove(state, claim.intendedMove)
  if (!valid) throw new Error(`当前局面不满足${claim.reason === 'threefold-repetition' ? '三次重复' : '五十回合'}和棋申请条件。`)
  return {
    ...state,
    phase: 'finished',
    result: result(claim.reason, 'claim', null, null, state.turn, claim.intendedMove ? actionToUci(claim.intendedMove) : null),
  }
}

function applyLegalMove(chess: Chess, action: ChessMoveAction): boolean {
  try {
    return Boolean(chess.move({ from: action.from, to: action.to, ...(action.promotion ? { promotion: action.promotion } : {}) }))
  } catch {
    return false
  }
}

/** Counts the current FIDE-equivalent position in the complete game history. */
function positionOccurrenceCount(chess: Chess): number {
  const moves = chess.history({ verbose: true })
  while (chess.undo()) {
    // Rewind to the initial position; normalized FEN preserves only a legally usable en-passant right.
  }
  const targetMoves = [...moves]
  const keys: string[] = [positionKey(chess)]
  for (const move of targetMoves) {
    chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) })
    keys.push(positionKey(chess))
  }
  const current = keys.at(-1)
  return keys.filter((key) => key === current).length
}

function analyzeRepetitions(state: ChessGameState): { chess: Chess; counts: Map<string, number> } {
  const chess = new Chess(state.initialFen)
  const counts = new Map<string, number>()
  increment(counts, positionKey(chess))
  for (const record of state.history) {
    const action = parseChessUci(record.uci)
    if (!action || !applyLegalMove(chess, action)) throw new Error(`棋谱包含无效 UCI：${record.uci}`)
    increment(counts, positionKey(chess))
  }
  if (chess.fen() !== state.fen) throw new Error('棋谱与当前 FEN 不一致，档案可能被篡改。')
  return { chess, counts }
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function positionKey(chess: Chess): string {
  return chess.fen().split(' ').slice(0, 4).join(' ')
}

export function chessPositionIdentity(fen: string): string {
  return positionKey(new Chess(fen))
}

function halfmoveClock(chess: Chess): number {
  return Number(chess.fen().split(' ')[4])
}

function intendedMoveUci(claim: ChessDrawClaimAction): string {
  return claim.intendedMove ? actionToUci(claim.intendedMove) : ''
}

function result(
  reason: ChessGameResult['reason'],
  termination: ChessGameResult['termination'],
  winner: ChessColor | null = null,
  loser: ChessColor | null = null,
  claimant: ChessColor | null = null,
  intendedMove: string | null = null,
): ChessGameResult {
  return { winner, loser, reason, termination, claimant, intendedMove }
}

function opposite(color: ChessColor): ChessColor {
  return color === 'w' ? 'b' : 'w'
}
