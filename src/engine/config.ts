import type { AIEngineConfig } from './types'

export const FAIRY_STOCKFISH_ENGINE_ID = 'fairy-stockfish-nnue'
export const CHESS_FAIRY_STOCKFISH_ENGINE_ID = 'fairy-stockfish-chess-nnue'
export const CHESS_STOCKFISH_18_ENGINE_ID = 'stockfish-18-full'
export const CHESS_STOCKFISH_18_SINGLE_ENGINE_ID = 'stockfish-18-full-single'
export const CHESS_STOCKFISH_18_NATIVE_ENGINE_ID = 'stockfish-18-native-bridge'
export const PIKAFISH_ENGINE_ID = 'pikafish-2026-nnue'
export const PIKAFISH_2025_ENGINE_ID = 'pikafish-2025-nnue'

/**
 * Values intentionally mirror the pre-adapter Worker constants so the
 * compatibility refactor does not alter Fairy-Stockfish playing strength.
 */
export const FAIRY_STOCKFISH_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  id: FAIRY_STOCKFISH_ENGINE_ID,
  gameId: 'xiangqi',
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
  gameId: 'xiangqi',
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
  gameId: 'xiangqi',
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

/**
 * Full-strength standard-chess Fairy-Stockfish session.  The network is kept
 * separate from the Xiangqi network even though both sessions use the same
 * WASM binary and engine core.
 */
export const CHESS_FAIRY_STOCKFISH_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  id: CHESS_FAIRY_STOCKFISH_ENGINE_ID,
  gameId: 'chess',
  name: 'Fairy-Stockfish Chess NNUE',
  engineType: 'fairy-stockfish',
  protocol: 'UCI',
  loadMethod: 'emscripten-module',
  wasmPath: 'stockfish.wasm',
  nnuePath: 'chess-nn-3475407dc199.nnue',
  nnueParts: Object.freeze([
    'chess-nn-3475407dc199.nnue.part-01',
    'chess-nn-3475407dc199.nnue.part-02',
    'chess-nn-3475407dc199.nnue.part-03',
  ]),
  variant: 'chess',
  skillLevel: null,
  styleDescription: '标准国际象棋、固定 NNUE、MultiPV 4 的完整强度 UCI 会话',
  options: Object.freeze({
    Ponder: false,
    MultiPV: 4,
    Skill_Level: 20,
    UCI_LimitStrength: false,
    UCI_ShowWDL: true,
    Use_NNUE: true,
    usemillisec: true,
  }),
  threads: 2,
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
  nnueSha256: '3475407dc19973ea44467678634cce023d620e419770c111cc8937fe6689ec87',
  wasmSha256: '91f78f226169ae0e08be3854e0b4de8f5461844d38f08eaae8e3f8ee0833831d',
})

export function configureChessFairyStockfish(
  threads: number,
  hash: number,
): AIEngineConfig {
  return {
    ...CHESS_FAIRY_STOCKFISH_CONFIG,
    options: { ...CHESS_FAIRY_STOCKFISH_CONFIG.options },
    timeControl: { ...CHESS_FAIRY_STOCKFISH_CONFIG.timeControl },
    nnueParts: [...(CHESS_FAIRY_STOCKFISH_CONFIG.nnueParts ?? [])],
    threads,
    hash,
  }
}

const STOCKFISH_18_BASE = {
  gameId: 'chess' as const,
  name: 'Stockfish 18',
  engineType: 'stockfish-18',
  protocol: 'UCI' as const,
  loadMethod: 'emscripten-module' as const,
  nnuePath: 'embedded-stockfish-18-nnue',
  skillLevel: null,
  styleDescription: 'Stockfish 18 官方核心，MultiPV 1，始终选择主变化第一着。',
  options: Object.freeze({
    Ponder: false,
    MultiPV: 1,
    Skill_Level: 20,
    UCI_LimitStrength: false,
    UCI_ShowWDL: true,
  }),
  threads: 4,
  hash: 128,
  timeControl: Object.freeze({ searchGraceMs: 10_000, stopGraceMs: 5_000, newGameReadyTimeoutMs: 30_000 }),
  workerPath: 'stockfish18.worker.js',
  adapterPath: '',
  version: 'stockfish.js@18.0.8 / Stockfish 18',
  commit: 'cb3d4ee',
} as const

export const CHESS_STOCKFISH_18_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  ...STOCKFISH_18_BASE,
  id: CHESS_STOCKFISH_18_ENGINE_ID,
  loaderPath: 'stockfish-18.js',
  wasmPath: 'stockfish-18.wasm',
  wasmParts: Object.freeze(Array.from({ length: 6 }, (_, index) => `stockfish-18.wasm.part-${String(index + 1).padStart(2, '0')}`)),
  nnueSha256: 'embedded-in-8bef136a3d7a428b5cbc624459a2091fd3e750c22a48dad9ad3b292ac80373cb',
  wasmSha256: '8bef136a3d7a428b5cbc624459a2091fd3e750c22a48dad9ad3b292ac80373cb',
})

export const CHESS_STOCKFISH_18_SINGLE_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  ...STOCKFISH_18_BASE,
  id: CHESS_STOCKFISH_18_SINGLE_ENGINE_ID,
  name: 'Stockfish 18 Single',
  threads: 1,
  hash: 64,
  loaderPath: 'stockfish-18-single.js',
  wasmPath: 'stockfish-18-single.wasm',
  wasmParts: Object.freeze(Array.from({ length: 6 }, (_, index) => `stockfish-18-single.wasm.part-${String(index + 1).padStart(2, '0')}`)),
  nnueSha256: 'embedded-in-f611ac05ddb248fe975a4f180ac9fec7f7fb650f8f17f5fe4230fcc0fe6419c7',
  wasmSha256: 'f611ac05ddb248fe975a4f180ac9fec7f7fb650f8f17f5fe4230fcc0fe6419c7',
})

export const CHESS_STOCKFISH_18_NATIVE_CONFIG: Readonly<AIEngineConfig> = Object.freeze({
  ...STOCKFISH_18_BASE,
  id: CHESS_STOCKFISH_18_NATIVE_ENGINE_ID,
  name: 'Stockfish 18 Native',
  engineType: 'stockfish-18-native',
  workerPath: '',
  adapterPath: '',
  loaderPath: '',
  wasmPath: '',
  nnueSha256: 'embedded-in-official-stockfish-18-native-binary',
  wasmSha256: 'verified-at-native-bridge-startup',
})
