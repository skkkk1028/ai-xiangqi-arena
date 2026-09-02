import {
  DIFFICULTY_PROFILES,
  type DifficultyLevel,
  type DifficultyProfile,
} from '../../engine/difficulty'
import {
  FAIRY_STOCKFISH_ENGINE_ID,
  PIKAFISH_2025_ENGINE_ID,
  PIKAFISH_ENGINE_ID,
} from '../../engine/config'
import type { MultiPvCount } from '../../engine/search-policy'
import type { EngineSearchResponse, SearchCandidate } from '../../game/types'
import quickCalibrationGenerated from './quick-calibration.generated.json'

export type XiangqiResourceProfileId = 'constrained' | 'desktop'
export type XiangqiCalibrationScenario =
  | 'battle-full'
  | 'human-l1'
  | 'human-l2'
  | 'human-l3'
  | 'human-l4'
  | 'human-l5'
export type XiangqiCalibrationStatus = 'provisional' | 'validated' | 'unmatched'

export interface XiangqiCalibratedResource {
  maxNodes?: number
  minThinkMs: number
  maxThinkMs: number
  multiPv: MultiPvCount | 'dynamic'
  latencyLimitMs: number
  calibrationStatus: XiangqiCalibrationStatus
  evidenceVersion: string
  evidenceReportSha256: string | null
  eloInterval95: readonly [number, number] | null
}

export interface XiangqiStrengthProfile extends DifficultyProfile {
  engineId: string
  resourceProfile: XiangqiResourceProfileId
  scenario: XiangqiCalibrationScenario
  calibrationStatus: XiangqiCalibrationStatus
  calibrationVersion: number
  calibrationSource: string
  evidenceReportSha256: string | null
  eloInterval95: readonly [number, number] | null
}

export const XIANGQI_STRENGTH_SCHEMA_VERSION = 2
export const XIANGQI_STRENGTH_EVIDENCE_VERSION = 'xiangqi-strength-matrix-v2-unvalidated'

const ENGINE_IDS = [FAIRY_STOCKFISH_ENGINE_ID, PIKAFISH_ENGINE_ID, PIKAFISH_2025_ENGINE_ID] as const
const RESOURCE_PROFILES = ['constrained', 'desktop'] as const
const LEVEL_NODES: Readonly<Record<DifficultyLevel, number | undefined>> = Object.freeze({
  1: 30_000,
  2: 100_000,
  3: 300_000,
  4: 900_000,
  5: undefined,
})
const LEVEL_LATENCY: Readonly<Record<DifficultyLevel, number>> = Object.freeze({
  1: 3_000,
  2: 6_000,
  3: 12_000,
  4: 24_000,
  5: 60_000,
})

function provisionalHumanResource(level: DifficultyLevel): XiangqiCalibratedResource {
  const base = DIFFICULTY_PROFILES[level]
  return Object.freeze({
    maxNodes: LEVEL_NODES[level],
    minThinkMs: base.minThinkMs,
    maxThinkMs: base.maxThinkMs,
    multiPv: base.multiPv,
    latencyLimitMs: LEVEL_LATENCY[level],
    calibrationStatus: 'provisional',
    evidenceVersion: XIANGQI_STRENGTH_EVIDENCE_VERSION,
    evidenceReportSha256: null,
    eloInterval95: null,
  })
}

function provisionalBattleResource(): XiangqiCalibratedResource {
  return Object.freeze({
    minThinkMs: 12_000,
    maxThinkMs: 18_000,
    multiPv: 'dynamic',
    latencyLimitMs: 55_000,
    calibrationStatus: 'provisional',
    evidenceVersion: XIANGQI_STRENGTH_EVIDENCE_VERSION,
    evidenceReportSha256: null,
    eloInterval95: null,
  })
}

