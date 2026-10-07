import { opposite } from '../game/board'
import { getLegalCaptures, getLegalMoves, isInCheck } from '../game/rules'
import type { BoardState, Color, Move, Piece } from '../game/types'
import { evaluateFor, PIECE_VALUES } from './evaluate'
import { hashPosition, hashAfterMove } from './zobrist'

const MATE_SCORE = 100_000
const MATE_THRESHOLD = 90_000
const INFINITY = 1_000_000
const MAX_QUIESCENCE_PLY = 8
const MAX_TABLE_ENTRIES = 180_000

class SearchTimeout extends Error {}

interface TableEntry {
  depth: number
  score: number
  flag: 'exact' | 'lower' | 'upper'
  bestMove: number | null
}

interface RootEntry {
  move: Move
  score: number
}

export interface SearchResult {
  move: Move | null
  score: number
  depth: number
  nodes: number
  elapsedMs: number
}

export interface SearchOptions {
  transpositionTable?: boolean
  /** Fixed-horizon comparison: no order-dependent reductions or path draw heuristic. */
  comparison?: boolean
}

function makeMove(
  board: BoardState,
  move: Move,
  hash: bigint,
): { captured: Piece | null; hash: bigint } {
  const captured = board[move.to.row][move.to.col]
  const nextHash = hashAfterMove(hash, move, captured)

  board[move.from.row][move.from.col] = null
  board[move.to.row][move.to.col] = move.piece
  return { captured, hash: nextHash }
}

function undoMove(board: BoardState, move: Move, captured: Piece | null): void {
  board[move.from.row][move.from.col] = move.piece
  board[move.to.row][move.to.col] = captured
}

function moveCode(move: Move): number {
  return (move.from.row * 9 + move.from.col) * 90 + move.to.row * 9 + move.to.col
}

function capturePriority(move: Move): number {
  if (!move.captured) return 0
  return PIECE_VALUES[move.captured.type] * 16 - PIECE_VALUES[move.piece.type]
}

