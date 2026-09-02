import type { EngineScore, SearchInfo, Wdl } from '../../game/types'
import type { Color } from '../../game/types'
import type {
  XiangqiCalibrationScenario,
  XiangqiResourceProfileId,
} from './strength-profile'

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
export type CalibrationRunStage = 'baseline' | 'tuning' | 'formal'
export type CalibrationEvidenceTier = 'standard' | 'quick'
export type CalibrationStopReason =
  | 'maximum-pairs'
  | 'equivalent'
  | 'unique-leader'
  | 'insufficient-evidence'
  | 'runtime-gate-failed'
  | 'wall-clock-limit'

export interface CalibrationSearchTelemetry {
  ply: number
  engineId: string
  requestedBudgetMs: number
  requestedNodes?: number
  requestedMultiPv: number
  elapsedMs: number
  depth: number
  seldepth?: number
  nodes: number
  nps: number
  score: EngineScore | null
  wdl: Wdl | null
  bestmove: string | null
  pv: readonly string[]
}

export interface CalibrationGameResult {
  pairIndex: number
  pairId?: string
  gameIndex: number
  attempt?: number
  retryOfPairId?: string
  openingSeed: number
  openingId?: string
  openingCorpusSha256?: string
  redEngineId: string
  blackEngineId: string
  outcome: CalibrationOutcome
  plies: number
  moves?: readonly string[]
  termination?: CalibrationTermination
  technicalError?: string
  telemetry?: readonly CalibrationSearchTelemetry[]
}

export interface CalibrationScheduleEntry {
  pairIndex: number
  pairId: string
  gameIndex: number
  openingSeed: number
  openingId?: string
  redEngineId: string
  blackEngineId: string
  swapped: boolean
  decisionSeed: number
}

export interface CalibrationPairResult {
  pairIndex: number
  pairId: string
  openingId: string | null
  valid: boolean
  score: number | null
  games: readonly CalibrationGameResult[]
  invalidReason: string | null
}

export interface CalibrationConfidenceSequence {
  method: 'predictable-plug-in-empirical-bernstein-e-process'
  confidence: number
  comparisonCount: number
  samples: number
  scoreRate: number
  scoreInterval: readonly [number, number]
  eloDifference: number | null
  eloInterval: readonly [number | null, number | null]
}

export interface CalibrationSummary {
  engineId: string
  opponentId: string
  games: number
  pairs: number
  invalidPairs: number
  decisiveGames: number
  wins: number
  draws: number
  losses: number
  technicalFailures: number
  recoveredTechnicalFailures: number
  timeouts: number
  moveLimits: number
  score: number
  scoreRate: number
  scoreRateWilson95: readonly [number, number]
  pairScoreDistribution: Readonly<Record<'0' | '0.25' | '0.5' | '0.75' | '1', number>>
  confidenceSequence95: CalibrationConfidenceSequence
  eloDifference: number | null
  eloInterval95: readonly [number | null, number | null]
  practicallyEquivalent: boolean
  uniqueLeader: boolean
  stopReason: CalibrationStopReason
}

export interface CalibrationRunIdentity {
  schema: 'project10-xiangqi-calibration-v2'
  gitCommit: string
  browserVersion: string
  resourceProfile: XiangqiResourceProfileId
  scenario: XiangqiCalibrationScenario
  stage: CalibrationRunStage
  openingCorpusSha256: string
  configurationId: string
}

export const XIANGQI_CALIBRATION_TARGETS = Object.freeze({
  smokePairs: 20,
  tuningPairs: 200,
  formalPairs: 500,
  equivalenceElo: 30,
  confidence: 0.95,
  baselineComparisons: 3,
  updateEveryPairs: 25,
  maxPlies: 600,
  maxNodes: 5_000_000,
  // Legacy score-space helper retained for older reports/tests. Formal v2
  // qualification uses the Elo confidence interval below, not this broad band.
  equivalenceBand: Object.freeze({ low: 0.4, high: 0.6 }),
})

