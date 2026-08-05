import type { SearchInfo } from '../game/types'
import type { MultiPvCount } from './search-policy'

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
  name: string
  engineType: string
  protocol: EngineProtocol
  loadMethod: 'emscripten-module'
  wasmPath: string
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
