import { applyMove, opposite } from '../game/board'
import { findGeneral, getLegalCaptures, getLegalMoves, isInCheck } from '../game/rules'
import type {
  BoardState,
  Color,
  Move,
  PieceType,
  SearchCandidate,
  SearchInfo,
  Wdl,
} from '../game/types'
import { matchUcciMove } from './ucci'

export type PersonalityPhase = 'middlegame' | 'complex' | 'endgame'

export interface AiPersonality {
  id: 'aggressive-red' | 'solid-black'
  name: string
  summary: string
  candidatePolicy: {
    rewards: readonly string[]
    penalties: readonly string[]
  }
}

export const AI_PERSONALITIES: Record<Color, AiPersonality> = {
  red: {
    id: 'aggressive-red',
    name: '进攻型',
    summary: '中炮为主，近优着偏主动与复杂',
    candidatePolicy: {
      rewards: ['主动进攻', '将军机会', '控制中心', '保留进攻子力', '提高局面复杂度'],
      penalties: ['过早简化', '无主动收益的兑子'],
    },
  },
  black: {
    id: 'solid-black',
    name: '稳健型',
    summary: '屏风马为主，近优着偏安全与简化',
    candidatePolicy: {
      rewards: ['王安全', '结构稳定', '减少风险', '改善残局', '优势局面简化'],
      penalties: ['无必要冒险', '过度进攻', '没有收益的复杂化'],
    },
  },
}

export const PERSONALITY_RUNTIME = {
  implementationPhase: 3,
  multiPvPolicy: 'dynamic-4-3-2',
  candidateSelectionEnabled: true,
  thresholdsCp: {
    middlegame: [40, 60, 80],
    complex: [60, 80],
    endgame: [25, 40, 60, 80],
  },
  maxExpectedScoreLossPermille: 20,
  maxLossIncreasePermille: 50,
  minCandidateDepth: 12,
  decisiveAdvantageCp: 400,
  decisiveWinPermille: 850,
  qualityPenaltyPerCp: 0.5,
  qualityPenaltyPerExpectationPermille: 0.5,
  maxCpGapDrift: 30,
  maxExpectationGapDriftPermille: 15,
} as const

export interface PersonalitySelectionInput {
  board: BoardState
  color: Color
  legalMoves: Move[]
  bestmove: string | null
  bestInfo: SearchInfo
  candidates: SearchCandidate[]
  seed: number
}

export interface PersonalityMoveDecision {
  ucci: string | null
  info: SearchInfo
  phase: PersonalityPhase
  thresholdCp: number | null
  usedPersonality: boolean
  reason: 'personality' | 'forced-best' | 'insufficient-safe-candidates'
}

interface EligibleCandidate {
  candidate: SearchCandidate
  move: Move
  ucci: string
  styleScore: number
}

