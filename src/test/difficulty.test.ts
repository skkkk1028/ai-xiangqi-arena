import { describe, expect, it } from 'vitest'
import {
  DIFFICULTY_PROFILES,
  difficultyThinkTime,
  mapDifficultyToEngine,
  selectDifficultyMove,
} from '../engine/difficulty'
import { FAIRY_STOCKFISH_CONFIG, PIKAFISH_CONFIG } from '../engine/config'
import type { EngineSearchResponse } from '../game/types'

const response: EngineSearchResponse = {
  bestmove: 'a0a1',
  info: {
    depth: 12,
    nodes: 100,
    nps: 1000,
    elapsedMs: 100,
    score: { kind: 'cp', value: 80 },
    wdl: null,
    pv: ['a0a1'],
  },
  candidates: [
    { depth: 12, multipv: 1, nodes: 100, nps: 1000, elapsedMs: 100, score: { kind: 'cp', value: 80 }, wdl: null, pv: ['a0a1'] },
    { depth: 12, multipv: 2, nodes: 100, nps: 1000, elapsedMs: 100, score: { kind: 'cp', value: 45 }, wdl: null, pv: ['b0b1'] },
    { depth: 12, multipv: 3, nodes: 100, nps: 1000, elapsedMs: 100, score: { kind: 'cp', value: 20 }, wdl: null, pv: ['c0c1'] },
  ],
}

describe('统一人机难度', () => {
  it('五档思考时间严格落在约定区间', () => {
    for (const profile of Object.values(DIFFICULTY_PROFILES)) {
      for (const seed of [0, 1, 123456, 0xffffffff]) {
        const value = difficultyThinkTime(profile, seed)
        expect(value).toBeGreaterThanOrEqual(profile.minThinkMs)
        expect(value).toBeLessThanOrEqual(profile.maxThinkMs)
      }
    }
    expect(DIFFICULTY_PROFILES[1]).toMatchObject({ minThinkMs: 1_000, maxThinkMs: 2_000 })
    expect(DIFFICULTY_PROFILES[5]).toMatchObject({ minThinkMs: 20_000, maxThinkMs: 60_000 })
  })

  it('按设备能力映射 Threads/Hash/深度，而非只修改 Skill', () => {
    const low = mapDifficultyToEngine(DIFFICULTY_PROFILES[1], FAIRY_STOCKFISH_CONFIG, {
      threads: 8,
      hashMb: 256,
    })
    const high = mapDifficultyToEngine(DIFFICULTY_PROFILES[5], PIKAFISH_CONFIG, {
      threads: 2,
      hashMb: 96,
    })
    expect(low).toMatchObject({ threads: 1, hash: 16, maxDepth: 6, multiPv: 4 })
    expect(high).toMatchObject({ threads: 2, hash: 96, maxDepth: undefined, multiPv: 2 })
    expect(FAIRY_STOCKFISH_CONFIG.skillLevel).toBe(20)
    expect(PIKAFISH_CONFIG.skillLevel).toBeNull()
  })

  it('入门档可选次优候选，大师档始终采用 bestmove', () => {
    expect(selectDifficultyMove(response, DIFFICULTY_PROFILES[1], 0).ucci).not.toBe('a0a1')
    expect(selectDifficultyMove(response, DIFFICULTY_PROFILES[5], 0).ucci).toBe('a0a1')
  })
})
