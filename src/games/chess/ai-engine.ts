import { Chess } from 'chess.js'
import type { EngineAdapter } from '../../engine/adapter'
import type { EngineSearchOptions } from '../../engine/types'
import type { EngineProfile, EngineSearchResponse, SearchCandidate, SearchInfo } from '../../game/types'
import type { AIEngine, AIThinkRequest, AIThinkResult } from '../core'
import { actionToUci, canClaimFiftyMove, canClaimThreefold, isChessMoveAction, parseChessUci, replayChess } from './rules'
import { CHESS_OPENINGS } from './openings'
import type { ChessAction, ChessClaimReason, ChessColor, ChessGameState, ChessMoveAction, ChessMoveRecord, ChessPersonality, ChessPersonalityId, ChessSearchProfile, ChessTurnAnalysis } from './types'

export const CHESS_PERSONALITIES: Record<ChessPersonalityId, ChessPersonality> = {
  attack: { id: 'attack', label: '曜刃 · 进攻型', description: '主动将军、中心控制、子力活跃与王翼压力' },
  solid: { id: 'solid', label: '玄垒 · 稳健型', description: '王安全、完成易位、受保护子力与安全简化' },
}

export function chessPersonalityForColor(seed: number, color: ChessColor): ChessPersonalityId {
  const white: ChessPersonalityId = seed % 2 === 0 ? 'attack' : 'solid'
  return color === 'w' ? white : white === 'attack' ? 'solid' : 'attack'
}

export const CHESS_SEARCH_PROFILES: Record<ChessSearchProfile['id'], ChessSearchProfile> = {
  fast: { id: 'fast', label: '快速 1 秒', movetimeMs: 1_000, threads: 1, hashMb: 32, multiPv: 4 },
  standard: { id: 'standard', label: '标准 3 秒', movetimeMs: 3_000, threads: 2, hashMb: 64, multiPv: 4 },
  deep: { id: 'deep', label: '深思 8 秒', movetimeMs: 8_000, threads: 2, hashMb: 64, multiPv: 4 },
}

const EMPTY_INFO: SearchInfo = { depth: 0, nodes: 0, nps: 0, elapsedMs: 0, score: null, wdl: null, pv: [] }

type ChessThinkRequest = AIThinkRequest<ChessGameState, ChessAction, ChessColor, ChessMoveRecord>

export interface ChessAIEngineOptions {
  personality: ChessPersonalityId
  profile: ChessSearchProfile
  onInfo?: (color: ChessColor, rootFen: string, ply: number, info: SearchInfo) => void
}

export class ChessIllegalEngineMoveError extends Error {
  constructor(readonly moveText: string | null) {
    super(`国际象棋引擎返回非法着法：${moveText ?? 'null'}`)
    this.name = 'ChessIllegalEngineMoveError'
  }
}

export class ChessAIEngineAdapter implements AIEngine<ChessGameState, ChessAction, ChessColor, ChessMoveRecord, ChessTurnAnalysis> {
  readonly id: string
  readonly name: string
  private profile: EngineProfile | null = null

  constructor(private readonly adapter: EngineAdapter, private readonly options: ChessAIEngineOptions) {
    this.id = adapter.config.id
    this.name = `${CHESS_PERSONALITIES[options.personality].label} · ${adapter.config.name}`
  }

  get engineProfile(): EngineProfile | null { return this.profile }

  async initialize(): Promise<void> {
    this.profile = await this.adapter.init()
  }

  newGame(): void { this.adapter.newGame() }