export function selectPersonalityMove(input: PersonalitySelectionInput): PersonalityMoveDecision {
  const { board, color, legalMoves, bestmove, bestInfo, candidates, seed } = input
  const phase = classifyPersonalityPhase(board, color)
  const fallback = (
    reason: PersonalityMoveDecision['reason'],
  ): PersonalityMoveDecision => ({
    ucci: bestmove,
    info: bestInfo,
    phase,
    thresholdCp: null,
    usedPersonality: false,
    reason,
  })

  if (!PERSONALITY_RUNTIME.candidateSelectionEnabled) return fallback('forced-best')
  if (!bestmove || legalMoves.length < 2 || isInCheck(board, color)) return fallback('forced-best')

  const engineBestMove = matchUcciMove(board, legalMoves, bestmove)
  if (!engineBestMove) return fallback('forced-best')
  const afterBest = applyMove(board, engineBestMove)
  if (getLegalMoves(afterBest, opposite(color)).length === 0) return fallback('forced-best')
  if (allowsForcingCheckWithAtMostOneReply(board, color, engineBestMove)) {
    return fallback('forced-best')
  }

  const principal = candidates.find((candidate) => candidate.multipv === 1)
  if (
    !principal ||
    principal.pv[0] !== bestmove ||
    !principal.score ||
    principal.score.kind !== 'cp' ||
    !principal.wdl
  ) {
    return fallback('forced-best')
  }

  // A mate score, a heavily losing evaluation, or a dominant loss probability
  // is treated as a tactical emergency: personality must not override defence.
  if (
    bestInfo.score?.kind === 'mate' ||
    principal.depth < PERSONALITY_RUNTIME.minCandidateDepth ||
    principal.score.value <= -200 ||
    principal.score.value >= PERSONALITY_RUNTIME.decisiveAdvantageCp ||
    principal.wdl.win >= PERSONALITY_RUNTIME.decisiveWinPermille ||
    principal.wdl.loss >= 700
  ) {
    return fallback('forced-best')
  }

  let eligible: EligibleCandidate[] = []
  let chosenThreshold: number | null = null
  for (const threshold of thresholdsForPhase(phase)) {
    eligible = collectEligibleCandidates(
      board,
      color,
      legalMoves,
      principal,
      candidates,
      threshold,
    )
    if (eligible.length >= 2) {
      chosenThreshold = threshold
      break
    }
  }

  if (eligible.length < 2 || chosenThreshold === null || !eligible.some(({ ucci }) => ucci === bestmove)) {
    return fallback('insufficient-safe-candidates')
  }

  for (const choice of eligible) {
    choice.styleScore = scoreCandidate(color, board, choice.move, choice.candidate, principal)
  }
  const highest = Math.max(...eligible.map((choice) => choice.styleScore))
  const tied = eligible
    .filter((choice) => choice.styleScore === highest)
    .sort((left, right) => left.candidate.multipv - right.candidate.multipv)
  const selected = tied[randomIndex(seed, tied.length)]

  return {
    ucci: selected.ucci,
    info: selected.candidate,
    phase,
    thresholdCp: chosenThreshold,
    usedPersonality: selected.ucci !== bestmove,
    reason: 'personality',
  }
}

export function classifyPersonalityPhase(board: BoardState, color: Color): PersonalityPhase {
  const nonGeneralPieces = board.flat().filter((piece) => piece && piece.type !== 'general').length
  if (nonGeneralPieces <= 10) return 'endgame'
  const captures = getLegalCaptures(board, color).length
  return captures >= 3 ? 'complex' : 'middlegame'
}

function thresholdsForPhase(phase: PersonalityPhase): readonly number[] {
  return PERSONALITY_RUNTIME.thresholdsCp[phase]
}

function collectEligibleCandidates(
  board: BoardState,
  color: Color,
  legalMoves: Move[],
  principal: SearchCandidate,
  candidates: SearchCandidate[],
  thresholdCp: number,
): EligibleCandidate[] {
  const unique = new Map<string, EligibleCandidate>()
  for (const candidate of candidates) {
    const ucci = candidate.pv[0]
    if (
      !ucci ||
      !candidate.score ||
      candidate.score.kind !== 'cp' ||
      !candidate.wdl ||
      candidate.depth !== principal.depth ||
      principal.score?.kind !== 'cp' ||
      candidate.score.value < principal.score.value - thresholdCp ||
      !preservesWinningChances(principal.wdl!, candidate.wdl) ||
      !hasStableNearOptimalGap(principal, candidate, thresholdCp)
    ) {
      continue
    }
    const move = matchUcciMove(board, legalMoves, ucci)
    if (
      !move ||
      unique.has(ucci) ||
      (candidate.multipv !== 1 && allowsForcingCheckWithAtMostOneReply(board, color, move))
    ) {
      continue
    }
    unique.set(ucci, { candidate, move, ucci, styleScore: 0 })
  }
  return [...unique.values()]
}

function preservesWinningChances(principal: Wdl, candidate: Wdl): boolean {
  const principalExpectation = principal.win + principal.draw / 2
  const candidateExpectation = candidate.win + candidate.draw / 2
  return (
    principalExpectation - candidateExpectation <=
      PERSONALITY_RUNTIME.maxExpectedScoreLossPermille &&
    candidate.loss - principal.loss <= PERSONALITY_RUNTIME.maxLossIncreasePermille
  )
}