/** Creates paired, colour-swapped games with a shared opening and decision seed. */
export function createCalibrationSchedule(
  engineId: string,
  opponentId: string,
  pairCount: number,
  seed = 0x6d2b79f5,
  openingIds: readonly string[] = [],
): readonly CalibrationScheduleEntry[] {
  if (!Number.isInteger(pairCount) || pairCount < 1) throw new Error('校准对局数必须是正整数。')
  if (openingIds.length > 0 && openingIds.length < pairCount) throw new Error('开局语料不足以覆盖全部换色对。')
  const entries: CalibrationScheduleEntry[] = []
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const openingSeed = mixSeed(seed, pairIndex)
    const openingId = openingIds[pairIndex]
    const pairId = `${engineId}__${opponentId}__${openingId ?? openingSeed}__${pairIndex}`
    const decisionSeed = mixSeed(openingSeed, 0x51ed270b)
    entries.push(
      {
        pairIndex,
        pairId,
        gameIndex: pairIndex * 2,
        openingSeed,
        openingId,
        redEngineId: engineId,
        blackEngineId: opponentId,
        swapped: false,
        decisionSeed,
      },
      {
        pairIndex,
        pairId,
        gameIndex: pairIndex * 2 + 1,
        openingSeed,
        openingId,
        redEngineId: opponentId,
        blackEngineId: engineId,
        swapped: true,
        decisionSeed,
      },
    )
  }
  return entries
}

export function pairCalibrationResults(
  results: readonly CalibrationGameResult[],
  engineId: string,
): readonly CalibrationPairResult[] {
  const grouped = new Map<string, CalibrationGameResult[]>()
  for (const game of results) {
    if (game.pairIndex < 0) continue
    const key = game.pairId ?? String(game.pairIndex)
    const values = grouped.get(key) ?? []
    values.push(game)
    grouped.set(key, values)
  }
  return [...grouped.entries()].map(([pairId, games]) => {
    const ordered = [...games].sort((left, right) => left.gameIndex - right.gameIndex)
    const invalid = ordered.length !== 2 || ordered.some((game) =>
      game.outcome === 'technical' || game.termination === 'move-limit' || game.termination === 'timeout')
    return {
      pairIndex: ordered[0]?.pairIndex ?? -1,
      pairId,
      openingId: ordered[0]?.openingId ?? null,
      valid: !invalid,
      score: invalid ? null : ordered.reduce((total, game) => total + gameScore(game, engineId), 0) / 2,
      games: ordered,
      invalidReason: invalid
        ? ordered.find((game) => game.technicalError)?.technicalError ??
          ordered.find((game) => game.termination === 'move-limit')?.termination ??
          ordered.find((game) => game.termination === 'timeout')?.termination ??
          'incomplete-pair'
        : null,
    }
  }).sort((left, right) => left.pairIndex - right.pairIndex)
}

