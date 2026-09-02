import type { CalibrationSummary } from './calibration'

export const XIANGQI_TUNING_LIMITS = Object.freeze({
  maxPairs: 200,
  probePairsMin: 25,
  probePairsMax: 50,
  maxNodes: 5_000_000,
  maxMasterMs: 60_000,
  maxBattleMs: 55_000,
  maxBattleMultiplier: 3,
  latencyMs: Object.freeze({
    'battle-full': 55_000,
    'human-l1': 3_000,
    'human-l2': 6_000,
    'human-l3': 12_000,
    'human-l4': 24_000,
    'human-l5': 60_000,
  }),
})

export interface XiangqiTuningCandidate {
  maxNodes?: number
  budgetMs: number
  multiPv: 1 | 2 | 3 | 4
}

export function geometricNodeProbes(
  baselineNodes: number,
  maximumNodes: number = XIANGQI_TUNING_LIMITS.maxNodes,
): readonly number[] {
  if (!Number.isInteger(baselineNodes) || baselineNodes < 1) throw new Error('基准节点必须是正整数。')
  if (maximumNodes < baselineNodes || maximumNodes > XIANGQI_TUNING_LIMITS.maxNodes) {
    throw new Error('节点探测上限无效。')
  }
  const probes: number[] = []
  let current = baselineNodes
  while (current < maximumNodes) {
    current = Math.min(maximumNodes, current * 2)
    probes.push(current)
  }
  return probes
}

/** Geometric midpoint is appropriate because engine strength scales roughly with log(resources). */
export function bisectNodeBudget(lowerNodes: number, upperNodes: number): number {
  if (!Number.isInteger(lowerNodes) || !Number.isInteger(upperNodes) || lowerNodes < 1 || upperNodes <= lowerNodes) {
    throw new Error('节点二分边界无效。')
  }
  return Math.max(lowerNodes + 1, Math.min(upperNodes - 1, Math.round(Math.sqrt(lowerNodes * upperNodes))))
}

export function enhancedFullStrengthCandidate(
  baselineBudgetMs: number,
  requestedBudgetMs: number,
  mode: 'battle-full' | 'human-l5',
): XiangqiTuningCandidate {
  if (requestedBudgetMs < baselineBudgetMs) throw new Error('只增强策略禁止降低搜索时间。')
  const cap = mode === 'battle-full' ? XIANGQI_TUNING_LIMITS.maxBattleMs : XIANGQI_TUNING_LIMITS.maxMasterMs
  if (requestedBudgetMs > cap) throw new Error(`搜索时间超过 ${cap} ms 上限。`)
  if (mode === 'battle-full' && requestedBudgetMs > baselineBudgetMs * XIANGQI_TUNING_LIMITS.maxBattleMultiplier) {
    throw new Error('引擎大战增强时间不得超过基础预算的 3 倍。')
  }
  return { budgetMs: requestedBudgetMs, multiPv: 1 }
}

export function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('延迟样本必须是非负有限数。')
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(ordered.length * 0.95) - 1]
}

export function passesLatencyGate(
  scenario: keyof typeof XIANGQI_TUNING_LIMITS.latencyMs,
  elapsedMs: readonly number[],
): boolean {
  const p95 = percentile95(elapsedMs)
  return p95 !== null && p95 <= XIANGQI_TUNING_LIMITS.latencyMs[scenario]
}

export function formalQualification(
  summary: Pick<CalibrationSummary,
    'practicallyEquivalent' | 'technicalFailures' | 'timeouts' | 'moveLimits' | 'invalidPairs'>,
  latencyPassed: boolean,
): 'validated' | 'unmatched' {
  return summary.practicallyEquivalent && summary.technicalFailures === 0 && summary.timeouts === 0 &&
    summary.moveLimits === 0 && summary.invalidPairs === 0 && latencyPassed
    ? 'validated'
    : 'unmatched'
}
