export type EngineGameId = 'xiangqi' | 'go'
export type EngineRuntimeKind = 'browser-worker' | 'browser-webgpu' | 'browser-wasm' | 'native-bridge'
export type SearchBudgetUnit = 'milliseconds' | 'depth' | 'visits' | 'playouts'
export type AnalysisPolicy = 'off' | 'live' | 'postgame'
export type EngineRuntimePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'thinking'
  | 'paused'
  | 'error'
  | 'recovering'
  | 'unavailable'

export interface SearchBudget {
  unit: SearchBudgetUnit
  requested: number
  completed?: number
}

export interface EngineCapabilities {
  winRate: boolean
  scoreLead: boolean
  multiCandidate: boolean
  streaming: boolean
  cancellation: boolean
  budgetUnits: readonly SearchBudgetUnit[]
}

/** Static, serializable engine metadata shared by every game UI. */
export interface EngineDescriptor {
  id: string
  gameId: EngineGameId
  name: string
  version: string
  model: string
  modelSha256?: string
  protocol: string
  runtime: EngineRuntimeKind
  capabilities: EngineCapabilities
}

/** Runtime facts; unlike marketing labels these values describe this session. */
export interface EngineRuntimeSnapshot {
  descriptor: EngineDescriptor
  phase: EngineRuntimePhase
  backendLabel: string
  threads?: number
  hashMb?: number
  batchSize?: number
  budget?: SearchBudget
  elapsedMs?: number
  truncated?: boolean
  stopReason?: string
  error?: string
}

export interface MatchSessionSnapshot<TState, TPlayer> {
  state: TState | null
  phase: 'idle' | 'starting' | 'playing' | 'review' | 'paused' | 'finished' | 'error' | 'disposed'
  revision: number
  currentPlayer: TPlayer | null
  engines: readonly EngineRuntimeSnapshot[]
  error: string | null
}
