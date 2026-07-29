import { applyMove, opposite, positionKey } from '../game/board'
import { isInCheck, getLegalMoves } from '../game/rules'
import type { BoardState, Color, Move } from '../game/types'
import { evaluateFor, PIECE_VALUES } from './evaluate'

const MATE_SCORE = 100_000
const QUIESCENCE_DEPTH = 2

class SearchTimeout extends Error {}

interface TableEntry {
  depth: number
  score: number
  flag: 'exact' | 'lower' | 'upper'
}

export interface SearchResult {
  move: Move | null
  score: number
  depth: number
  nodes: number
  elapsedMs: number
}

function movePriority(move: Move): number {
  if (!move.captured) return 0
  return PIECE_VALUES[move.captured.type] * 10 - PIECE_VALUES[move.piece.type]
}

function ordered(moves: Move[]): Move[] {
  return moves.slice().sort((a, b) => movePriority(b) - movePriority(a))
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4_294_967_296
  }
}

export function searchBestMove(
  board: BoardState,
  color: Color,
  timeBudgetMs: number,
  seed: number,
  maxDepth = 5,
): SearchResult {
  const startedAt = performance.now()
  const deadline = startedAt + Math.max(30, timeBudgetMs)
  const table = new Map<string, TableEntry>()
  let nodes = 0

  const checkDeadline = () => {
    if ((nodes & 127) === 0 && performance.now() >= deadline) throw new SearchTimeout()
  }

  const quiescence = (
    currentBoard: BoardState,
    side: Color,
    alphaInput: number,
    beta: number,
    depthLeft: number,
  ): number => {
    nodes += 1
    checkDeadline()
    let alpha = alphaInput
    const standPat = evaluateFor(currentBoard, side)
    if (standPat >= beta) return beta
    if (standPat > alpha) alpha = standPat
    if (depthLeft <= 0) return alpha

    const allMoves = getLegalMoves(currentBoard, side)
    const candidates = isInCheck(currentBoard, side)
      ? allMoves
      : allMoves.filter((move) => move.captured)
    for (const move of ordered(candidates)) {
      const score = -quiescence(
        applyMove(currentBoard, move),
        opposite(side),
        -beta,
        -alpha,
        depthLeft - 1,
      )
      if (score >= beta) return beta
      if (score > alpha) alpha = score
    }
    return alpha
  }

  const negamax = (
    currentBoard: BoardState,
    side: Color,
    depth: number,
    alphaInput: number,
    betaInput: number,
    ply: number,
  ): number => {
    nodes += 1
    checkDeadline()

    const key = `${positionKey(currentBoard, side)}:${depth}`
    const cached = table.get(key)
    let alpha = alphaInput
    const originalAlpha = alpha
    if (cached && cached.depth >= depth) {
      if (cached.flag === 'exact') return cached.score
      if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score)
      if (cached.flag === 'upper') betaInput = Math.min(betaInput, cached.score)
      if (alpha >= betaInput) return cached.score
    }

    const moves = getLegalMoves(currentBoard, side)
    if (moves.length === 0) {
      // Both are wins, but prefer delivering checkmate over a quiet stalemate.
      return isInCheck(currentBoard, side) ? -MATE_SCORE + ply : -MATE_SCORE + 200 + ply
    }
    if (depth === 0) {
      return quiescence(currentBoard, side, alpha, betaInput, QUIESCENCE_DEPTH)
    }

    let best = -Infinity
    for (const move of ordered(moves)) {
      const score = -negamax(
        applyMove(currentBoard, move),
        opposite(side),
        depth - 1,
        -betaInput,
        -alpha,
        ply + 1,
      )
      if (score > best) best = score
      if (score > alpha) alpha = score
      if (alpha >= betaInput) break
    }

    const flag = best <= originalAlpha ? 'upper' : best >= betaInput ? 'lower' : 'exact'
    table.set(key, { depth, score: best, flag })
    return best
  }

  const rootMoves = ordered(getLegalMoves(board, color))
  if (rootMoves.length === 0) {
    return {
      move: null,
      score: -MATE_SCORE,
      depth: 0,
      nodes,
      elapsedMs: performance.now() - startedAt,
    }
  }

  let completedDepth = 0
  let completedScores = rootMoves.map((move) => ({ move, score: evaluateFor(applyMove(board, move), color) }))

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      const depthScores: Array<{ move: Move; score: number }> = []
      let alpha = -Infinity
      for (const move of rootMoves) {
        checkDeadline()
        const score = -negamax(
          applyMove(board, move),
          opposite(color),
          depth - 1,
          -Infinity,
          -alpha,
          1,
        )
        depthScores.push({ move, score })
        if (score > alpha) alpha = score
      }
      completedScores = depthScores.sort((a, b) => b.score - a.score)
      completedDepth = depth
      if (completedScores[0].score > MATE_SCORE - 500) break
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error
      break
    }
  }

  const bestScore = completedScores[0].score
  const nearBest = completedScores.filter((entry) => bestScore - entry.score <= 35).slice(0, 3)
  const random = seededRandom(seed)
  const selected = nearBest[Math.floor(random() * nearBest.length)] ?? completedScores[0]

  return {
    move: selected.move,
    score: selected.score,
    depth: completedDepth,
    nodes,
    elapsedMs: performance.now() - startedAt,
  }
}
