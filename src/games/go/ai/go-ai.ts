import type { GoMove, GoPlayer } from '../types'

export type GoAIEngineId = 'katago' | 'leela-zero' | 'sayuri'

export interface GoAIEngineOption {
  id: GoAIEngineId
  name: string
  description: string
  localOnly: boolean
}

export const GO_AI_ENGINES: readonly GoAIEngineOption[] = [
  {
    id: 'katago',
    name: 'KataGo',
    description: 'Native OpenCL · 互对弈使用独立校准 visits',
    localOnly: false,
  },
  {
    id: 'leela-zero',
    name: 'Leela Zero',
    description: 'v0.17 · 最终 40×256 网络 · 3200 playouts',
    localOnly: true,
  },
  {
    id: 'sayuri',
    name: 'Sayuri',
    description: 'v0.10.0 · CUDA 12 · 独立神经网络与 MCTS',
    localOnly: true,
  },
] as const

export interface GoAIEngineRuntimeDetails {
  engineVersion: string
  modelName: string
  budget: number
  budgetUnit: 'visits' | 'playouts'
  runtimeLabel: string
}

export interface GoAICandidateAnalysis {
  action: GoMove
  notation: string
  order: number
  visits: number
  prior: number | null
  blackWinRate: number
  scoreLeadBlack: number | null
  pv: readonly GoMove[]
  pvNotation: readonly string[]
}

export interface GoAIAnalysis {
  engineId: GoAIEngineId
  engineName: string
  requestId: string
  player: GoPlayer
  stage: 'partial' | 'final'
  action: GoMove
  blackWinRate: number
  whiteWinRate: number
  currentPlayerWinRate: number
  winRateAvailable: boolean
  winRateChange: number | null
  scoreLeadBlack: number | null
  visits: number
  elapsedMs: number
  requestedVisits: number
  runtimeLabel: string
  timedOut: boolean
  truncated: boolean
  stopReason: 'in-progress' | 'visit-limit' | 'time-limit'
  pv: readonly GoMove[]
  pvNotation: readonly string[]
  candidates: readonly GoAICandidateAnalysis[]
  engineVersion: string
  modelName: string
  profileLabel: string
}

export type GoAIAnalysisListener = (analysis: GoAIAnalysis) => void

export function goAIEngineName(id: GoAIEngineId): string {
  return GO_AI_ENGINES.find((engine) => engine.id === id)?.name ?? id
}