function hasStableNearOptimalGap(
  principal: SearchCandidate,
  candidate: SearchCandidate,
  thresholdCp: number,
): boolean {
  const principalPrevious = principal.previousPrincipal
  const candidatePrevious = candidate.previous
  if (
    !principalPrevious ||
    !candidatePrevious ||
    principalPrevious.depth !== principal.depth - 1 ||
    candidatePrevious.depth !== candidate.depth - 1 ||
    principal.score?.kind !== 'cp' ||
    candidate.score?.kind !== 'cp' ||
    principalPrevious.score?.kind !== 'cp' ||
    candidatePrevious.score?.kind !== 'cp' ||
    !principalPrevious.wdl ||
    !candidatePrevious.wdl
  ) {
    return false
  }
  const previousCpGap = principalPrevious.score.value - candidatePrevious.score.value
  const currentCpGap = principal.score.value - candidate.score.value
  const previousExpectationGap = expectation(principalPrevious.wdl) - expectation(candidatePrevious.wdl)
  const currentExpectationGap = expectation(principal.wdl!) - expectation(candidate.wdl!)
  return (
    previousCpGap <= thresholdCp &&
    preservesWinningChances(principalPrevious.wdl, candidatePrevious.wdl) &&
    Math.abs(currentCpGap - previousCpGap) <= PERSONALITY_RUNTIME.maxCpGapDrift &&
    Math.abs(currentExpectationGap - previousExpectationGap) <=
      PERSONALITY_RUNTIME.maxExpectationGapDriftPermille
  )
}

function expectation(wdl: Wdl): number {
  return wdl.win + wdl.draw / 2
}

/**
 * A bounded tactical guard for forced defence. If the move lets the opponent give
 * an immediate check with at most one legal reply, choosing a stylistically nicer
 * alternative would be unsafe. This deliberately includes a single *safe* reply:
 * in that forcing situation the engine's first choice remains authoritative.
 */
function allowsForcingCheckWithAtMostOneReply(board: BoardState, color: Color, move: Move): boolean {
  const after = applyMove(board, move)
  const opponent = opposite(color)
  for (const reply of getLegalMoves(after, opponent)) {
    const afterReply = applyMove(after, reply)
    if (isInCheck(afterReply, color) && getLegalMoves(afterReply, color).length <= 1) return true
  }
  return false
}

function scoreCandidate(
  color: Color,
  board: BoardState,
  move: Move,
  candidate: SearchCandidate,
  principal: SearchCandidate,
): number {
  const after = applyMove(board, move)
  const opponent = opposite(color)
  const opponentMoves = getLegalMoves(after, opponent)
  const ownMoves = getLegalMoves(after, color)
  const opponentCaptures = opponentMoves.filter((reply) => reply.captured).length
  const ownCaptures = ownMoves.filter((attack) => attack.captured).length
  const opponentChecks = opponentMoves.filter((reply) =>
    isInCheck(applyMove(after, reply), color),
  ).length
  const ownChecks = ownMoves.filter((attack) =>
    isInCheck(applyMove(after, attack), opponent),
  ).length
  const givesCheck = isInCheck(after, opponent)
  const immediateRecapture = isRecapturedInPv(after, opponent, move, candidate)
  const movedPieceExposed = opponentMoves.some((reply) => reply.captured?.id === move.piece.id)
  const captureValue = move.captured ? PIECE_VALUES[move.captured.type] : 0
  const movingValue = PIECE_VALUES[move.piece.type]
  const central = move.to.col >= 3 && move.to.col <= 5
  const forward = color === 'red' ? move.to.row < move.from.row : move.to.row > move.from.row
  const centerControl = ownMoves.filter(
    (attack) =>
      attack.to.col >= 3 &&
      attack.to.col <= 5 &&
      attack.to.row >= 3 &&
      attack.to.row <= 6,
  ).length
  const ownKingPressure = countKingZoneMoves(ownMoves, findGeneral(after, opponent))
  const opponentKingPressure = countKingZoneMoves(opponentMoves, findGeneral(after, color))
  const ownKingDefenders = countKingDefenders(after, color)
  const complexity = ownCaptures + opponentCaptures + ownChecks + opponentChecks

  if (color === 'red') {
    let score = 0
    if (givesCheck) score += 55
    if (central) score += 10
    if (forward) score += 6
    score += Math.min(16, centerControl * 2)
    score += Math.min(24, ownKingPressure * 4)
    score += Math.min(20, ownChecks * 5)
    if (isAttackingPiece(move.piece.type) && !movedPieceExposed) score += 12
    score += captureValue * 3
    score += Math.min(24, complexity * 2)
    if (movedPieceExposed) score -= movingValue * 4
    if (immediateRecapture) score -= 20 + movingValue * 3
    if (move.captured && !givesCheck && immediateRecapture) score -= 8
    return applyQualityPenalty(score, candidate, principal)
  }

  let score = 0
  score -= opponentChecks * 18
  score -= opponentCaptures * 3
  score -= opponentKingPressure * 5
  score += Math.min(20, ownKingDefenders * 4)
  if (move.piece.type === 'advisor' || move.piece.type === 'elephant') score += 24
  if (move.captured) score += 8 + captureValue * 3
  if (immediateRecapture && move.captured) score += 18
  if (movedPieceExposed) score -= movingValue * 5
  if (principal.score?.kind === 'cp' && principal.score.value >= 100 && (move.captured || immediateRecapture)) {
    score += 20
  }
  if (classifyPersonalityPhase(after, opponent) === 'endgame' && move.captured) score += 12
  if (principal.score?.kind === 'cp' && principal.score.value < 100) score -= Math.min(20, complexity * 2)
  if (givesCheck && !move.captured) score -= 5
  return applyQualityPenalty(score, candidate, principal)
}