  async think(request: ChessThinkRequest): Promise<AIThinkResult<ChessAction, ChessTurnAnalysis>> {
    if (request.signal?.aborted) throw new DOMException('国际象棋搜索已取消。', 'AbortError')
    if (canClaimFiftyMove(request.state)) {
      return drawClaimDecision(request, 'fifty-move')
    }
    const legalMoves = request.legalActions.filter(isChessMoveAction)
    const opening = CHESS_OPENINGS.find((candidate) => candidate.id === request.state.openingId)
    const openingUci = opening?.moves[request.record.length]
    if (openingUci) {
      const openingAction = findLegalAction(legalMoves, openingUci)
      if (openingAction) {
        await wait(360, request.signal)
        return {
          action: openingAction,
          analysis: {
            rootFen: request.state.fen,
            color: request.player,
            ply: request.record.length,
            info: EMPTY_INFO,
            uci: openingUci,
            source: 'opening',
            budgetMs: 0,
            multiPv: 4,
          },
        }
      }
    }

    const abortSearch = () => this.adapter.stop('国际象棋 AI 搜索已取消。')
    request.signal?.addEventListener('abort', abortSearch, { once: true })
    try {
      const search: EngineSearchOptions = {
        multiPv: 4,
        onInfo: (info) => this.options.onInfo?.(request.player, request.state.fen, request.record.length, info),
      }
      const response = await this.adapter.search(request.record.map((record) => record.uci), this.options.profile.movetimeMs, search)
      if (request.signal?.aborted) throw new DOMException('国际象棋搜索已取消。', 'AbortError')
      if (!response.bestmove) throw new ChessIllegalEngineMoveError(null)
      const decision = selectChessPersonalityMove({
        state: request.state,
        legalActions: legalMoves,
        response,
        personality: this.options.personality,
        seed: request.state.seed ^ request.record.length,
      })
      const action = decision.action
      return {
        action,
        analysis: {
          rootFen: request.state.fen,
          color: request.player,
          ply: request.record.length,
          info: decision.info,
          uci: isChessMoveAction(action) ? actionToUci(action) : action.intendedMove ? actionToUci(action.intendedMove) : null,
          source: 'engine',
          response,
          budgetMs: this.options.profile.movetimeMs,
          multiPv: 4,
          selectedCandidate: decision.selectedCandidate,
          selectionReason: decision.reason,
          ...(isChessMoveAction(action) ? {} : { claimReason: action.reason }),
        },
      }
    } finally {
      request.signal?.removeEventListener('abort', abortSearch)
    }
  }

  stop(reason?: string): void { this.adapter.stop(reason) }
  dispose(): void { this.profile = null; this.adapter.dispose() }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('国际象棋搜索已取消。', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('国际象棋搜索已取消。', 'AbortError'))
    }, { once: true })
  })
}

interface ChessSelectionInput {
  state: ChessGameState
  legalActions: readonly ChessAction[]
  response: EngineSearchResponse
  personality: ChessPersonalityId
  seed: number
}

interface ChessSelectionResult {
  action: ChessAction
  uci: string | null
  info: SearchInfo
  selectedCandidate?: number
  reason: string
}

/** Enforces the product safety gate before either personality can diverge from PV1. */
export function selectChessPersonalityMove(input: ChessSelectionInput): ChessSelectionResult {
  const { state, response, personality, seed } = input
  const legalActions = input.legalActions.filter(isChessMoveAction)
  const bestmove = response.bestmove
  if (!bestmove) throw new ChessIllegalEngineMoveError(null)
  const bestAction = findLegalAction(legalActions, bestmove)
  if (!bestAction) throw new ChessIllegalEngineMoveError(bestmove)
  const chess = replayChess(state)
  const bestAfter = new Chess(state.fen)
  bestAfter.move({ from: bestAction.from, to: bestAction.to, ...(bestAction.promotion ? { promotion: bestAction.promotion } : {}) })
  if (bestAfter.isCheckmate()) {
    return directMove(bestAction, response.info, 'checkmate-first-choice')
  }
  if (chess.isCheck() || legalActions.length < 2) {
    return moveOrClaim(state, bestAction, response.info, 'forced-first-choice')
  }
  const principal = response.candidates.find((candidate) => candidate.multipv === 1 && candidate.pv[0] === bestmove)
  if (!principal || !isStableCandidate(principal, principal) || principal.score?.kind !== 'cp' || !principal.wdl) {
    return moveOrClaim(state, bestAction, response.info, 'incomplete-candidate-data')
  }
  const principalClaimsDraw = canClaimThreefold(state, bestAction) || canClaimFiftyMove(state, bestAction)
  if (!principalClaimsDraw && (Math.abs(principal.score.value) >= 400 || principal.wdl.win >= 850 || principal.wdl.loss >= 700)) {
    return moveOrClaim(state, bestAction, principal, 'decisive-first-choice')
  }
  const eligible = response.candidates.filter((candidate) => {
    if (candidate.multipv === 1) return true
    const uci = candidate.pv[0]
    const action = uci ? findLegalAction(legalActions, uci) : null
    if (!action || !isStableCandidate(principal, candidate) || candidate.depth !== principal.depth) return false
    if (candidate.score?.kind !== 'cp' || !candidate.wdl) return false
    if (principal.score?.kind !== 'cp' || !principal.wdl) return false
    const expectedGap = expectation(principal.wdl) - expectation(candidate.wdl)
    return principal.score.value - candidate.score.value <= 35 && expectedGap <= 20 && candidate.wdl.loss - principal.wdl.loss <= 50
  })
  const nonRepeating = eligible.filter((candidate) => {
    const action = findLegalAction(legalActions, candidate.pv[0])
    return action && !canClaimThreefold(state, action)
  })
  if (nonRepeating.length === 0) {
    return moveOrClaim(state, bestAction, response.info, 'no-safe-non-repeating-alternative')
  }
  if (eligible.length < 2 && nonRepeating[0]?.pv[0] === bestmove) {
    return moveOrClaim(state, bestAction, response.info, 'no-safe-alternative')
  }
  const scored = nonRepeating.map((candidate) => ({ candidate, score: styleScore(state.fen, candidate.pv[0], personality) }))
  const max = Math.max(...scored.map((entry) => entry.score))
  const tied = scored.filter((entry) => entry.score === max).sort((a, b) => a.candidate.multipv - b.candidate.multipv)
  const selected = tied[randomIndex(seed, tied.length)]
  const selectedAction = findLegalAction(legalActions, selected.candidate.pv[0])!
  return {
    ...moveOrClaim(state, selectedAction, selected.candidate, selected.candidate.pv[0] === bestmove ? 'first-choice-tied' : 'personality-safe-choice'),
    info: selected.candidate,
    selectedCandidate: selected.candidate.multipv,
  }
}