function tieBreaker(move: Move, seed: number): number {
  let value = (seed ^ Math.imul(moveCode(move) + 1, 0x9e3779b1)) >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

function tableScore(score: number, ply: number): number {
  if (score > MATE_THRESHOLD) return score + ply
  if (score < -MATE_THRESHOLD) return score - ply
  return score
}

function restoredTableScore(score: number, ply: number): number {
  if (score > MATE_THRESHOLD) return score - ply
  if (score < -MATE_THRESHOLD) return score + ply
  return score
}

export function searchBestMove(
  board: BoardState,
  color: Color,
  timeBudgetMs: number,
  seed: number,
  maxDepth = 12,
  options: SearchOptions = {},
): SearchResult {
  const useTable = options.transpositionTable !== false
  const comparison = options.comparison === true
  const startedAt = performance.now()
  const deadline = startedAt + Math.max(20, timeBudgetMs)
  const table = new Map<bigint, TableEntry>()
  const killers: Array<[number | null, number | null]> = []
  const history = new Map<number, number>()
  const path = new Set<bigint>()
  let nodes = 0

  const checkDeadline = (force = false) => {
    if ((force || (nodes & 63) === 0) && performance.now() >= deadline) {
      throw new SearchTimeout()
    }
  }

  const ordered = (
    moves: Move[],
    hashMove: number | null,
    ply: number,
    rootSeed?: number,
  ): Move[] => {
    const plyKillers = killers[ply] ?? [null, null]
    return moves.slice().sort((a, b) => {
      const score = (move: Move) => {
        const code = moveCode(move)
        if (code === hashMove) return 2_000_000
        if (move.captured) return 1_000_000 + capturePriority(move)
        if (code === plyKillers[0]) return 900_000
        if (code === plyKillers[1]) return 850_000
        return history.get(code) ?? 0
      }
      const difference = score(b) - score(a)
      if (difference !== 0) return difference
      if (rootSeed !== undefined) return tieBreaker(b, rootSeed) - tieBreaker(a, rootSeed)
      return moveCode(a) - moveCode(b)
    })
  }

  const recordQuietCutoff = (move: Move, depth: number, ply: number) => {
    const code = moveCode(move)
    const plyKillers = killers[ply] ?? [null, null]
    if (plyKillers[0] !== code) {
      killers[ply] = [code, plyKillers[0]]
    }
    history.set(code, Math.min(200_000, (history.get(code) ?? 0) + depth * depth * 16))
  }

  const quiescence = (
    currentBoard: BoardState,
    side: Color,
    hash: bigint,
    alphaInput: number,
    beta: number,
    ply: number,
    quiescencePly: number,
  ): number => {
    nodes += 1
    checkDeadline()

    const pathKey = hash
    if (!comparison && path.has(pathKey)) return 0
    path.add(pathKey)

    try {
      const checked = isInCheck(currentBoard, side)
      let alpha = alphaInput
      let standPat = -INFINITY
      let candidates: Move[]

      if (checked) {
        candidates = getLegalMoves(currentBoard, side)
        if (candidates.length === 0) return -MATE_SCORE + ply

        if (quiescencePly >= MAX_QUIESCENCE_PLY) {
          let bestEvasion = -INFINITY
          for (const move of ordered(candidates, null, ply)) {
            const made = makeMove(currentBoard, move, hash)
            try {
              bestEvasion = Math.max(
                bestEvasion,
                -evaluateFor(currentBoard, opposite(side)),
              )
            } finally {
              undoMove(currentBoard, move, made.captured)
            }
          }
          return bestEvasion
        }
      } else {
        standPat = evaluateFor(currentBoard, side)
        if (standPat >= beta) return standPat
        if (standPat > alpha) alpha = standPat
        if (quiescencePly >= MAX_QUIESCENCE_PLY) return alpha
        candidates = getLegalCaptures(currentBoard, side)
        if (candidates.length === 0) return alpha
      }

      for (const move of ordered(candidates, null, ply)) {
        if (
          !comparison && !checked &&
          move.captured &&
          standPat + PIECE_VALUES[move.captured.type] + 180 < alpha
        ) {
          continue
        }

        const made = makeMove(currentBoard, move, hash)
        let score = -INFINITY
        try {
          score = -quiescence(
            currentBoard,
            opposite(side),
            made.hash,
            -beta,
            -alpha,
            ply + 1,
            quiescencePly + 1,
          )
        } finally {
          undoMove(currentBoard, move, made.captured)
        }

        if (score >= beta) return score
        if (score > alpha) alpha = score
      }
      return alpha
    } finally {
      path.delete(pathKey)
    }
  }

  const negamax = (
    currentBoard: BoardState,
    side: Color,
    hash: bigint,
    depthInput: number,
    alphaInput: number,
    betaInput: number,
    ply: number,
    checkExtensionsLeft: number,
  ): number => {
    nodes += 1
    checkDeadline()

    const pathKey = hash
    if (!comparison && path.has(pathKey)) return 0

    const checked = isInCheck(currentBoard, side)
    let depth = depthInput
    let extensionsLeft = checkExtensionsLeft
    if (!comparison && checked && extensionsLeft > 0) {
      depth += 1
      extensionsLeft -= 1
    }
    if (depth <= 0) {
      return quiescence(currentBoard, side, hash, alphaInput, betaInput, ply, 0)
    }

    path.add(pathKey)
    try {
      let alpha = alphaInput
      let beta = betaInput
      const originalAlpha = alpha
      const originalBeta = beta
      const usableCache = useTable ? table.get(hash) : undefined

      if (usableCache && (comparison ? usableCache.depth === depth : usableCache.depth >= depth)) {
        const score = restoredTableScore(usableCache.score, ply)
        if (usableCache.flag === 'exact') return score
        if (usableCache.flag === 'lower') alpha = Math.max(alpha, score)
        if (usableCache.flag === 'upper') beta = Math.min(beta, score)
        if (alpha >= beta) return score
      }

      const moves = getLegalMoves(currentBoard, side)
      if (moves.length === 0) {
        return checked ? -MATE_SCORE + ply : -MATE_SCORE + 200 + ply
      }

      const hashMove = usableCache?.bestMove ?? null
      const sortedMoves = ordered(moves, hashMove, ply)
      let best = -INFINITY
      let bestMove: number | null = null

      for (let index = 0; index < sortedMoves.length; index += 1) {
        const move = sortedMoves[index]
        const made = makeMove(currentBoard, move, hash)
        const childDepth = depth - 1
        let score = -INFINITY

        try {
          if (index === 0) {
            score = -negamax(
              currentBoard,
              opposite(side),
              made.hash,
              childDepth,
              -beta,
              -alpha,
              ply + 1,
              extensionsLeft,
            )
          } else {
            const quiet = !move.captured
            const reduction =
              !comparison && quiet && !checked && childDepth >= 2 && index >= 4
                ? childDepth >= 5 && index >= 10
                  ? 2
                  : 1
                : 0

            score = -negamax(
              currentBoard,
              opposite(side),
              made.hash,
              childDepth - reduction,
              -alpha - 1,
              -alpha,
              ply + 1,
              extensionsLeft,
            )

            if (reduction > 0 && score > alpha) {
              score = -negamax(
                currentBoard,
                opposite(side),
                made.hash,
                childDepth,
                -alpha - 1,
                -alpha,
                ply + 1,
                extensionsLeft,
              )
            }
            if (score > alpha && score < beta) {
              score = -negamax(
                currentBoard,
                opposite(side),
                made.hash,
                childDepth,
                -beta,
                -alpha,
                ply + 1,
                extensionsLeft,
              )
            }
          }
        } finally {
          undoMove(currentBoard, move, made.captured)
        }

        if (score > best) {
          best = score
          bestMove = moveCode(move)
        }
        if (score > alpha) alpha = score
        if (alpha >= beta) {
          if (!move.captured) recordQuietCutoff(move, depth, ply)
          break
        }
      }

      const flag = best <= originalAlpha ? 'upper' : best >= originalBeta ? 'lower' : 'exact'
      const existing = useTable ? table.get(hash) : undefined
      if (useTable && (
        table.size < MAX_TABLE_ENTRIES ||
        existing !== undefined
      )) {
        table.set(hash, {
          depth,
          score: tableScore(best, ply),
          flag,
          bestMove,
        })
      }
      return best
    } finally {
      path.delete(pathKey)
    }
  }

  const rootHash = hashPosition(board, color)
  const rootMoves = getLegalMoves(board, color)
  if (rootMoves.length === 0) {
    return {
      move: null,
      score: -MATE_SCORE,
      depth: 0,
      nodes,
      elapsedMs: performance.now() - startedAt,
    }
  }

  let rootEntries: RootEntry[] = ordered(rootMoves, null, 0, seed).map((move) => {
    const made = makeMove(board, move, rootHash)
    try {
      return { move, score: evaluateFor(board, color) }
    } finally {
      undoMove(board, move, made.captured)
    }
  })
  rootEntries.sort((a, b) => b.score - a.score)

  let completedMove = rootEntries[0].move
  let completedScore = rootEntries[0].score
  let completedDepth = 0
  const rootPathKey = rootHash
  path.add(rootPathKey)

  try {
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      try {
        checkDeadline(true)
        let alpha = -INFINITY
        let iterationBest: RootEntry | null = null
        const iterationEntries: RootEntry[] = []

        for (let index = 0; index < rootEntries.length; index += 1) {
          checkDeadline(true)
          const move = rootEntries[index].move
          const made = makeMove(board, move, rootHash)
          let score = -INFINITY

          try {
            if (index === 0) {
              score = -negamax(
                board,
                opposite(color),
                made.hash,
                depth - 1,
                -INFINITY,
                INFINITY,
                1,
                2,
              )
            } else {
              score = -negamax(
                board,
                opposite(color),
                made.hash,
                depth - 1,
                -alpha - 1,
                -alpha,
                1,
                2,
              )
              if (score > alpha) {
                score = -negamax(
                  board,
                  opposite(color),
                  made.hash,
                  depth - 1,
                  -INFINITY,
                  -alpha,
                  1,
                  2,
                )
              }
            }
          } finally {
            undoMove(board, move, made.captured)
          }

          const entry = { move, score }
          iterationEntries.push(entry)
          if (!iterationBest || score > iterationBest.score) iterationBest = entry
          if (score > alpha) alpha = score
        }

        if (!iterationBest) break
        completedMove = iterationBest.move
        completedScore = iterationBest.score
        completedDepth = depth
        if (!comparison) rootEntries = [
          iterationBest,
          ...iterationEntries
            .filter((entry) => entry !== iterationBest)
            .sort((a, b) => b.score - a.score),
        ]

        if (!comparison && completedScore > MATE_SCORE - 500) break
      } catch (error) {
        if (!(error instanceof SearchTimeout)) throw error
        break
      }
    }
  } finally {
    path.delete(rootPathKey)
  }

  return {
    move: completedMove,
    score: completedScore,
    depth: completedDepth,
    nodes,
    elapsedMs: performance.now() - startedAt,
  }
}
