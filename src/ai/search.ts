import { opposite } from '../game/board'
import { getLegalCaptures, getLegalMoves, isInCheck } from '../game/rules'
import type { BoardState, Color, Move, Piece, PieceType } from '../game/types'
import { evaluateFor, PIECE_VALUES } from './evaluate'

const MATE_SCORE = 100_000
const MATE_THRESHOLD = 90_000
const INFINITY = 1_000_000
const MAX_QUIESCENCE_PLY = 8
const MAX_TABLE_ENTRIES = 180_000

class SearchTimeout extends Error {}

interface PositionHash {
  key: number
  lock: number
}

interface TableEntry {
  lock: number
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

const PIECE_INDEX: Record<PieceType, number> = {
  general: 0,
  advisor: 1,
  elephant: 2,
  horse: 3,
  chariot: 4,
  cannon: 5,
  soldier: 6,
}

function createRandomTable(seed: number): number[] {
  let state = seed >>> 0
  const values: number[] = []
  for (let index = 0; index < 90 * 14 + 1; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    values.push(state >>> 0)
  }
  return values
}

const ZOBRIST_KEY = createRandomTable(0x7f4a7c15)
const ZOBRIST_LOCK = createRandomTable(0x94d049bb)
const SIDE_INDEX = 90 * 14

function zobristIndex(piece: Piece, row: number, col: number): number {
  const colorOffset = piece.color === 'red' ? 0 : 7
  return (row * 9 + col) * 14 + colorOffset + PIECE_INDEX[piece.type]
}

function hashPosition(board: BoardState, side: Color): PositionHash {
  let key = 0
  let lock = 0
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col]
      if (!piece) continue
      const index = zobristIndex(piece, row, col)
      key ^= ZOBRIST_KEY[index]
      lock ^= ZOBRIST_LOCK[index]
    }
  }
  if (side === 'black') {
    key ^= ZOBRIST_KEY[SIDE_INDEX]
    lock ^= ZOBRIST_LOCK[SIDE_INDEX]
  }
  return { key: key >>> 0, lock: lock >>> 0 }
}

function makeMove(
  board: BoardState,
  move: Move,
  hash: PositionHash,
): { captured: Piece | null; hash: PositionHash } {
  const captured = board[move.to.row][move.to.col]
  const fromIndex = zobristIndex(move.piece, move.from.row, move.from.col)
  const toIndex = zobristIndex(move.piece, move.to.row, move.to.col)
  let key =
    hash.key ^ ZOBRIST_KEY[fromIndex] ^ ZOBRIST_KEY[toIndex] ^ ZOBRIST_KEY[SIDE_INDEX]
  let lock =
    hash.lock ^ ZOBRIST_LOCK[fromIndex] ^ ZOBRIST_LOCK[toIndex] ^ ZOBRIST_LOCK[SIDE_INDEX]

  if (captured) {
    const capturedIndex = zobristIndex(captured, move.to.row, move.to.col)
    key ^= ZOBRIST_KEY[capturedIndex]
    lock ^= ZOBRIST_LOCK[capturedIndex]
  }

  board[move.from.row][move.from.col] = null
  board[move.to.row][move.to.col] = move.piece
  return { captured, hash: { key: key >>> 0, lock: lock >>> 0 } }
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
): SearchResult {
  const startedAt = performance.now()
  const deadline = startedAt + Math.max(20, timeBudgetMs)
  const table = new Map<number, TableEntry>()
  const killers: Array<[number | null, number | null]> = []
  const history = new Map<number, number>()
  const path = new Set<string>()
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
    hash: PositionHash,
    alphaInput: number,
    beta: number,
    ply: number,
    quiescencePly: number,
  ): number => {
    nodes += 1
    checkDeadline()

    const pathKey = `${hash.key}:${hash.lock}`
    if (path.has(pathKey)) return 0
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
          !checked &&
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
    hash: PositionHash,
    depthInput: number,
    alphaInput: number,
    betaInput: number,
    ply: number,
    checkExtensionsLeft: number,
  ): number => {
    nodes += 1
    checkDeadline()

    const pathKey = `${hash.key}:${hash.lock}`
    if (path.has(pathKey)) return 0

    const checked = isInCheck(currentBoard, side)
    let depth = depthInput
    let extensionsLeft = checkExtensionsLeft
    if (checked && extensionsLeft > 0) {
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
      const cached = table.get(hash.key)
      const usableCache = cached?.lock === hash.lock ? cached : undefined

      if (usableCache && usableCache.depth >= depth) {
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
              quiet && !checked && childDepth >= 2 && index >= 4
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
      const existing = table.get(hash.key)
      if (
        table.size < MAX_TABLE_ENTRIES ||
        existing?.lock === hash.lock ||
        (existing !== undefined && existing.depth <= depth)
      ) {
        table.set(hash.key, {
          lock: hash.lock,
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
  const rootPathKey = `${rootHash.key}:${rootHash.lock}`
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
        rootEntries = [
          iterationBest,
          ...iterationEntries
            .filter((entry) => entry !== iterationBest)
            .sort((a, b) => b.score - a.score),
        ]

        if (completedScore > MATE_SCORE - 500) break
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
