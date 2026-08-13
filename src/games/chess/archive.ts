import { Chess } from 'chess.js'
import { parseMatchArchive, type MatchArchivePlayer, type MatchArchiveV1 } from '../core'
import { canClaimFiftyMove, canClaimThreefold, replayChessState } from './rules'
import { CHESS_OPENINGS, selectChessOpening } from './openings'
import { CHESS_INITIAL_FEN, CHESS_LEGACY_RULESET, CHESS_RULESET, type ChessGameResult, type ChessGameState } from './types'

export function exportChessPgn(state: ChessGameState): string {
  const replayed = replayChessState(state.history.map((record) => record.uci), {
    initialFen: state.initialFen,
    seed: state.seed,
    openingId: state.openingId,
    openingName: state.openingName,
  })
  const chess = new Chess(replayed.initialFen)
  for (const record of replayed.history) {
    chess.move({ from: record.from, to: record.to, ...(record.promotion ? { promotion: record.promotion } : {}) })
  }
  chess.setHeader('Event', 'Project10 AI 国际象棋观战')
  chess.setHeader('Opening', state.openingName)
  if (state.initialFen !== CHESS_INITIAL_FEN) {
    chess.setHeader('SetUp', '1')
    chess.setHeader('FEN', state.initialFen)
  }
  if (state.result?.reason === 'checkmate') chess.setHeader('Result', state.result.winner === 'w' ? '1-0' : '0-1')
  else if (state.result?.reason === 'technical-stop') {
    chess.setHeader('Result', '*')
    chess.setHeader('Termination', `technical stop after ${state.history.length} plies`)
  } else if (state.result) {
    chess.setHeader('Result', '1/2-1/2')
    chess.setHeader('Termination', terminationLabel(state.result))
  }
  else chess.setHeader('Result', '*')
  return chess.pgn({ newline: '\n' })
}

export function createChessArchive({
  state,
  players,
  now = new Date(),
}: {
  state: ChessGameState
  players: readonly MatchArchivePlayer[]
  now?: Date
}): MatchArchiveV1<'chess'> {
  const timestamp = now.toISOString()
  return {
    version: 1,
    game: 'chess',
    ruleset: CHESS_RULESET,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: state.result ? 'finished' : 'playing',
    players,
    moves: state.history.map((record) => record.uci),
    result: state.result ? { ...state.result } : null,
    initialPosition: state.initialFen,
    metadata: {
      seed: state.seed,
      openingId: state.openingId,
      openingName: state.openingName,
      currentFen: state.fen,
      moveFormat: 'uci',
      pgn: exportChessPgn(state),
    },
  }
}

export function exportChessArenaPgn(state: ChessGameState, players: readonly MatchArchivePlayer[]): string {
  const chess = new Chess(state.initialFen)
  for (const record of state.history) chess.move({ from: record.from, to: record.to, ...(record.promotion ? { promotion: record.promotion } : {}) })
  const white = players.find((player) => player.seat === 'w')
  const black = players.find((player) => player.seat === 'b')
  chess.setHeader('Event', 'Project10 多引擎竞技场')
  chess.setHeader('White', white?.name ?? 'White Engine')
  chess.setHeader('Black', black?.name ?? 'Black Engine')
  chess.setHeader('WhiteEngine', archiveEngineTag(white))
  chess.setHeader('BlackEngine', archiveEngineTag(black))
  chess.setHeader('Opening', state.openingName)
  if (state.initialFen !== CHESS_INITIAL_FEN) { chess.setHeader('SetUp', '1'); chess.setHeader('FEN', state.initialFen) }
  if (state.result?.reason === 'checkmate') chess.setHeader('Result', state.result.winner === 'w' ? '1-0' : '0-1')
  else if (state.result?.reason === 'technical-stop') { chess.setHeader('Result', '*'); chess.setHeader('Termination', `technical stop after ${state.history.length} plies`) }
  else if (state.result) { chess.setHeader('Result', '1/2-1/2'); chess.setHeader('Termination', terminationLabel(state.result)) }
  else chess.setHeader('Result', '*')
  return chess.pgn({ newline: '\n' })
}

function archiveEngineTag(player: MatchArchivePlayer | undefined): string {
  const descriptor = player?.engine?.descriptor
  return descriptor ? `${descriptor.name} ${descriptor.version} ${descriptor.modelSha256 ?? ''}`.trim() : 'unloaded'
}