export function summarizeCalibration(
  results: readonly CalibrationGameResult[],
  engineId: string,
  opponentId: string,
  comparisonCount = XIANGQI_CALIBRATION_TARGETS.baselineComparisons,
): CalibrationSummary {
  const allPairs = pairCalibrationResults(results, engineId)
  const attemptsByPair = new Map<number, CalibrationPairResult[]>()
  for (const pair of allPairs) {
    const attempts = attemptsByPair.get(pair.pairIndex) ?? []
    attempts.push(pair)
    attemptsByPair.set(pair.pairIndex, attempts)
  }
  const pairs = [...attemptsByPair.values()].map((attempts) =>
    [...attempts].reverse().find((pair) => pair.valid) ?? attempts.at(-1) as CalibrationPairResult)
  const effectiveResults = pairs.flatMap((pair) => pair.games)
  let wins = 0
  let draws = 0
  let losses = 0
  let technicalFailures = 0
  let timeouts = 0
  let moveLimits = 0
  let score = 0
  for (const result of effectiveResults) {
    if (result.redEngineId !== engineId && result.blackEngineId !== engineId) continue
    if (result.outcome === 'technical') {
      technicalFailures += 1
      continue
    }
    if (result.termination === 'timeout') timeouts += 1
    if (result.termination === 'move-limit') moveLimits += 1
    const points = gameScore(result, engineId)
    if (points === 1) wins += 1
    else if (points === 0) losses += 1
    else draws += 1
    score += points
  }
  const games = wins + draws + losses
  const scoreRate = games > 0 ? score / games : 0.5
  const validPairScores = pairs.flatMap((pair) => pair.score === null ? [] : [pair.score])
  const recoveredTechnicalFailures = Math.max(0,
    results.filter((game) => game.outcome === 'technical').length - technicalFailures)
  const confidenceSequence95 = empiricalBernsteinConfidenceSequence(validPairScores, 0.95, comparisonCount)
  const eloInterval95 = confidenceSequence95.eloInterval
  const runtimeClean = technicalFailures === 0 && timeouts === 0 && moveLimits === 0 && pairs.every((pair) => pair.valid)
  const enough = validPairScores.length >= XIANGQI_CALIBRATION_TARGETS.formalPairs
  const finiteEloInterval = eloInterval95[0] !== null && eloInterval95[1] !== null
  const practicallyEquivalent = runtimeClean && enough && finiteEloInterval &&
    (eloInterval95[0] as number) >= -XIANGQI_CALIBRATION_TARGETS.equivalenceElo &&
    (eloInterval95[1] as number) <= XIANGQI_CALIBRATION_TARGETS.equivalenceElo
  const uniqueLeader = eloInterval95[0] !== null && eloInterval95[0] > 0
  const distribution = { '0': 0, '0.25': 0, '0.5': 0, '0.75': 0, '1': 0 }
  for (const value of validPairScores) distribution[String(value) as keyof typeof distribution] += 1
  return {
    engineId,
    opponentId,
    games,
    pairs: validPairScores.length,
    invalidPairs: pairs.length - validPairScores.length,
    decisiveGames: wins + losses,
    wins,
    draws,
    losses,
    technicalFailures,
    recoveredTechnicalFailures,
    timeouts,
    moveLimits,
    score,
    scoreRate,
    scoreRateWilson95: wilsonInterval(scoreRate, games),
    pairScoreDistribution: distribution,
    confidenceSequence95,
    eloDifference: scoreToElo(scoreRate),
    eloInterval95,
    practicallyEquivalent,
    uniqueLeader,
    stopReason: !runtimeClean
      ? 'runtime-gate-failed'
      : practicallyEquivalent
        ? 'equivalent'
        : uniqueLeader
          ? 'unique-leader'
          : enough
            ? 'maximum-pairs'
            : 'insufficient-evidence',
  }
}

/**
 * Time-uniform confidence sequence built from a predictable plug-in empirical-
 * Bernstein e-process. The bet at time t only uses variance observed before t;
 * Ville's inequality therefore remains valid under optional stopping. A
 * Bonferroni factor is applied for the baseline round-robin comparisons.
 */
export function empiricalBernsteinConfidenceSequence(
  samples: readonly number[],
  confidence = 0.95,
  comparisonCount = 1,
): CalibrationConfidenceSequence {
  if (samples.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('换色对得分必须位于 [0,1]。')
  }
  if (!Number.isInteger(comparisonCount) || comparisonCount < 1) throw new Error('多重比较数必须是正整数。')
  const scoreRate = samples.length === 0 ? 0.5 : samples.reduce((sum, value) => sum + value, 0) / samples.length
  const alpha = (1 - confidence) / comparisonCount
  const threshold = 2 / alpha
  const accepted = (mean: number): boolean => {
    let upperWealth = 1
    let lowerWealth = 1
    let runningMean = 0.5
    let varianceProcess = 0.25
    for (let index = 0; index < samples.length; index += 1) {
      const time = index + 1
      const value = samples[index]
      const estimatedVariance = Math.max(varianceProcess / time, 1 / (time + 1))
      const bet = Math.min(0.5, Math.sqrt((2 * Math.log(2 / alpha)) /
        (estimatedVariance * time * Math.max(1, Math.log(time + 1)))))
      lowerWealth *= 1 + bet * (value - mean)
      upperWealth *= 1 - bet * (value - mean)
      const previousMean = runningMean
      runningMean += (value - runningMean) / time
      varianceProcess += (value - previousMean) * (value - runningMean)
      if (lowerWealth >= threshold || upperWealth >= threshold) return false
    }
    return true
  }
  let low = 0
  let high = 1
  if (samples.length > 0) {
    const gridSize = 10_000
    let first = -1
    let last = -1
    for (let index = 0; index <= gridSize; index += 1) {
      if (!accepted(index / gridSize)) continue
      if (first < 0) first = index
      last = index
    }
    if (first >= 0) {
      // Expand by one grid cell so numerical inversion never makes the
      // confidence sequence narrower than the underlying continuous set.
      low = Math.max(0, (first - 1) / gridSize)
      high = Math.min(1, (last + 1) / gridSize)
    }
  }
  return {
    method: 'predictable-plug-in-empirical-bernstein-e-process',
    confidence,
    comparisonCount,
    samples: samples.length,
    scoreRate,
    scoreInterval: [low, high],
    eloDifference: scoreToElo(scoreRate),
    eloInterval: [scoreToElo(low), scoreToElo(high)],
  }
}

