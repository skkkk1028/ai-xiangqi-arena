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
import type { EngineSearchResponse, SearchCandidate } from '../../game/types'

/**
 * Product-facing Xiangqi strength metadata.
 *
 * The node ladder is deliberately marked provisional until the paired-game
 * calibration runner has produced a statistically sufficient report. Keeping
 * that state in data prevents the UI from silently turning a resource guess
 * into an unsupported Elo claim.
 */
export const XIANGQI_STRENGTH_SCHEMA_VERSION = 1
export const XIANGQI_STRENGTH_STATUS = 'provisional' as const

export interface XiangqiStrengthProfile extends DifficultyProfile {
  engineId: string
  calibrationStatus: 'provisional' | 'validated'
  calibrationVersion: number
  calibrationSource: string
}

type NodeLadder = Readonly<Record<DifficultyLevel, number | undefined>>

const NODE_LADDERS: Readonly<Record<string, NodeLadder>> = Object.freeze({
  // These are conservative starting points for browser calibration. They are
  // not claimed to be human Elo values; the report can replace them after a
  // paired-game run without changing the UI/controller contract.
  [FAIRY_STOCKFISH_ENGINE_ID]: Object.freeze({
    1: 30_000,
    2: 100_000,
    3: 300_000,
    4: 900_000,
    5: undefined,
  }),
  [PIKAFISH_ENGINE_ID]: Object.freeze({
    1: 30_000,
    2: 100_000,
    3: 300_000,
    4: 900_000,
    5: undefined,
  }),
  [PIKAFISH_2025_ENGINE_ID]: Object.freeze({
    1: 30_000,
    2: 100_000,
    3: 300_000,
    4: 900_000,
    5: undefined,
  }),
})

const CENTIPAWN_LOSS_LIMITS: Readonly<Record<DifficultyLevel, number>> = Object.freeze({
  1: 220,
  2: 140,
  3: 85,
  4: 45,
  5: 0,
})

export function xiangqiDifficultyProfile(
  engineId: string,
  level: DifficultyLevel,
): Readonly<XiangqiStrengthProfile> {
  const base = DIFFICULTY_PROFILES[level]
  const ladder = NODE_LADDERS[engineId] ?? NODE_LADDERS[FAIRY_STOCKFISH_ENGINE_ID]
  return Object.freeze({
    ...base,
    engineId,
    maxNodes: ladder[level],
    maxCentipawnLoss: CENTIPAWN_LOSS_LIMITS[level],
    calibrationStatus: XIANGQI_STRENGTH_STATUS,
    calibrationVersion: XIANGQI_STRENGTH_SCHEMA_VERSION,
    calibrationSource: '2026-08-21 20-pair browser check at 30k nodes: provisional only; no node-ladder re-tiering',
  })
}

export function xiangqiDifficultyProfiles(engineId: string): ReadonlyArray<Readonly<XiangqiStrengthProfile>> {
  return ([1, 2, 3, 4, 5] as const).map((level) => xiangqiDifficultyProfile(engineId, level))
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
