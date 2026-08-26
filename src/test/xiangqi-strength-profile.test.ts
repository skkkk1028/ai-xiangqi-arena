import { describe, expect, it } from 'vitest'
import type { EngineSearchResponse } from '../game/types'
import { PIKAFISH_ENGINE_ID } from '../engine/config'
import { mapDifficultyToEngine } from '../engine/difficulty'
import { xiangqiDifficultyProfile, selectXiangqiDifficultyMove } from '../games/xiangqi/strength-profile'

function response(candidates: EngineSearchResponse['candidates']): EngineSearchResponse {
  return {
    bestmove: candidates[0]?.pv[0] ?? null,
    info: candidates[0] ?? {
      depth: 8,
      nodes: 30_000,
      nps: 30_000,
      elapsedMs: 100,
      score: null,
      wdl: null,
      pv: [],
      multipv: 1,
    },
    candidates,
  }
}

describe('中国象棋引擎强度档位', () => {
  it('为皮卡鱼生成单调的暂定节点阶梯，并标明尚未完成统计校准', () => {
    const levels = ([1, 2, 3, 4, 5] as const).map((level) =>
      xiangqiDifficultyProfile(PIKAFISH_ENGINE_ID, level),
    )
    expect(levels.every((profile) => profile.calibrationStatus === 'provisional')).toBe(true)
    expect(levels.slice(0, 4).map((profile) => profile.maxNodes)).toEqual([
      30_000,
      100_000,
      300_000,
      900_000,
    ])
    expect(levels[4].maxNodes).toBeUndefined()
  })

  it('映射人机搜索时保留固定节点上限', () => {
    const profile = xiangqiDifficultyProfile(PIKAFISH_ENGINE_ID, 2)
    const mapped = mapDifficultyToEngine(profile, {
      id: PIKAFISH_ENGINE_ID,
      gameId: 'xiangqi',
      name: 'Pikafish',
      engineType: 'pikafish',
      protocol: 'UCI',
      loadMethod: 'emscripten-module',
      wasmPath: 'pikafish.wasm',
      nnuePath: 'pikafish.nnue',
      skillLevel: null,
      options: {},
      threads: 1,
      hash: 64,
      timeControl: { searchGraceMs: 5000, stopGraceMs: 3000, newGameReadyTimeoutMs: 30000 },
      workerPath: 'ucci.worker.js',
      adapterPath: 'pikafish.adapter.js',
      loaderPath: 'pikafish.js',
      moduleGlobal: 'Pikafish',
      version: 'test',
      commit: 'test',
      nnueSha256: 'test',
      wasmSha256: 'test',
    }, { threads: 2, hashMb: 128 })
    expect(mapped).toMatchObject({ maxNodes: 100_000, maxDepth: 10, hash: 32 })
  })

  it('按最大厘兵损失过滤候选，而不是盲选较差名次', () => {
    const profile = xiangqiDifficultyProfile(PIKAFISH_ENGINE_ID, 4)
    const result = selectXiangqiDifficultyMove(response([
      { depth: 12, nodes: 100_000, nps: 100_000, elapsedMs: 1000, score: { kind: 'cp', value: 0 }, wdl: { win: 500, draw: 300, loss: 200 }, pv: ['a0a1'], multipv: 1 },
      { depth: 12, nodes: 100_000, nps: 100_000, elapsedMs: 1000, score: { kind: 'cp', value: -100 }, wdl: { win: 480, draw: 300, loss: 220 }, pv: ['a0b0'], multipv: 2 },
      { depth: 12, nodes: 100_000, nps: 100_000, elapsedMs: 1000, score: { kind: 'cp', value: -180 }, wdl: { win: 300, draw: 300, loss: 400 }, pv: ['a0c0'], multipv: 3 },
    ]), profile, 0)
    expect(result.ucci).toBe('a0a1')
  })
})
