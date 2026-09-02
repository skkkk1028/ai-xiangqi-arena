import type { CalibrationSummary } from './calibration'

export const XIANGQI_QUICK_CALIBRATION = Object.freeze({
  evidenceTier: 'quick' as const,
  resourceProfile: 'desktop' as const,
  wallClockMinutes: 360,
  baselineInitialPairs: 20,
  baselineIncrementPairs: 10,
  baselineMaxPairs: 50,
  tuningPairs: 10,
  verificationPairs: 20,
  verificationExtendedPairs: 25,
  proxyMinThinkMs: 200,
  proxyMaxThinkMs: 300,
  targetElo: 50,
  minimumScoreRateImprovement: 0.1,
  corpusSize: 220,
  openings: Object.freeze({
    baseline: Object.freeze({ offset: 0, count: 50 }),
    tuning: Object.freeze({ offset: 50, count: 80 }),
    verificationFull: Object.freeze({ offset: 130, count: 20 }),
    verificationHuman: Object.freeze({ offset: 150, count: 20 }),
    backup: Object.freeze({ offset: 180, count: 40 }),
  }),
})

export type QuickEvidenceStatus = 'provisional' | 'unmatched' | 'unchanged'

export interface QuickReferenceResult {
  uniqueLeader: string | null
  referenceEngineId: string | null
  leaders: readonly string[]
  weakerEngineIds: readonly string[]
  status: 'unique-leader' | 'provisional-reference' | 'shared-lead' | 'unresolved'
}

export interface QuickCandidateAssessment {
  status: QuickEvidenceStatus
  quickMatched: boolean
  improved: boolean
  runtimeClean: boolean
  eloWithinTarget: boolean
  intervalContainsZero: boolean
}

export function quickOpeningSectionsAreDisjoint(): boolean {
  const sections = Object.values(XIANGQI_QUICK_CALIBRATION.openings)
  const indices = sections.flatMap(({ offset, count }) =>
    Array.from({ length: count }, (_, index) => offset + index))
  return indices.length === new Set(indices).size && Math.max(...indices) < XIANGQI_QUICK_CALIBRATION.corpusSize
}

export function shouldExtendQuickBaseline(summary: CalibrationSummary, currentPairs: number, maxPairs = 50): boolean {
  if (currentPairs >= maxPairs || summary.pairs < currentPairs) return false
  const [low, high] = summary.eloInterval95
  return low === null || high === null || (low <= 0 && high >= 0)
}

export function determineQuickReference(
  engineIds: readonly string[],
  summaries: readonly CalibrationSummary[],
): QuickReferenceResult {
  const relevantFor = (engineId: string) => summaries.filter((summary) =>
    summary.engineId === engineId || summary.opponentId === engineId)
  const uniqueLeader = engineIds.find((engineId) => {
    const relevant = relevantFor(engineId)
    return relevant.length === engineIds.length - 1 && relevant.every((summary) => {
      const [low] = orientedEloInterval(summary, engineId)
      return low !== null && low > 0
    })
  }) ?? null
  if (uniqueLeader) {
    return {
      uniqueLeader,
      referenceEngineId: uniqueLeader,
      leaders: [uniqueLeader],
      weakerEngineIds: engineIds.filter((id) => id !== uniqueLeader && isClearlyWeaker(id, uniqueLeader, summaries)),
      status: 'unique-leader',
    }
  }
  const nonLosing = engineIds.filter((engineId) => {
    const relevant = relevantFor(engineId)
    return relevant.length === engineIds.length - 1 && relevant.every((summary) => orientedScoreRate(summary, engineId) >= 0.5)
  })
  if (nonLosing.length === 1) {
    const referenceEngineId = nonLosing[0]
    return {
      uniqueLeader: null,
      referenceEngineId,
      leaders: nonLosing,
      weakerEngineIds: engineIds.filter((id) => id !== referenceEngineId && isClearlyWeaker(id, referenceEngineId, summaries)),
      status: 'provisional-reference',
    }
  }
  const leaders = nonLosing.length > 1 ? nonLosing : engineIds.filter((engineId) => {
    const relevant = relevantFor(engineId)
    return relevant.length === engineIds.length - 1 && relevant.every((summary) => {
      const [, high] = orientedEloInterval(summary, engineId)
      return high === null || high >= 0
    })
  })
  return {
    uniqueLeader: null,
    referenceEngineId: null,
    leaders,
    weakerEngineIds: [],
    status: leaders.length > 1 ? 'shared-lead' : 'unresolved',
  }
}

export function assessQuickCandidate(
  summary: CalibrationSummary,
  baselineScoreRate: number,
  latencyPassed: boolean,
): QuickCandidateAssessment {
  const [low, high] = summary.eloInterval95
  const intervalContainsZero = low === null || high === null || (low <= 0 && high >= 0)
  const eloWithinTarget = summary.eloDifference !== null &&
    Math.abs(summary.eloDifference) <= XIANGQI_QUICK_CALIBRATION.targetElo
  const runtimeClean = summary.technicalFailures === 0 && summary.timeouts === 0 &&
    summary.moveLimits === 0 && summary.invalidPairs === 0 && latencyPassed
  const quickMatched = runtimeClean && eloWithinTarget && intervalContainsZero
  const improved = runtimeClean && summary.scoreRate - baselineScoreRate >=
    XIANGQI_QUICK_CALIBRATION.minimumScoreRateImprovement
  return {
    status: quickMatched ? 'provisional' : improved ? 'unmatched' : 'unchanged',
    quickMatched,
    improved,
    runtimeClean,
    eloWithinTarget,
    intervalContainsZero,
  }
}

export function quickNodeBudget(baseNodes: number, multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error('快速节点乘数不得小于 1。')
  return Math.min(5_000_000, Math.ceil((baseNodes * multiplier) / 10_000) * 10_000)
}

export function quickFullStrengthTimes(
  minThinkMs: number,
  maxThinkMs: number,
  multiplier: number,
  capMs: number,
): readonly [number, number] {
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error('快速时间乘数不得小于 1。')
  const minimum = Math.min(capMs, Math.round(minThinkMs * multiplier))
  const maximum = Math.min(capMs, Math.round(maxThinkMs * multiplier))
  return [Math.min(minimum, maximum), maximum]
}

export function quickDeadlineReached(deadlineEpochMs: number, nowEpochMs = Date.now()): boolean {
  return Number.isFinite(deadlineEpochMs) && nowEpochMs >= deadlineEpochMs
}

function isClearlyWeaker(
  engineId: string,
  referenceEngineId: string,
  summaries: readonly CalibrationSummary[],
): boolean {
  const summary = summaries.find((value) =>
    (value.engineId === engineId && value.opponentId === referenceEngineId) ||
    (value.engineId === referenceEngineId && value.opponentId === engineId))
  return summary ? orientedScoreRate(summary, engineId) < 1 / (1 + 10 ** (50 / 400)) : false
}

function orientedScoreRate(summary: CalibrationSummary, engineId: string): number {
  return summary.engineId === engineId ? summary.scoreRate : 1 - summary.scoreRate
}

function orientedEloInterval(
  summary: CalibrationSummary,
  engineId: string,
): readonly [number | null, number | null] {
  if (summary.engineId === engineId) return summary.eloInterval95
  return [
    summary.eloInterval95[1] === null ? null : -summary.eloInterval95[1],
    summary.eloInterval95[0] === null ? null : -summary.eloInterval95[0],
  ]
}