function createMatrix(): Readonly<Record<string, Readonly<Record<XiangqiCalibrationScenario, XiangqiCalibratedResource>>>> {
  const matrix: Record<string, Record<XiangqiCalibrationScenario, XiangqiCalibratedResource>> = {}
  for (const engineId of ENGINE_IDS) {
    for (const resourceProfile of RESOURCE_PROFILES) {
      const key = `${engineId}:${resourceProfile}`
      matrix[key] = {
        'battle-full': provisionalBattleResource(),
        'human-l1': provisionalHumanResource(1),
        'human-l2': provisionalHumanResource(2),
        'human-l3': provisionalHumanResource(3),
        'human-l4': provisionalHumanResource(4),
        'human-l5': provisionalHumanResource(5),
      }
    }
  }
  applyQuickDesktopOverrides(matrix, quickCalibrationGenerated as unknown)
  for (const key of Object.keys(matrix)) Object.freeze(matrix[key])
  return Object.freeze(matrix)
}

function applyQuickDesktopOverrides(
  matrix: Record<string, Record<XiangqiCalibrationScenario, XiangqiCalibratedResource>>,
  generated: unknown,
): void {
  if (!isRecord(generated) || generated.schema !== 'project10-xiangqi-quick-overrides-v1' ||
    generated.evidenceTier !== 'quick' || generated.resourceProfile !== 'desktop' || !isRecord(generated.overrides)) return
  const reportSha256 = typeof generated.reportSha256 === 'string' ? generated.reportSha256 : null
  for (const [engineId, engineOverrides] of Object.entries(generated.overrides)) {
    if (!ENGINE_IDS.includes(engineId as typeof ENGINE_IDS[number]) || !isRecord(engineOverrides)) continue
    const key = `${engineId}:desktop`
    for (const [scenario, candidate] of Object.entries(engineOverrides)) {
      if (!isScenario(scenario) || !isRecord(candidate)) continue
      const baseline = matrix[key][scenario]
      const status = candidate.calibrationStatus === 'unmatched' ? 'unmatched' : 'provisional'
      const maxNodes = typeof candidate.maxNodes === 'number' ? candidate.maxNodes : baseline.maxNodes
      const minThinkMs = typeof candidate.minThinkMs === 'number' ? candidate.minThinkMs : baseline.minThinkMs
      const maxThinkMs = typeof candidate.maxThinkMs === 'number' ? candidate.maxThinkMs : baseline.maxThinkMs
      if (minThinkMs < baseline.minThinkMs) throw new Error('快速校准禁止降低最小搜索时间。')
      assertXiangqiResourceIncrease(baseline, { maxNodes, maxThinkMs })
      const multiPv = candidate.multiPv === 1 ? 1 : baseline.multiPv
      matrix[key][scenario] = Object.freeze({
        ...baseline,
        maxNodes,
        minThinkMs,
        maxThinkMs,
        multiPv,
        calibrationStatus: status,
        evidenceVersion: 'xiangqi-quick-calibration-v1',
        evidenceReportSha256: reportSha256,
        eloInterval95: quickEloInterval(candidate.eloInterval95),
      })
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScenario(value: string): value is XiangqiCalibrationScenario {
  return value === 'battle-full' || /^human-l[1-5]$/.test(value)
}

function quickEloInterval(value: unknown): readonly [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === 'number')
    ? [value[0] as number, value[1] as number]
    : null
}

/** Xiangqi-only matrix. Entries remain provisional until formal evidence is frozen. */
export const XIANGQI_STRENGTH_MATRIX = createMatrix()

const CENTIPAWN_LOSS_LIMITS: Readonly<Record<DifficultyLevel, number>> = Object.freeze({
  1: 220,
  2: 140,
  3: 85,
  4: 45,
  5: 0,
})

export function xiangqiResourceProfileId(device: { threads: number; hashMb: number }): XiangqiResourceProfileId {
  return device.threads >= 2 && device.hashMb >= 128 ? 'desktop' : 'constrained'
}

export function xiangqiCalibrationScenario(level: DifficultyLevel): XiangqiCalibrationScenario {
  return `human-l${level}` as XiangqiCalibrationScenario
}

export function xiangqiCalibratedResource(
  engineId: string,
  scenario: XiangqiCalibrationScenario,
  resourceProfile: XiangqiResourceProfileId,
): Readonly<XiangqiCalibratedResource> {
  const key = `${engineId}:${resourceProfile}`
  const fallbackKey = `${FAIRY_STOCKFISH_ENGINE_ID}:${resourceProfile}`
  return XIANGQI_STRENGTH_MATRIX[key]?.[scenario] ?? XIANGQI_STRENGTH_MATRIX[fallbackKey][scenario]
}

export function assertXiangqiResourceIncrease(
  baseline: Pick<XiangqiCalibratedResource, 'maxNodes' | 'maxThinkMs'>,
  candidate: Pick<XiangqiCalibratedResource, 'maxNodes' | 'maxThinkMs'>,
): void {
  if (baseline.maxNodes !== undefined && candidate.maxNodes !== undefined && candidate.maxNodes < baseline.maxNodes) {
    throw new Error('只增强策略禁止降低节点预算。')
  }
  if (candidate.maxThinkMs < baseline.maxThinkMs) throw new Error('只增强策略禁止降低搜索时间。')
  if ((candidate.maxNodes ?? 0) > 5_000_000) throw new Error('象棋节点预算不得超过 5,000,000。')
  if (candidate.maxThinkMs > 60_000) throw new Error('象棋单步搜索不得超过 60 秒。')
}

export function xiangqiDifficultyProfile(
  engineId: string,
  level: DifficultyLevel,
  resourceProfile: XiangqiResourceProfileId = 'constrained',
): Readonly<XiangqiStrengthProfile> {
  const base = DIFFICULTY_PROFILES[level]
  const scenario = xiangqiCalibrationScenario(level)
  const calibrated = xiangqiCalibratedResource(engineId, scenario, resourceProfile)
  return Object.freeze({
    ...base,
    engineId,
    resourceProfile,
    scenario,
    minThinkMs: calibrated.minThinkMs,
    maxThinkMs: calibrated.maxThinkMs,
    maxNodes: calibrated.maxNodes,
    multiPv: calibrated.multiPv === 'dynamic' ? base.multiPv : calibrated.multiPv,
    maxCentipawnLoss: CENTIPAWN_LOSS_LIMITS[level],
    calibrationStatus: calibrated.calibrationStatus,
    calibrationVersion: XIANGQI_STRENGTH_SCHEMA_VERSION,
    calibrationSource: calibrated.evidenceVersion,
    evidenceReportSha256: calibrated.evidenceReportSha256,
    eloInterval95: calibrated.eloInterval95,
  })
}

export function xiangqiDifficultyProfiles(
  engineId: string,
  resourceProfile: XiangqiResourceProfileId = 'constrained',
): ReadonlyArray<Readonly<XiangqiStrengthProfile>> {
  return ([1, 2, 3, 4, 5] as const).map((level) =>
    xiangqiDifficultyProfile(engineId, level, resourceProfile))
}

export function selectXiangqiDifficultyMove(
  response: EngineSearchResponse,
  profile: Readonly<XiangqiStrengthProfile>,
  seed: number,
): { ucci: string | null; info: SearchCandidate | EngineSearchResponse['info'] } {
  if (!response.bestmove || profile.candidateCount === 1 || profile.alternativeChance <= 0) {
    return { ucci: response.bestmove, info: response.info }
  }
  const principalScore = scoreForSelection(response.info.score)
  const candidates = response.candidates
    .filter((candidate) => Boolean(candidate.pv[0]))
    .sort((left, right) => left.multipv - right.multipv)
    .slice(0, profile.candidateCount)
  if (candidates.length < 2) return { ucci: response.bestmove, info: response.info }
  const allowedLoss = profile.maxCentipawnLoss ?? Number.POSITIVE_INFINITY
  const alternatives = candidates.filter((candidate) => {
    if (candidate.multipv === 1) return false
    const score = scoreForSelection(candidate.score)
    return principalScore !== null && score !== null && principalScore - score <= allowedLoss
  })
  if (alternatives.length === 0 || pseudoRandom(seed) >= profile.alternativeChance) {
    return { ucci: response.bestmove, info: response.info }
  }
  const selected = alternatives[Math.min(
    Math.floor(pseudoRandom(seed ^ 0x9e3779b9) * alternatives.length),
    alternatives.length - 1,
  )]
  return { ucci: selected.pv[0], info: selected }
}

function scoreForSelection(score: SearchCandidate['score']): number | null {
  if (!score) return null
  if (score.kind === 'mate') return score.value > 0 ? 100_000 - score.value : -100_000 - score.value
  return score.value
}

function pseudoRandom(seed: number): number {
  let value = seed >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 0x1_0000_0000
}
