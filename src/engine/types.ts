import type { SearchInfo } from '../game/types'
import type { MultiPvCount } from './search-policy'
import type { EngineDescriptor } from '../games/core/engine-runtime'

export type EngineProtocol = 'UCCI' | 'UCI'

export type EngineOptionValue = string | number | boolean

export interface EngineTimeControl {
  searchGraceMs: number
  stopGraceMs: number
  newGameReadyTimeoutMs: number
}

/** Serializable configuration shared by the UI adapter and its Worker runtime. */
export interface AIEngineConfig {
  id: string
  /** The board-game namespace owns this configuration. */
  gameId: import('../games/core/engine-runtime').EngineGameId
  name: string
  engineType: string
  protocol: EngineProtocol
  loadMethod: 'emscripten-module'
  wasmPath: string
  wasmParts?: readonly string[]
  nnuePath: string
  nnueParts?: readonly string[]
  skillLevel: number | null
  styleDescription?: string
  options: Readonly<Record<string, EngineOptionValue>>
  threads: number
  hash: number
  timeControl: Readonly<EngineTimeControl>
  workerPath: string
  adapterPath: string
  loaderPath: string
  /** Global Emscripten module factory exported by loaderPath. */
  moduleGlobal?: string
  version: string
  commit: string
  nnueSha256: string
  wasmSha256: string
  /** Standard UCI variant name when the adapter must switch Fairy-Stockfish variants. */
  variant?: string
}

export function xiangqiEngineDescriptor(config: Readonly<AIEngineConfig>): EngineDescriptor {
  return {
    id: config.id,
    gameId: config.gameId,
    name: config.name,
    version: config.version,
    model: config.nnuePath,
    modelSha256: config.nnueSha256,
    protocol: config.protocol,
    runtime: 'browser-worker',
    capabilities: {
      winRate: true,
      scoreLead: false,
      multiCandidate: true,
      streaming: true,
      cancellation: true,
      budgetUnits: ['milliseconds', 'depth'],
    },
  }
}

export interface EngineProgress {
  phase: 'checking' | 'downloading' | 'loading' | 'verifying' | 'initializing' | 'ready'
  loaded: number
  total: number
  message: string
}

export interface EngineSearchOptions {
  multiPv: MultiPvCount
  /** Optional human-mode limit. Existing AI modes deliberately leave this unset. */
  maxDepth?: number
  onInfo?: (info: SearchInfo) => void
}

export interface EngineAdapterContext {
  assetBase: string
  onProgress: (progress: EngineProgress) => void
  onRuntimeFatal?: (error: Error) => void
}