function applyQualityPenalty(
  styleScore: number,
  candidate: SearchCandidate,
  principal: SearchCandidate,
): number {
  const cpLoss =
    candidate.score?.kind === 'cp' && principal.score?.kind === 'cp'
      ? Math.max(0, principal.score.value - candidate.score.value)
      : 80
  const expectationLoss =
    candidate.wdl && principal.wdl
      ? Math.max(
          0,
          principal.wdl.win + principal.wdl.draw / 2 -
            (candidate.wdl.win + candidate.wdl.draw / 2),
        )
      : PERSONALITY_RUNTIME.maxExpectedScoreLossPermille
  return (
    styleScore -
    cpLoss * PERSONALITY_RUNTIME.qualityPenaltyPerCp -
    expectationLoss * PERSONALITY_RUNTIME.qualityPenaltyPerExpectationPermille -
    (candidate.multipv - 1)
  )
}

function countKingZoneMoves(moves: Move[], general: { row: number; col: number } | null): number {
  if (!general) return 0
  return moves.filter(
    (move) => Math.abs(move.to.row - general.row) + Math.abs(move.to.col - general.col) <= 2,
  ).length
}

function countKingDefenders(board: BoardState, color: Color): number {
  const general = findGeneral(board, color)
  if (!general) return 0
  let defenders = 0
  for (let row = Math.max(0, general.row - 2); row <= Math.min(9, general.row + 2); row += 1) {
    for (let col = Math.max(0, general.col - 2); col <= Math.min(8, general.col + 2); col += 1) {
      const piece = board[row][col]
      if (
        piece?.color === color &&
        piece.type !== 'general' &&
        Math.abs(row - general.row) + Math.abs(col - general.col) <= 2
      ) {
        defenders += 1
      }
    }
  }
  return defenders
}

function isRecapturedInPv(
  boardAfterMove: BoardState,
  opponent: Color,
  move: Move,
  candidate: SearchCandidate,
): boolean {
  const reply = candidate.pv[1]
  if (!reply) return false
  const replyMove = matchUcciMove(boardAfterMove, getLegalMoves(boardAfterMove, opponent), reply)
  return replyMove?.captured?.id === move.piece.id
}

function isAttackingPiece(piece: PieceType): boolean {
  return piece === 'chariot' || piece === 'cannon' || piece === 'horse'
}

function randomIndex(seed: number, length: number): number {
  if (length <= 1) return 0
  let value = seed >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d) >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b) >>> 0
  value ^= value >>> 16
  return (value >>> 0) % length
}

const PIECE_VALUES: Record<PieceType, number> = {
  general: 100,
  chariot: 9,
  cannon: 5,
  horse: 4,
  advisor: 2,
  elephant: 2,
  soldier: 1,
}
