import type { Color } from '../../game/types'

export type CalibrationOutcome = 'red-win' | 'black-win' | 'draw' | 'technical'
export type CalibrationTermination =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'agreement'
  | 'repetition'
  | 'no-capture'
  | 'timeout'
  | 'move-limit'
  | 'technical'

export interface CalibrationGameResult {
  pairIndex: number
  gameIndex: number
  openingSeed: number
  redEngineId: string
  blackEngineId: string
  outcome: CalibrationOutcome
  plies: number
  termination?: CalibrationTermination
  technicalError?: string
}

export interface CalibrationScheduleEntry {
  pairIndex: number
  gameIndex: number
  openingSeed: number
  redEngineId: string
  blackEngineId: string
  swapped: boolean
}

export interface CalibrationSummary {
  engineId: string
  opponentId: string
  games: number
  decisiveGames: number
  wins: number
  draws: number
  losses: number
  technicalFailures: number
  score: number
  scoreRate: number
  scoreRateWilson95: readonly [number, number]
  eloDifference: number | null
  practicallyEquivalent: boolean
}

export const XIANGQI_CALIBRATION_TARGETS = Object.freeze({
  smokePairs: 20,
  tuningPairs: 200,
  formalPairs: 500,
  equivalenceBand: Object.freeze({ low: 0.4, high: 0.6 }),
  confidence: 0.95,
})

/**
 * Creates paired, colour-swapped games. The pair is the statistical unit for
 * reporting; the two games share an opening seed but reverse the seats.
 */
export function createCalibrationSchedule(
  engineId: string,
  opponentId: string,
  pairCount: number,
  seed = 0x6d2b79f5,
): readonly CalibrationScheduleEntry[] {
  if (!Number.isInteger(pairCount) || pairCount < 1) throw new Error('校准对局数必须是正整数。')
  const entries: CalibrationScheduleEntry[] = []
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const openingSeed = mixSeed(seed, pairIndex)
    entries.push(
      {
        pairIndex,
        gameIndex: pairIndex * 2,
        openingSeed,
        redEngineId: engineId,
        blackEngineId: opponentId,
        swapped: false,
      },
      {
        pairIndex,
        gameIndex: pairIndex * 2 + 1,
        openingSeed,
        redEngineId: opponentId,
        blackEngineId: engineId,
        swapped: true,
      },
    )
  }
  return entries
}

export function summarizeCalibration(
  results: readonly CalibrationGameResult[],
  engineId: string,
  opponentId: string,
): CalibrationSummary {
  let wins = 0
  let draws = 0
  let losses = 0
  let technicalFailures = 0
  let score = 0
  for (const result of results) {
    if (result.redEngineId !== engineId && result.blackEngineId !== engineId) continue
    if (result.outcome === 'technical') {
      technicalFailures += 1
      continue
    }
    const engineIsRed = result.redEngineId === engineId
    const engineWon = (engineIsRed && result.outcome === 'red-win') ||
      (!engineIsRed && result.outcome === 'black-win')
    const opponentWon = (engineIsRed && result.outcome === 'black-win') ||
      (!engineIsRed && result.outcome === 'red-win')
    if (engineWon) {
      wins += 1
      score += 1
    } else if (opponentWon) {
      losses += 1
    } else {
      draws += 1
      score += 0.5
    }
  }
  const games = wins + draws + losses
  const scoreRate = games > 0 ? score / games : 0.5
  const interval = wilsonInterval(scoreRate, games)
  const eloDifference = games > 0 && scoreRate > 0 && scoreRate < 1
    ? 400 * Math.log10(scoreRate / (1 - scoreRate))
    : null
  const practicallyEquivalent =
    technicalFailures === 0 &&
    games >= XIANGQI_CALIBRATION_TARGETS.formalPairs * 2 &&
    interval[0] >= XIANGQI_CALIBRATION_TARGETS.equivalenceBand.low &&
    interval[1] <= XIANGQI_CALIBRATION_TARGETS.equivalenceBand.high
  return {
    engineId,
    opponentId,
    games,
    decisiveGames: wins + losses,
    wins,
    draws,
    losses,
    technicalFailures,
    score,
    scoreRate,
    scoreRateWilson95: interval,
    eloDifference,
    practicallyEquivalent,
  }
}

export function wilsonInterval(scoreRate: number, games: number): readonly [number, number] {
  if (!Number.isFinite(scoreRate) || games <= 0) return [0, 1]
  const z = 1.959963984540054
  const denominator = 1 + (z * z) / games
  const centre = (scoreRate + (z * z) / (2 * games)) / denominator
  const spread = z * Math.sqrt((scoreRate * (1 - scoreRate) / games) + (z * z) / (4 * games * games)) / denominator
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)]
}

function mixSeed(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b)
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35)
  value ^= value >>> 16
  return value >>> 0
}

export function winnerForResult(result: { winner: Color | null }): CalibrationOutcome {
  if (result.winner === 'red') return 'red-win'
  if (result.winner === 'black') return 'black-win'
  return 'draw'
}