export function restoreChessArchive(value: unknown): ChessGameState {
  const parsed = parseMatchArchive(value)
  if (parsed.game !== 'chess') throw new Error('棋局档案不属于国际象棋。')
  const archive = parsed as MatchArchiveV1<'chess'>
  const legacy = archive.ruleset === CHESS_LEGACY_RULESET
  if (!legacy && archive.ruleset !== CHESS_RULESET) throw new Error('国际象棋档案规则集不受支持。')
  if (Date.parse(archive.updatedAt) < Date.parse(archive.createdAt)) throw new Error('国际象棋档案更新时间早于创建时间。')
  const seats = archive.players.map((player) => player.seat).sort()
  if (seats[0] !== 'b' || seats[1] !== 'w' || archive.players.some((player) => (player.kind !== 'ai' && player.kind !== 'human') || player.name.trim().length === 0)) {
    throw new Error('国际象棋档案必须包含唯一的白方和黑方席位，且玩家类型有效。')
  }
  const metadata = archive.metadata
  const openingId = typeof metadata?.openingId === 'string' ? metadata.openingId : ''
  const opening = CHESS_OPENINGS.find((candidate) => candidate.id === openingId)
  if (
    !metadata
    || typeof archive.initialPosition !== 'string'
    || typeof metadata.currentFen !== 'string'
    || !Number.isInteger(metadata.seed)
    || Number(metadata.seed) < 0
    || Number(metadata.seed) > 0xffffffff
    || !opening
    || selectChessOpening(Number(metadata.seed)).id !== opening.id
    || metadata.moveFormat !== 'uci'
    || typeof metadata.openingName !== 'string'
    || typeof metadata.pgn !== 'string'
  ) {
    throw new Error('国际象棋档案缺少完整的初始 FEN、种子、开局或 UCI 元数据。')
  }
  try {
    new Chess(archive.initialPosition)
  } catch {
    throw new Error('国际象棋档案初始 FEN 无效。')
  }
  let state = replayChessState(archive.moves, {
    initialFen: archive.initialPosition,
    seed: Number(metadata.seed),
    openingId,
    openingName: metadata.openingName,
  })
  if (metadata.openingName !== opening.name || metadata.currentFen !== state.fen) {
    throw new Error('国际象棋档案 FEN 与逐手重放结果不一致，已拒绝恢复。')
  }
  if (legacy && archive.result) state = migrateLegacyResult(state, archive.result)
  else if (archive.result && archive.result.termination === 'claim') state = restoreClaimedResult(state, archive.result)
  const expectedStatus = state.result ? 'finished' : 'playing'
  if (archive.status !== expectedStatus) throw new Error('国际象棋档案状态与逐手重放结果不一致。')
  if ((archive.result === null) !== (state.result === null) || (!legacy && archive.result !== null && !sameResult(archive.result, state.result))) {
    throw new Error('国际象棋档案终局信息与逐手重放结果不一致，已拒绝恢复。')
  }
  if (!legacy && metadata.pgn !== exportChessPgn(state)) throw new Error('国际象棋档案 PGN 与逐手重放结果不一致。')
  return state
}

function sameResult(value: unknown, result: ChessGameResult | null): boolean {
  if (!result || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate).sort()
  if (keys.join(',') !== 'claimant,intendedMove,loser,reason,termination,winner') return false
  return candidate.reason === result.reason
    && candidate.winner === result.winner
    && candidate.loser === result.loser
    && candidate.termination === result.termination
    && candidate.claimant === result.claimant
    && candidate.intendedMove === result.intendedMove
}

function migrateLegacyResult(state: ChessGameState, value: Record<string, unknown>): ChessGameState {
  const reason = value.reason
  if (reason !== 'threefold-repetition' && reason !== 'fifty-move') {
    if (!state.result
      || value.reason !== state.result.reason
      || value.winner !== state.result.winner
      || value.loser !== state.result.loser
      || value.automaticClaim !== false) {
      throw new Error('国际象棋旧档案终局信息无效。')
    }
    return state
  }
  const valid = reason === 'threefold-repetition' ? canClaimThreefold(state) : canClaimFiftyMove(state)
  if (!valid || value.automaticClaim !== true) throw new Error('国际象棋旧档案终局信息无效。')
  return {
    ...state,
    phase: 'finished',
    result: {
      winner: null,
      loser: null,
      reason,
      termination: 'claim',
      claimant: state.turn,
      intendedMove: null,
    },
  }
}

function restoreClaimedResult(state: ChessGameState, value: Record<string, unknown>): ChessGameState {
  const reason = value.reason
  const claimant = value.claimant
  const intendedMoveText = value.intendedMove
  if ((reason !== 'threefold-repetition' && reason !== 'fifty-move') || claimant !== state.turn) {
    throw new Error('国际象棋档案和棋申请信息无效。')
  }
  const intendedMove = typeof intendedMoveText === 'string' ? parseArchivedMove(intendedMoveText) : undefined
  if (intendedMoveText !== null && !intendedMove) throw new Error('国际象棋档案声明着法无效。')
  const valid = reason === 'threefold-repetition'
    ? canClaimThreefold(state, intendedMove)
    : canClaimFiftyMove(state, intendedMove)
  if (!valid) throw new Error('国际象棋档案和棋申请不满足规则。')
  return {
    ...state,
    phase: 'finished',
    result: {
      winner: null,
      loser: null,
      reason,
      termination: 'claim',
      claimant: state.turn,
      intendedMove: intendedMoveText as string | null,
    },
  }
}

function parseArchivedMove(value: string) {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(value)
  if (!match) return undefined
  return { from: match[1] as import('./types').ChessSquare, to: match[2] as import('./types').ChessSquare, ...(match[3] ? { promotion: match[3] as import('./types').ChessPromotion } : {}) }
}

function terminationLabel(result: ChessGameResult): string {
  if (result.termination === 'claim') {
    const move = result.intendedMove ? ` with declared move ${result.intendedMove}` : ''
    return `${result.claimant === 'w' ? 'White' : 'Black'} claimed ${result.reason}${move}`
  }
  return result.reason
}
