import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KATAGO_CHINESE_PSK_RULES, gtpToGoMove } from '../../src/games/go/ai'
import { GoGameEngine } from '../../src/games/go/game-engine'
import type { GoGameState, GoPlayer } from '../../src/games/go/types'
import { GO_CALIBRATION_OPENINGS } from './openings'

type EngineKind = 'katago' | 'sayuri'
interface SeatClient {
  readonly kind: EngineKind
  readonly label: string
  readonly capabilities: Record<string, unknown>
  move(state: GoGameState): Promise<string>
}

describe('Sayuri / KataGo paired calibration', () => {
  it('runs fixed paired openings and writes an auditable report', async () => {
    const count = positiveInt(process.env.GO_CALIBRATION_OPENINGS, 50)
    const openings = GO_CALIBRATION_OPENINGS.slice(0, count)
    expect(openings).toHaveLength(count)
    validateOpenings(openings)
    if (process.env.GO_CALIBRATION_VALIDATE_ONLY === '1') return

    const engineA = await createClient(
      (process.env.GO_CALIBRATION_ENGINE_A as EngineKind | undefined) ?? 'sayuri',
      process.env.GO_CALIBRATION_ENGINE_A_URL,
      process.env.GO_CALIBRATION_ENGINE_A_LABEL ?? 'Sayuri',
    )
    const engineB = await createClient(
      (process.env.GO_CALIBRATION_ENGINE_B as EngineKind | undefined) ?? 'katago',
      process.env.GO_CALIBRATION_ENGINE_B_URL,
      process.env.GO_CALIBRATION_ENGINE_B_LABEL ?? 'KataGo',
    )
    const games = []
    for (const opening of openings) {
      games.push(await playGame(opening.id, opening.moves, engineA, engineB))
      games.push(await playGame(opening.id, opening.moves, engineB, engineA))
    }

    const technicalFailures = games.filter((game) => game.technicalFailure)
    const normal = games.filter((game) => !game.technicalFailure)
    const aWins = normal.filter((game) => game.winnerLabel === engineA.label).length
    const bWins = normal.filter((game) => game.winnerLabel === engineB.label).length
    const draws = normal.length - aWins - bWins
    const decisiveForA = normal.length ? aWins / normal.length : 0
    const aBlackWinRate = rate(normal, engineA.label, 'black')
    const aWhiteWinRate = rate(normal, engineA.label, 'white')
    const formalAcceptance = engineA.kind === 'sayuri' && engineB.kind === 'katago' && openings.length === 50
    const report = {
      generatedAt: new Date().toISOString(),
      provisional: technicalFailures.length > 0 || normal.length !== openings.length * 2,
      methodology: 'fixed paired 19x19 openings; each engine receives both colors; Chinese area scoring; komi 7.5',
      engineA: { kind: engineA.kind, label: engineA.label, capabilities: engineA.capabilities },
      engineB: { kind: engineB.kind, label: engineB.label, capabilities: engineB.capabilities },
      artifacts: await artifactAudit(engineA.kind, engineB.kind),
      openings: openings.length,
      gamesRequested: openings.length * 2,
      gamesCompleted: normal.length,
      technicalFailures: technicalFailures.length,
      results: {
        engineAWins: aWins,
        engineBWins: bWins,
        draws,
        engineAWinRate: decisiveForA,
        engineAWilson95: wilson95(aWins, normal.length),
        engineABlackWinRate: aBlackWinRate,
        engineAWhiteWinRate: aWhiteWinRate,
        colorBiasFlag: Math.abs(aBlackWinRate - aWhiteWinRate) > 0.15,
        formalAcceptance,
        accepted40To60: formalAcceptance && decisiveForA >= 0.4 && decisiveForA <= 0.6,
      },
      games,
    }
    const outputDir = resolve(process.env.GO_CALIBRATION_OUTPUT_DIR ?? 'reports/go-ai-calibration')
    await mkdir(outputDir, { recursive: true })
    const output = resolve(outputDir, `calibration-${Date.now()}.json`)
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    process.stdout.write(`\nCalibration report: ${output}\n`)
    process.stdout.write(`Engine A win rate: ${(decisiveForA * 100).toFixed(1)}%; Wilson 95% ${formatInterval(report.results.engineAWilson95)}\n`)

    expect(technicalFailures, '技术失败、非法着、服务崩溃或超时必须修复后重赛，不能计作负局').toHaveLength(0)
    expect(normal).toHaveLength(openings.length * 2)
    if (formalAcceptance) {
      expect(decisiveForA, '正式 100 局验收要求 Sayuri 胜率处于 40%–60%；超出时必须调整一次 KataGo battle-matched visits 并整组重赛').toBeGreaterThanOrEqual(0.4)
      expect(decisiveForA).toBeLessThanOrEqual(0.6)
    }
  })
})

