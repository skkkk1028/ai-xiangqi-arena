import type { GoMove, GoPlayer } from '../types'
import type { EngineDescriptor } from '../../core'

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
    description: 'Native OpenCL · 保守 250 visits（未证明匹配）',
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
    description: 'v0.10.0 · CUDA 12 · 250 playouts（保守校准值）',
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

export function goEngineDescriptor(
  id: GoAIEngineId,
  details?: Partial<GoAIEngineRuntimeDetails>,
): EngineDescriptor {
  const native = id !== 'katago'
  return {
    id,
    gameId: 'go',
    name: goAIEngineName(id),
    version: details?.engineVersion ?? '运行时检测',
    model: details?.modelName ?? '运行时检测',
    protocol: id === 'katago' ? 'KataGo Analysis' : 'GTP',
    runtime: native || details?.runtimeLabel?.includes('Native') ? 'native-bridge'
      : details?.runtimeLabel?.includes('WASM') ? 'browser-wasm'
      : details?.runtimeLabel?.includes('CPU') ? 'browser-worker' : 'browser-webgpu',
    capabilities: {
      winRate: id === 'katago',
      scoreLead: id === 'katago',
      multiCandidate: id === 'katago',
      streaming: id === 'katago',
      cancellation: true,
      budgetUnits: [id === 'katago' ? 'visits' : 'playouts'],
    },
  }
}