export function determineRoundRobinLeaders(
  engineIds: readonly string[],
  summaries: readonly CalibrationSummary[],
): { leaders: readonly string[]; uniqueLeader: string | null } {
  const leaders = engineIds.filter((engineId) => {
    const relevant = summaries.filter((summary) => summary.engineId === engineId || summary.opponentId === engineId)
    if (relevant.length !== engineIds.length - 1) return false
    return relevant.every((summary) => {
      const interval = summary.engineId === engineId
        ? summary.eloInterval95
        : invertEloInterval(summary.eloInterval95)
      return interval[1] === null || interval[1] >= 0
    })
  })
  const unique = leaders.find((engineId) => {
    const relevant = summaries.filter((summary) => summary.engineId === engineId || summary.opponentId === engineId)
    return relevant.length === engineIds.length - 1 && relevant.every((summary) => {
      const interval = summary.engineId === engineId
        ? summary.eloInterval95
        : invertEloInterval(summary.eloInterval95)
      return interval[0] !== null && interval[0] > 0
    })
  }) ?? null
  return { leaders: unique ? [unique] : leaders, uniqueLeader: unique }
}

export function wilsonInterval(scoreRate: number, games: number): readonly [number, number] {
  if (!Number.isFinite(scoreRate) || games <= 0) return [0, 1]
  const z = 1.959963984540054
  const denominator = 1 + (z * z) / games
  const centre = (scoreRate + (z * z) / (2 * games)) / denominator
  const spread = z * Math.sqrt((scoreRate * (1 - scoreRate) / games) + (z * z) / (4 * games * games)) / denominator
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)]
}

export function scoreToElo(score: number): number | null {
  if (!Number.isFinite(score) || score <= 0 || score >= 1) return null
  return 400 * Math.log10(score / (1 - score))
}

export function eloToScore(elo: number): number {
  return 1 / (1 + 10 ** (-elo / 400))
}

function invertEloInterval(interval: readonly [number | null, number | null]): readonly [number | null, number | null] {
  return [interval[1] === null ? null : -interval[1], interval[0] === null ? null : -interval[0]]
}

function gameScore(result: CalibrationGameResult, engineId: string): number {
  const engineIsRed = result.redEngineId === engineId
  if (result.outcome === 'draw') return 0.5
  if ((engineIsRed && result.outcome === 'red-win') || (!engineIsRed && result.outcome === 'black-win')) return 1
  return 0
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

export function telemetryFromSearch(
  ply: number,
  engineId: string,
  requestedBudgetMs: number,
  requestedMultiPv: number,
  info: SearchInfo,
  bestmove: string | null,
  requestedNodes?: number,
): CalibrationSearchTelemetry {
  return {
    ply,
    engineId,
    requestedBudgetMs,
    requestedNodes,
    requestedMultiPv,
    elapsedMs: info.elapsedMs,
    depth: info.depth,
    seldepth: info.seldepth,
    nodes: info.nodes,
    nps: info.nps,
    score: info.score,
    wdl: info.wdl,
    bestmove,
    pv: [...info.pv],
  }
}