async function createClient(kind: EngineKind, baseUrl: string | undefined, label: string): Promise<SeatClient> {
  if (kind === 'sayuri') return createSayuriClient(baseUrl ?? 'http://127.0.0.1:8790/api/go/sayuri', label)
  if (kind === 'katago') return createKataGoClient(baseUrl ?? 'http://127.0.0.1:8788/api/go/katago', label)
  throw new Error(`Unsupported calibration engine: ${kind}`)
}

async function createSayuriClient(baseUrl: string, label: string): Promise<SeatClient> {
  const response = await fetch(`${baseUrl}/capabilities`, { signal: AbortSignal.timeout(600_000) })
  if (!response.ok) throw new Error(`Sayuri capabilities failed: ${response.status} ${await response.text()}`)
  const capabilities = await response.json() as Record<string, unknown>
  return {
    kind: 'sayuri', label, capabilities,
    async move(state) {
      const response = await fetch(`${baseUrl}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(positionRequest(state, `cal-sy-${crypto.randomUUID()}`)),
        signal: AbortSignal.timeout(Number(capabilities.timeoutMs ?? 180_000) + 15_000),
      })
      if (!response.ok) throw new Error(`Sayuri analyze failed: ${response.status} ${await response.text()}`)
      return String((await response.json() as { move: string }).move)
    },
  }
}

async function createKataGoClient(baseUrl: string, label: string): Promise<SeatClient> {
  const secrets = await localKataGoSecrets()
  const headers = { 'X-KataGo-Proxy-Secret': secrets.proxySecret }
  const session = await fetch(`${baseUrl}/session`, { method: 'POST', headers })
  if (!session.ok) throw new Error(`KataGo session failed: ${session.status} ${await session.text()}`)
  const cookie = session.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('KataGo bridge did not issue a session cookie.')
  const authHeaders = { ...headers, Cookie: cookie }
  const response = await fetch(`${baseUrl}/capabilities`, { headers: authHeaders })
  if (!response.ok) throw new Error(`KataGo capabilities failed: ${response.status} ${await response.text()}`)
  const capabilities = await response.json() as Record<string, unknown>
  return {
    kind: 'katago', label, capabilities,
    async move(state) {
      const response = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...positionRequest(state, `cal-kg-${crypto.randomUUID()}`),
          profile: 'battle-matched',
          rules: KATAGO_CHINESE_PSK_RULES,
        }),
        signal: AbortSignal.timeout(195_000),
      })
      if (!response.ok) throw new Error(`KataGo analyze failed: ${response.status} ${await response.text()}`)
      const events = (await response.text()).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      const error = events.find((event) => event.type === 'error')
      if (error) throw new Error(`KataGo analyze error: ${error.message}`)
      const final = events.findLast((event) => event.type === 'analysis' && event.stage === 'final')
      if (!final?.candidates?.[0]?.move) throw new Error('KataGo did not return a final move.')
      return String(final.candidates[0].move)
    },
  }
}

async function playGame(openingId: string, opening: readonly string[], black: SeatClient, white: SeatClient) {
  const engine = new GoGameEngine()
  let state = engine.init()
  const startedAt = Date.now()
  try {
    for (const vertex of opening) state = engine.applyMove(state, gtpToGoMove(vertex))
    while (state.phase === 'playing') {
      if (state.history.length >= 800) throw new Error('800-move safety limit reached')
      const client = state.turn === 'black' ? black : white
      const vertex = await client.move(state)
      state = engine.applyMove(state, gtpToGoMove(vertex))
    }
    const final = engine.finalizeScoring(state)
    const winnerLabel = final.result?.winner === 'black' ? black.label : final.result?.winner === 'white' ? white.label : null
    return {
      openingId, black: black.label, white: white.label, winner: final.result?.winner ?? null,
      winnerLabel, margin: final.result?.score.margin ?? null, moves: final.history.length,
      elapsedMs: Date.now() - startedAt, technicalFailure: null,
    }
  } catch (error) {
    return {
      openingId, black: black.label, white: white.label, winner: null, winnerLabel: null,
      margin: null, moves: state.history.length, elapsedMs: Date.now() - startedAt,
      technicalFailure: error instanceof Error ? error.message : String(error),
    }
  }
}

function positionRequest(state: GoGameState, requestId: string) {
  return {
    requestId, gameId: 'go', player: state.turn, boardSize: 19, komi: 7.5,
    moves: state.history.map((record) => [record.color === 'black' ? 'B' : 'W', record.notation] as const),
  }
}

function validateOpenings(openings: readonly { id: string; moves: readonly string[] }[]) {
  const engine = new GoGameEngine()
  const fingerprints = new Set<string>()
  for (const opening of openings) {
    let state = engine.init()
    for (const move of opening.moves) state = engine.applyMove(state, gtpToGoMove(move))
    const fingerprint = opening.moves.join(',')
    if (fingerprints.has(fingerprint)) throw new Error(`Duplicate opening: ${opening.id}`)
    fingerprints.add(fingerprint)
    if (state.phase !== 'playing') throw new Error(`Opening already ended: ${opening.id}`)
  }
}

async function localKataGoSecrets() {
  const text = await readFile(resolve('services/katago-bridge/.env'), 'utf8')
  const values = Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
  return { proxySecret: values.KATAGO_PROXY_SECRET ?? '' }
}

async function artifactAudit(engineAKind: EngineKind, engineBKind: EngineKind) {
  const readEnv = async (path: string) => {
    try {
      const text = await readFile(resolve(path), 'utf8')
      return Object.fromEntries(text.split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }))
    } catch { return {} }
  }
  const sayuri = await readEnv('services/sayuri-bridge/.env')
  const katago = await readEnv('services/katago-bridge/.env')
  const hashFor = (kind: EngineKind, seat: 'A' | 'B') => process.env[`GO_CALIBRATION_ENGINE_${seat}_SHA256`] ??
    (kind === 'sayuri' ? sayuri.SAYURI_MODEL_SHA256 : katago.KATAGO_MODEL_SHA256) ?? null
  return {
    engineAModelSha256: hashFor(engineAKind, 'A'),
    engineBModelSha256: hashFor(engineBKind, 'B'),
    sayuriBinarySha256: sayuri.SAYURI_BIN_SHA256 ?? null,
    katagoBinarySha256: katago.KATAGO_BIN_SHA256 ?? null,
  }
}

function rate(games: readonly any[], label: string, color: GoPlayer) {
  const selected = games.filter((game) => game[color] === label)
  return selected.length ? selected.filter((game) => game.winnerLabel === label).length / selected.length : 0
}

function wilson95(wins: number, games: number): [number, number] {
  if (!games) return [0, 0]
  const z = 1.959963984540054
  const p = wins / games
  const denominator = 1 + z * z / games
  const center = (p + z * z / (2 * games)) / denominator
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * games)) / games) / denominator
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}

function formatInterval([low, high]: [number, number]) {
  return `${(low * 100).toFixed(1)}%–${(high * 100).toFixed(1)}%`
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
