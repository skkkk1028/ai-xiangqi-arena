import { FAIRY_STOCKFISH_ENGINE_ID, PIKAFISH_2025_ENGINE_ID, PIKAFISH_ENGINE_ID } from '../../engine/config'
import { XiangqiGameEngine } from './game-engine'
import type { RedOpeningFamily } from '../../engine/openings'

export interface XiangqiCalibrationOpening {
  id: string
  family: RedOpeningFamily
  moves: readonly string[]
  positionKey: string
  sourceEngines: readonly string[]
  generationSeed: number
}

export interface XiangqiCalibrationOpeningCorpus {
  schema: 'project10-xiangqi-opening-corpus-v1'
  status: 'candidate' | 'frozen'
  generatedAt: string
  generator: {
    engineIds: readonly string[]
    nodesPerMove: number
    multiPv: number
    seed: number
    balanceCentipawns: number
  }
  openings: readonly XiangqiCalibrationOpening[]
  sha256: string
}

export interface OpeningCorpusValidation {
  valid: boolean
  errors: readonly string[]
  uniquePositions: number
  uniqueMoveSequences: number
}

export const XIANGQI_CALIBRATION_ENGINE_IDS = Object.freeze([
  FAIRY_STOCKFISH_ENGINE_ID,
  PIKAFISH_ENGINE_ID,
  PIKAFISH_2025_ENGINE_ID,
] as const)

export function validateOpeningCorpus(
  corpus: Pick<XiangqiCalibrationOpeningCorpus, 'status' | 'generator' | 'openings'>,
  requirement: boolean | 'quick' | 'formal' = false,
): OpeningCorpusValidation {
  const errors: string[] = []
  const game = new XiangqiGameEngine()
  const positions = new Set<string>()
  const sequences = new Set<string>()
  const mirroredSequences = new Set<string>()
  const expectedEngines = new Set(XIANGQI_CALIBRATION_ENGINE_IDS)
  const families = new Set<RedOpeningFamily>()
  const requireFormal = requirement === true || requirement === 'formal'
  const requireQuick = requirement === 'quick'
  if (requireFormal && corpus.status !== 'frozen') errors.push('正式校准只接受 frozen 开局语料。')
  if (requireFormal && corpus.openings.length < 500) errors.push('正式校准开局语料不得少于 500 个局面。')
  if (requireQuick && corpus.status !== 'frozen') errors.push('快速校准只接受 frozen 开局语料。')
  if (requireQuick && corpus.openings.length < 220) errors.push('快速校准开局语料不得少于 220 个局面。')
  if ((requireFormal || requireQuick) && (
    corpus.generator.engineIds.length !== expectedEngines.size ||
    corpus.generator.engineIds.some((engineId) => !expectedEngines.has(engineId as typeof XIANGQI_CALIBRATION_ENGINE_IDS[number]))
  )) errors.push(`${requireFormal ? '正式' : '快速'}语料必须由当前三个象棋引擎共同生成。`)

  for (const opening of corpus.openings) {
    families.add(opening.family)
    if ((requireFormal || requireQuick) && (
      opening.sourceEngines.length !== expectedEngines.size ||
      opening.sourceEngines.some((engineId) => !expectedEngines.has(engineId as typeof XIANGQI_CALIBRATION_ENGINE_IDS[number]))
    )) errors.push(`${opening.id}: 必须记录三个引擎共同参与生成。`)
    if (opening.moves.length < 8 || opening.moves.length > 20) {
      errors.push(`${opening.id}: 开局深度必须是 8–20 个半回合。`)
      continue
    }
    let state = game.initializeGame()
    let legal = true
    for (const ucci of opening.moves) {
      const move = game.findLegalActionByUcci(state, ucci)
      if (!move) {
        errors.push(`${opening.id}: 非法着法 ${ucci}。`)
        legal = false
        break
      }
      state = game.executeAction(state, move)
      if (state.result) {
        errors.push(`${opening.id}: 开局前缀已经终局。`)
        legal = false
        break
      }
    }
    if (!legal) continue
    if (state.checkColor) errors.push(`${opening.id}: 冻结局面不得正在被将军。`)
    const positionKey = serializePosition(state.board, state.turn)
    if (opening.positionKey !== positionKey) errors.push(`${opening.id}: positionKey 与重放局面不一致。`)
    if (positions.has(positionKey)) errors.push(`${opening.id}: positionKey 重复。`)
    positions.add(positionKey)
    const sequence = opening.moves.join(' ')
    const mirror = opening.moves.map(mirrorUcci).join(' ')
    if (sequences.has(sequence)) errors.push(`${opening.id}: 着法序列重复。`)
    if (mirroredSequences.has(sequence) || sequences.has(mirror)) errors.push(`${opening.id}: 与另一开局镜像重复。`)
    sequences.add(sequence)
    mirroredSequences.add(mirror)
  }
  if (requireFormal || requireQuick) {
    for (const family of ['central-cannon', 'xianren-guide', 'flying-elephant', 'other'] as const) {
      if (!families.has(family)) errors.push(`${requireFormal ? '正式' : '快速'}语料缺少 ${family} 开局体系。`)
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    uniquePositions: positions.size,
    uniqueMoveSequences: sequences.size,
  }
}

export async function openingCorpusSha256(
  corpus: Pick<XiangqiCalibrationOpeningCorpus, 'schema' | 'status' | 'generatedAt' | 'generator' | 'openings'>,
): Promise<string> {
  const canonical = JSON.stringify({
    schema: corpus.schema,
    status: corpus.status,
    generator: corpus.generator,
    openings: corpus.openings,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function serializePosition(
  board: ReturnType<XiangqiGameEngine['initializeGame']>['board'],
  turn: 'red' | 'black',
): string {
  return `${turn}:` + board.map((row) => row.map((piece) =>
    piece ? `${piece.color[0]}${piece.type[0]}${piece.id}` : '.').join(',')).join('/')
}

export function mirrorUcci(ucci: string): string {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(ucci)) return ucci
  return `${mirrorFile(ucci[0])}${ucci[1]}${mirrorFile(ucci[2])}${ucci[3]}`
}

function mirrorFile(file: string): string {
  return String.fromCharCode('i'.charCodeAt(0) - (file.charCodeAt(0) - 'a'.charCodeAt(0)))
}
