import { describe, expect, it } from 'vitest'
import { moveToUcci } from '../engine/ucci'
import {
  mirrorUcci,
  openingCorpusSha256,
  serializePosition,
  validateOpeningCorpus,
  XIANGQI_CALIBRATION_ENGINE_IDS,
  XiangqiGameEngine,
  type XiangqiCalibrationOpening,
  type XiangqiCalibrationOpeningCorpus,
} from '../games/xiangqi'

function createOpenings(count: number): XiangqiCalibrationOpening[] {
  const game = new XiangqiGameEngine()
  const openings: XiangqiCalibrationOpening[] = []
  const positions = new Set<string>()
  const sequences = new Set<string>()
  const mirrors = new Set<string>()
  for (let attempt = 1; openings.length < count && attempt < 100_000; attempt += 1) {
    let state = game.initializeGame()
    const target = 8 + attempt % 13
    for (let ply = 0; ply < target && !state.result; ply += 1) {
      const legal = [...game.getLegalActions(state)].sort((a, b) => moveToUcci(a).localeCompare(moveToUcci(b)))
      const move = legal[mix(attempt, ply) % legal.length]
      state = game.executeAction(state, move)
    }
    if (state.result || state.checkColor || state.history.length < 8) continue
    const moves = state.history.map((record) => record.ucci)
    const sequence = moves.join(' ')
    const mirror = moves.map(mirrorUcci).join(' ')
    const positionKey = serializePosition(state.board, state.turn)
    if (positions.has(positionKey) || sequences.has(sequence) || mirrors.has(sequence) || sequences.has(mirror)) continue
    positions.add(positionKey)
    sequences.add(sequence)
    mirrors.add(mirror)
    openings.push({
      id: `test-${openings.length + 1}`,
      family: ['central-cannon', 'xianren-guide', 'flying-elephant', 'other'][openings.length % 4] as XiangqiCalibrationOpening['family'],
      moves,
      positionKey,
      sourceEngines: [...XIANGQI_CALIBRATION_ENGINE_IDS],
      generationSeed: attempt,
    })
  }
  if (openings.length !== count) throw new Error(`测试语料只生成 ${openings.length}/${count}`)
  return openings
}

function mix(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0
  value ^= value >>> 16
  return Math.imul(value, 0x85ebca6b) >>> 0
}

describe('中国象棋正式开局语料', () => {
  it('验证 500 个合法、唯一且无镜像重复的冻结局面，并稳定计算 SHA-256', async () => {
    const unsigned = {
      schema: 'project10-xiangqi-opening-corpus-v1' as const,
      status: 'frozen' as const,
      generatedAt: '2026-08-26T00:00:00.000Z',
      generator: {
        engineIds: [...XIANGQI_CALIBRATION_ENGINE_IDS],
        nodesPerMove: 10_000,
        multiPv: 4,
        seed: 42,
        balanceCentipawns: 300,
      },
      openings: createOpenings(500),
    }
    const sha256 = await openingCorpusSha256(unsigned)
    const corpus: XiangqiCalibrationOpeningCorpus = { ...unsigned, sha256 }
    expect(validateOpeningCorpus(corpus, true)).toEqual({
      valid: true,
      errors: [],
      uniquePositions: 500,
      uniqueMoveSequences: 500,
    })
    expect(validateOpeningCorpus(corpus, 'quick').valid).toBe(true)
    expect(await openingCorpusSha256(corpus)).toBe(sha256)
    expect(sha256).toMatch(/^[a-f0-9]{64}$/)
  }, 30_000)
})
