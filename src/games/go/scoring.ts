import {
  cloneGoBoard,
  getGoNeighbors,
  isOnGoBoard,
  pointKey,
} from './board'
import { getGoGroup } from './rules'
import type {
  GoBoard,
  GoPlayer,
  GoPoint,
  GoScore,
  GoScoringInput,
  GoScoringStrategy,
} from './types'

export class GoScoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoScoringError'
  }
}

export interface GoDeadStoneResolution {
  /** A new board with every confirmed dead string removed. */
  board: GoBoard
  /** Every stone from the confirmed strings, sorted in board order. */
  confirmedDeadStones: readonly GoPoint[]
}

/**
 * Resolves representative points against the original board, so a click on a
 * single stone always removes its complete same-colour string. Exact duplicate
 * points are rejected. Different representatives of an already selected
 * string are intentionally idempotent: they cannot subtract the string twice.
 */
export function resolveDeadStoneRepresentatives(
  board: GoBoard,
  representatives: readonly GoPoint[],
): GoDeadStoneResolution {
  const representativeKeys = new Set<string>()
  const selectedGroupKeys = new Set<string>()
  const confirmedDeadStones: GoPoint[] = []

  for (const representative of representatives) {
    if (!isOnGoBoard(board, representative)) {
      throw new GoScoringError('死子代表点超出棋盘范围。')
    }

    const representativeKey = pointKey(representative)
    if (representativeKeys.has(representativeKey)) {
      throw new GoScoringError('死子代表点重复选择。')
    }
    representativeKeys.add(representativeKey)

    const group = getGoGroup(board, representative)
    if (!group) {
      throw new GoScoringError('死子代表点必须指向棋盘上的棋子。')
    }

    const groupKey = group.stones
      .map(pointKey)
      .sort()
      .join('|')
    if (selectedGroupKeys.has(groupKey)) continue
    selectedGroupKeys.add(groupKey)
    confirmedDeadStones.push(...group.stones.map((point) => ({ ...point })))
  }

  const scoredBoard = cloneGoBoard(board)
  for (const point of confirmedDeadStones) {
    scoredBoard[point.row][point.col] = null
  }

  return {
    board: scoredBoard,
    confirmedDeadStones: confirmedDeadStones.sort(comparePoints),
  }
}

/**
 * Chinese area scoring: living stones plus surrounded empty points. Prisoners
 * remain in the result as audit data but do not contribute to either total.
 */
export const ChineseAreaScoringStrategy: GoScoringStrategy = {
  id: 'chinese-area',
  name: '中国规则面积计分',
  score(input) {
    const stones = {
      black: countStones(input.board, 'black'),
      white: countStones(input.board, 'white'),
    }
    const territory = countTerritory(input.board)
    const blackTotal = stones.black + territory.black
    const whiteTotal = stones.white + territory.white + input.komi
    const winner: GoPlayer | null = blackTotal === whiteTotal
      ? null
      : blackTotal > whiteTotal
        ? 'black'
        : 'white'

    return {
      ruleset: { ...input.ruleset },
      method: ChineseAreaScoringStrategy.id,
      black: {
        livingStones: stones.black,
        territory: territory.black,
        prisoners: input.prisoners.black,
        total: blackTotal,
      },
      white: {
        livingStones: stones.white,
        territory: territory.white,
        prisoners: input.prisoners.white,
        total: whiteTotal,
      },
      komi: input.komi,
      neutralPoints: territory.neutral,
      confirmedDeadStones: input.confirmedDeadStones.map((point) => ({ ...point })),
      winner,
      margin: Math.abs(blackTotal - whiteTotal),
    }
  },
}

function countStones(board: GoBoard, color: GoPlayer): number {
  return board.reduce(
    (count, row) => count + row.filter((stone) => stone === color).length,
    0,
  )
}

function countTerritory(board: GoBoard): Record<GoPlayer | 'neutral', number> {
  const visited = new Set<string>()
  const territory: Record<GoPlayer | 'neutral', number> = {
    black: 0,
    white: 0,
    neutral: 0,
  }

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      const start = { row, col }
      if (board[row][col] !== null || visited.has(pointKey(start))) continue

      const region: GoPoint[] = []
      const borderingColors = new Set<GoPlayer>()
      const pending: GoPoint[] = [start]

      while (pending.length > 0) {
        const point = pending.pop()!
        const key = pointKey(point)
        if (visited.has(key)) continue
        visited.add(key)
        region.push(point)

        for (const neighbor of getGoNeighbors(board, point)) {
          const stone = board[neighbor.row][neighbor.col]
          if (stone === null) {
            if (!visited.has(pointKey(neighbor))) pending.push(neighbor)
          } else {
            borderingColors.add(stone)
          }
        }
      }

      if (borderingColors.size === 1) {
        const owner: GoPlayer = borderingColors.has('black') ? 'black' : 'white'
        territory[owner] += region.length
      } else {
        territory.neutral += region.length
      }
    }
  }

  return territory
}

function comparePoints(left: GoPoint, right: GoPoint): number {
  return left.row - right.row || left.col - right.col
}
