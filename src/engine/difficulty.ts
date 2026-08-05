import type { EngineSearchResponse, SearchCandidate } from '../game/types'
import type { AIEngineConfig } from './types'

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5

export interface DifficultyProfile {
  level: DifficultyLevel
  name: string
  description: string
  minThinkMs: number
  maxThinkMs: number
  hashMb: number
  threads: number
  maxDepth?: number
  multiPv: 2 | 3 | 4
  alternativeChance: number
  candidateCount: number
}

export interface EngineDifficultySettings {
  threads: number
  hash: number
  maxDepth?: number
  multiPv: 2 | 3 | 4
}

export const DIFFICULTY_PROFILES: Readonly<Record<DifficultyLevel, Readonly<DifficultyProfile>>> =
  Object.freeze({
    1: Object.freeze({
      level: 1,
      name: '入门',
      description: '短时搜索，限制深度，并会从多个尚可候选中选择',
      minThinkMs: 1_000,
      maxThinkMs: 2_000,
      hashMb: 16,
      threads: 1,
      maxDepth: 6,
      multiPv: 4,
      alternativeChance: 0.75,
      candidateCount: 4,
    }),
    2: Object.freeze({
      level: 2,
      name: '普通',
      description: '常规短搜索，偶尔选择次优但合理的变化',
      minThinkMs: 3_000,
      maxThinkMs: 5_000,
      hashMb: 32,
      threads: 1,
      maxDepth: 10,
      multiPv: 4,
      alternativeChance: 0.42,
      candidateCount: 3,
    }),
    3: Object.freeze({
      level: 3,
      name: '进阶',
      description: '中等搜索资源，主要采用最佳或第二候选',
      minThinkMs: 5_000,
      maxThinkMs: 10_000,
      hashMb: 64,
      threads: 2,
      maxDepth: 15,
      multiPv: 3,
      alternativeChance: 0.2,
      candidateCount: 2,
    }),
    4: Object.freeze({
      level: 4,
      name: '高手',
      description: '较长搜索与较高资源，只保留很小的候选扰动',
      minThinkMs: 10_000,
      maxThinkMs: 20_000,
      hashMb: 96,
      threads: 3,
      maxDepth: 22,
      multiPv: 3,
      alternativeChance: 0.06,
      candidateCount: 2,
    }),
    5: Object.freeze({
      level: 5,
      name: '大师',
      description: '接近观战模式满强度，始终采用主引擎最佳着',
      minThinkMs: 20_000,
      maxThinkMs: 60_000,
      hashMb: 128,
      threads: 4,
      multiPv: 2,
      alternativeChance: 0,
      candidateCount: 1,
    }),
  })

export function difficultyProfile(level: DifficultyLevel): Readonly<DifficultyProfile> {
  return DIFFICULTY_PROFILES[level]
}

export function mapDifficultyToEngine(
  profile: Readonly<DifficultyProfile>,
  engine: Readonly<AIEngineConfig>,
  device: { threads: number; hashMb: number },
): EngineDifficultySettings {
  // Registry config remains the source of truth. Profiles only cap resources the
  // selected engine and browser can actually provide.
  const engineHashFloor = engine.engineType === 'pikafish' ? 16 : 8
  return {
    threads: Math.max(1, Math.min(profile.threads, device.threads)),
    hash: Math.max(engineHashFloor, Math.min(profile.hashMb, device.hashMb)),
    maxDepth: profile.maxDepth,
    multiPv: profile.multiPv,
  }
}

export function difficultyThinkTime(
  profile: Readonly<DifficultyProfile>,
  seed: number,
): number {
  const span = profile.maxThinkMs - profile.minThinkMs + 1
  return profile.minThinkMs + ((seed >>> 0) % span)
}

export function selectDifficultyMove(
  response: EngineSearchResponse,
  profile: Readonly<DifficultyProfile>,
  seed: number,
): { ucci: string | null; info: SearchCandidate | EngineSearchResponse['info'] } {
  if (!response.bestmove || profile.candidateCount === 1 || profile.alternativeChance <= 0) {
    return { ucci: response.bestmove, info: response.info }
  }

  const candidates = response.candidates
    .filter((candidate) => Boolean(candidate.pv[0]))
    .sort((left, right) => left.multipv - right.multipv)
    .slice(0, profile.candidateCount)
  if (candidates.length < 2) return { ucci: response.bestmove, info: response.info }

  const roll = pseudoRandom(seed)
  if (roll >= profile.alternativeChance) return { ucci: response.bestmove, info: response.info }
  const alternativeIndex = 1 + Math.floor(pseudoRandom(seed ^ 0x9e3779b9) * (candidates.length - 1))
  const selected = candidates[Math.min(alternativeIndex, candidates.length - 1)]
  return { ucci: selected.pv[0], info: selected }
}

function pseudoRandom(seed: number): number {
  let value = seed >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 0x1_0000_0000
}
