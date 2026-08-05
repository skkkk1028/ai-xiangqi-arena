import type { AIEngineConfig } from './types'

export const FAIRY_STOCKFISH_ENGINE_ID = 'fairy-stockfish-nnue'
export const PIKAFISH_ENGINE_ID = 'pikafish-2026-nnue'
export const PIKAFISH_2025_ENGINE_ID = 'pikafish-2025-nnue'

/**
 * Values intentionally mirror the pre-adapter Worker constants so the
 * compatibility refactor does not alter Fairy-Stockfish playing strength.
 */
export const FAIRY_STOCKFISH_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  id: FAIRY_STOCKFISH_ENGINE_ID,
  name: 'Fairy-Stockfish NNUE',
  engineType: 'fairy-stockfish',
  protocol: 'UCCI',
  loadMethod: 'emscripten-module',
  wasmPath: 'stockfish.wasm',
  nnuePath: 'xiangqi-c07e94a5c7cb.nnue',
  skillLevel: 20,
  styleDescription: '通用高水平搜索，可由现有安全人格层塑造进攻或稳健倾向',
  options: Object.freeze({
    Ponder: false,
    MultiPV: 3,
    Skill_Level: 20,
    UCI_LimitStrength: false,
    UCI_ShowWDL: true,
    Use_NNUE: true,
    usemillisec: true,
  }),
  threads: 1,
  hash: 64,
  timeControl: Object.freeze({
    searchGraceMs: 5_000,
    stopGraceMs: 3_000,
    newGameReadyTimeoutMs: 30_000,
  }),
  workerPath: 'ucci.worker.js',
  adapterPath: 'fairy-stockfish.adapter.js',
  loaderPath: 'stockfish.js',
  version: 'fairy-stockfish-nnue.wasm@1.1.11',
  commit: '5589ea54',
  nnueSha256: 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
  wasmSha256: '91f78f226169ae0e08be3854e0b4de8f5461844d38f08eaae8e3f8ee0833831d',
})

export const PIKAFISH_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  id: PIKAFISH_ENGINE_ID,
  name: 'Pikafish 2026 NNUE',
  engineType: 'pikafish',
  protocol: 'UCI',
  loadMethod: 'emscripten-module',
  wasmPath: 'pikafish.wasm',
  nnuePath: 'pikafish.nnue',
  nnueParts: Object.freeze([
    'pikafish.nnue.part-01',
    'pikafish.nnue.part-02',
    'pikafish.nnue.part-03',
  ]),
  skillLevel: null,
  styleDescription: '官方满强度中国象棋 NNUE 引擎，不使用 Skill 降强度',
  options: Object.freeze({
    Ponder: false,
    MultiPV: 3,
    UCI_ShowWDL: true,
  }),
  threads: 1,
  hash: 64,
  timeControl: Object.freeze({
    searchGraceMs: 5_000,
    stopGraceMs: 3_000,
    newGameReadyTimeoutMs: 30_000,
  }),
  workerPath: 'ucci.worker.js',
  adapterPath: 'pikafish.adapter.js',
  loaderPath: 'pikafish.js',
  moduleGlobal: 'Pikafish',
  version: 'Pikafish-2026-01-02',
  commit: 'ce0679e00ee196f7ba17f6ec18941b9a5036f8cf',
  nnueSha256: 'c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77',
  wasmSha256: '1233b07cbc741faac3e8251f91b8c74b048938a62bd3a01535bfd1d8b3907e12',
})

/** Fixed official core at full strength; no Skill or search downgrade. */
export const PIKAFISH_2025_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  id: PIKAFISH_2025_ENGINE_ID,
  name: 'Pikafish 2025 NNUE',
  engineType: 'pikafish',
  protocol: 'UCI',
  loadMethod: 'emscripten-module',
  wasmPath: 'pikafish-2025.wasm',
  nnuePath: 'pikafish-2025.nnue',
  nnueParts: Object.freeze([
    'pikafish-2025.nnue.part-01',
    'pikafish-2025.nnue.part-02',
    'pikafish-2025.nnue.part-03',
  ]),
  skillLevel: null,
  styleDescription: '官方 2025 固定核心与匹配 NNUE，满强度运行，不使用 Skill 限制',
  options: Object.freeze({
    Ponder: false,
    MultiPV: 3,
    UCI_ShowWDL: true,
  }),
  threads: 1,
  hash: 64,
  timeControl: Object.freeze({
    searchGraceMs: 5_000,
    stopGraceMs: 3_000,
    newGameReadyTimeoutMs: 30_000,
  }),
  workerPath: 'ucci.worker.js',
  adapterPath: 'pikafish.adapter.js',
  loaderPath: 'pikafish-2025.js',
  moduleGlobal: 'Pikafish2025',
  version: 'Pikafish-2025-06-23',
  commit: '2b6cf79d55d9d168604cf42ce61b517653d6f2fc',
  nnueSha256: '9b2ce59b760c26f284b9fcadd091fa789d9fd4e8c1dd71ffbd42212503a13e95',
  wasmSha256: 'f69321101d5dc8f8228f1ddc51abee0838f5f59d632fe4672623cc41538d282c',
})

export function configureFairyStockfish(
  threads: number,
  hash: number,
): AIEngineConfig {
  return {
    ...FAIRY_STOCKFISH_CONFIG,
    options: { ...FAIRY_STOCKFISH_CONFIG.options },
    timeControl: { ...FAIRY_STOCKFISH_CONFIG.timeControl },
    threads,
    hash,
  }
}