function moveOrClaim(state: ChessGameState, action: ChessMoveAction, info: SearchInfo, reason: string): ChessSelectionResult {
  const claimReason: ChessClaimReason | null = canClaimFiftyMove(state, action)
    ? 'fifty-move'
    : canClaimThreefold(state, action)
      ? 'threefold-repetition'
      : null
  if (claimReason) {
    return {
      action: { kind: 'claim-draw', reason: claimReason, intendedMove: action },
      uci: actionToUci(action),
      info,
      reason: `${claimReason}-claim`,
    }
  }
  return { action, uci: actionToUci(action), info, reason }
}

function directMove(action: ChessMoveAction, info: SearchInfo, reason: string): ChessSelectionResult {
  return { action, uci: actionToUci(action), info, reason }
}

function drawClaimDecision(request: ChessThinkRequest, reason: ChessClaimReason): AIThinkResult<ChessAction, ChessTurnAnalysis> {
  return {
    action: { kind: 'claim-draw', reason },
    analysis: {
      rootFen: request.state.fen,
      color: request.player,
      ply: request.record.length,
      info: EMPTY_INFO,
      uci: null,
      source: 'engine',
      budgetMs: 0,
      multiPv: 4,
      selectionReason: `${reason}-current-position-claim`,
      claimReason: reason,
    },
  }
}

function findLegalAction(actions: readonly ChessMoveAction[], uci: string): ChessMoveAction | null {
  const parsed = parseChessUci(uci)
  return parsed ? actions.find((action) => actionToUci(action) === actionToUci(parsed)) ?? null : null
}

function isStableCandidate(principal: SearchCandidate, candidate: SearchCandidate): boolean {
  if (!principal.previousPrincipal || !candidate.previous) return false
  return principal.previousPrincipal.depth === principal.depth - 1 && candidate.previous.depth === candidate.depth - 1
}

function expectation(wdl: { win: number; draw: number }): number { return wdl.win + wdl.draw / 2 }

function styleScore(fen: string, uci: string, personality: ChessPersonalityId): number {
  const action = parseChessUci(uci)
  if (!action) return Number.NEGATIVE_INFINITY
  const chess = new Chess(fen)
  const move = chess.move({ from: action.from, to: action.to, ...(action.promotion ? { promotion: action.promotion } : {}) })
  let score = 0
  const central = ['c3', 'c4', 'c5', 'c6', 'd3', 'd4', 'd5', 'd6', 'e3', 'e4', 'e5', 'e6', 'f3', 'f4', 'f5', 'f6'].includes(action.to)
  if (personality === 'attack') {
    if (chess.isCheck()) score += 80
    if (move.isCapture()) score += 18
    if (central) score += 12
    if (move.piece === 'n' || move.piece === 'b') score += 6
    if (move.isKingsideCastle() || move.isQueensideCastle()) score -= 2
  } else {
    if (move.isKingsideCastle() || move.isQueensideCastle()) score += 55
    if (move.piece === 'k') score -= 18
    if (move.piece === 'q') score -= 4
    if (central) score += 4
    if (!move.isCapture()) score += 3
  }
  return score
}

function randomIndex(seed: number, length: number): number {
  if (length <= 1) return 0
  let value = seed >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d) >>> 0
  value ^= value >>> 15
  return (value >>> 0) % length
}
