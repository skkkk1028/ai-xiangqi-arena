import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KATAGO_CHINESE_PSK_RULES, gtpToGoMove } from '../../src/games/go/ai'
import { GoGameEngine } from '../../src/games/go/game-engine'
import type { GoGameState, GoPlayer } from '../../src/games/go/types'
import { GO_CALIBRATION_OPENINGS, type CalibrationOpening } from './openings'

type EngineKind = 'katago' | 'sayuri'
interface SeatClient {
  readonly kind: EngineKind
  readonly label: string
  readonly capabilities: Record<string, unknown>
  move(state: GoGameState): Promise<string>
}

type TechnicalFailureKind = 'timeout' | 'oom' | 'crash' | 'illegal-move' | 'session' | 'other'

interface CalibrationGame {
  openingId: string
  openingFamilyId: string
  openingTransform: CalibrationOpening['transform']
  black: string
  white: string
  winner: GoPlayer | null
  winnerLabel: string | null
  margin: number | null
  moves: number
  elapsedMs: number
  technicalFailure: string | null
  technicalFailureKind: TechnicalFailureKind | null
}

describe('Sayuri / KataGo paired calibration', () => {
  it('runs fixed paired openings and writes an auditable report', async () => {
    let runStartedAt = Date.now()
    let runId = `${new Date(runStartedAt).toISOString().replace(/[:.]/g, '-')}-${process.pid}`
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
    const artifacts = await artifactAudit(engineA.kind, engineB.kind)
    let games: CalibrationGame[] = []
    let retryHistory: CalibrationGame[] = []
    const outputDir = resolve(process.env.GO_CALIBRATION_OUTPUT_DIR ?? 'reports/go-ai-calibration')
    await mkdir(outputDir, { recursive: true })
    let output = resolve(outputDir, `calibration-${runId}.json`)
    if (process.env.GO_CALIBRATION_RESUME_FILE) {
      output = resolve(process.env.GO_CALIBRATION_RESUME_FILE)
      const previous = JSON.parse(await readFile(output, 'utf8')) as any
      assertCompatibleResume(previous, { openings, engineA, engineB, artifacts })
      runId = String(previous.runId)
      runStartedAt = Date.parse(String(previous.startedAt))
      games = (previous.games as CalibrationGame[]).filter((game) => !game.technicalFailure)
      retryHistory = [
        ...((previous.retryHistory as CalibrationGame[] | undefined) ?? []),
        ...(previous.games as CalibrationGame[]).filter((game) => game.technicalFailure),
      ]
      process.stdout.write(`Resuming ${games.length}/${openings.length * 2} completed games from ${output}; retrying ${retryHistory.length} recorded failures.\n`)
    }
    for (const opening of openings) {
      for (const [black, white] of [[engineA, engineB], [engineB, engineA]] as const) {
        if (games.some((game) => game.openingId === opening.id && game.black === black.label && game.white === white.label)) continue
        games.push(await playGame(opening, black, white))
        await checkpoint('in-progress')
      }
    }

    const report = await checkpoint('completed')
    process.stdout.write(`\nCalibration report: ${output}\n`)
    process.stdout.write(`Completion: ${(report.completionRate * 100).toFixed(1)}%; wall time ${formatDuration(report.wallClockElapsedMs)}; crashes ${report.failures.crash}; OOM ${report.failures.oom}\n`)
    process.stdout.write(`Engine A win rate: ${(report.results.engineAWinRate * 100).toFixed(1)}%; descriptive Wilson 95% ${formatInterval(report.results.engineAWilson95)}\n`)

    expect(report.technicalFailures, '技术失败、非法着、服务崩溃或超时必须修复后重赛，不能计作负局').toBe(0)
    expect(report.gamesCompleted).toBe(openings.length * 2)
    if (report.formalDesign) {
      expect(report.results.matched40To60, '只有完整 100 局且 Wilson 95% 区间整体位于 40%–60% 实用等效区间内，才可标记为匹配；否则保留保守配置').toBe(true)
    }

    async function checkpoint(phase: 'in-progress' | 'completed') {
      const report = buildReport({
        phase, runId, runStartedAt, openings, games, retryHistory, engineA, engineB, artifacts,
      })
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      if (phase === 'in-progress') {
        const last = games.at(-1)
        process.stdout.write(`[${games.length}/${openings.length * 2}] ${last?.openingId} ${last?.black} vs ${last?.white}: ${last?.technicalFailure ? `FAILED ${last.technicalFailureKind}` : `${last?.winnerLabel ?? 'draw'} won`} · ${formatDuration(last?.elapsedMs ?? 0)}\n`)
      }
      return report
    }
  })
})

async function createClient(kind: EngineKind, baseUrl: string | undefined, label: string): Promise<SeatClient> {
  if (kind === 'sayuri') return createSayuriClient(baseUrl ?? 'http://127.0.0.1:8790/api/go/sayuri', label)
  if (kind === 'katago') return createKataGoClient(baseUrl ?? 'http://127.0.0.1:8788/api/go/katago', label)
  throw new Error(`Unsupported calibration engine: ${kind}`)
}

function assertCompatibleResume(previous: any, {
  openings, engineA, engineB, artifacts,
}: {
  openings: readonly CalibrationOpening[]
  engineA: SeatClient
  engineB: SeatClient
  artifacts: Awaited<ReturnType<typeof artifactAudit>>
}) {
  if (previous.gamesRequested !== openings.length * 2) throw new Error('Resume report uses a different opening count.')
  if (previous.engineA?.kind !== engineA.kind || previous.engineA?.label !== engineA.label || previous.engineB?.kind !== engineB.kind || previous.engineB?.label !== engineB.label) {
    throw new Error('Resume report uses different engines or labels.')
  }
  if (JSON.stringify(previous.engineA.capabilities) !== JSON.stringify(engineA.capabilities) || JSON.stringify(previous.engineB.capabilities) !== JSON.stringify(engineB.capabilities)) {
    throw new Error('Resume report uses different engine capabilities or search budgets.')
  }
  if (JSON.stringify(previous.artifacts) !== JSON.stringify(artifacts)) throw new Error('Resume report uses different engine artifacts.')
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
  let authHeaders = await createSession()
  const response = await fetch(`${baseUrl}/capabilities`, { headers: authHeaders })
  if (!response.ok) throw new Error(`KataGo capabilities failed: ${response.status} ${await response.text()}`)
  const capabilities = await response.json() as Record<string, unknown>
  return {
    kind: 'katago', label, capabilities,
    async move(state) {
      const request = () => fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...positionRequest(state, `cal-kg-${crypto.randomUUID()}`),
          profile: 'battle-matched',
          rules: KATAGO_CHINESE_PSK_RULES,
        }),
        signal: AbortSignal.timeout(195_000),
      })
      let response = await request()
      if (response.status === 401) {
        authHeaders = await createSession()
        response = await request()
      }
      if (!response.ok) throw new Error(`KataGo analyze failed: ${response.status} ${await response.text()}`)
      const events = (await response.text()).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      const error = events.find((event) => event.type === 'error')
      if (error) throw new Error(`KataGo analyze error: ${error.message}`)
      const final = events.findLast((event) => event.type === 'analysis' && event.stage === 'final')
      if (!final?.candidates?.[0]?.move) throw new Error('KataGo did not return a final move.')
      return String(final.candidates[0].move)
    },
  }

  async function createSession() {
    const session = await fetch(`${baseUrl}/session`, { method: 'POST', headers })
    if (!session.ok) throw new Error(`KataGo session failed: ${session.status} ${await session.text()}`)
    const cookie = session.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('KataGo bridge did not issue a session cookie.')
    return { ...headers, Cookie: cookie }
  }
}

async function playGame(opening: CalibrationOpening, black: SeatClient, white: SeatClient): Promise<CalibrationGame> {
  const engine = new GoGameEngine()
  let state = engine.init()
  const startedAt = Date.now()
  try {
    for (const vertex of opening.moves) state = engine.applyMove(state, gtpToGoMove(vertex))
    while (state.phase === 'playing') {
      if (state.history.length >= 800) throw new Error('800-move safety limit reached')
      const client = state.turn === 'black' ? black : white
      const vertex = await client.move(state)
      state = engine.applyMove(state, gtpToGoMove(vertex))
    }
    const final = engine.finalizeScoring(state)
    const winnerLabel = final.result?.winner === 'black' ? black.label : final.result?.winner === 'white' ? white.label : null
    return {
      openingId: opening.id, openingFamilyId: opening.familyId, openingTransform: opening.transform,
      black: black.label, white: white.label, winner: final.result?.winner ?? null,
      winnerLabel, margin: final.result?.score.margin ?? null, moves: final.history.length,
      elapsedMs: Date.now() - startedAt, technicalFailure: null, technicalFailureKind: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      openingId: opening.id, openingFamilyId: opening.familyId, openingTransform: opening.transform,
      black: black.label, white: white.label, winner: null, winnerLabel: null,
      margin: null, moves: state.history.length, elapsedMs: Date.now() - startedAt,
      technicalFailure: message, technicalFailureKind: classifyTechnicalFailure(message),
    }
  }
}

function buildReport({
  phase, runId, runStartedAt, openings, games, retryHistory, engineA, engineB, artifacts,
}: {
  phase: 'in-progress' | 'completed'
  runId: string
  runStartedAt: number
  openings: readonly CalibrationOpening[]
  games: readonly CalibrationGame[]
  retryHistory: readonly CalibrationGame[]
  engineA: SeatClient
  engineB: SeatClient
  artifacts: Awaited<ReturnType<typeof artifactAudit>>
}) {
  const gamesRequested = openings.length * 2
  const technicalFailureGames = games.filter((game) => game.technicalFailure)
  const normal = games.filter((game) => !game.technicalFailure)
  const aWins = normal.filter((game) => game.winnerLabel === engineA.label).length
  const bWins = normal.filter((game) => game.winnerLabel === engineB.label).length
  const draws = normal.length - aWins - bWins
  const aWinRate = normal.length ? aWins / normal.length : 0
  const aWilson95 = wilson95(aWins, normal.length)
  const aBlackWinRate = rate(normal, engineA.label, 'black')
  const aWhiteWinRate = rate(normal, engineA.label, 'white')
  const formalDesign = engineA.kind === 'sayuri' && engineB.kind === 'katago' && openings.length === 50
  const runComplete = phase === 'completed' && games.length === gamesRequested
  const completeWithoutTechnicalFailures = runComplete && normal.length === gamesRequested && technicalFailureGames.length === 0
  const eligibleForStrengthConclusion = formalDesign && completeWithoutTechnicalFailures
  const pointEstimateWithin40To60 = aWinRate >= 0.4 && aWinRate <= 0.6
  const matched40To60 = eligibleForStrengthConclusion && aWilson95[0] >= 0.4 && aWilson95[1] <= 0.6
  const pairsCompleted = openings.filter((opening) => {
    const selected = normal.filter((game) => game.openingId === opening.id)
    return selected.length === 2 && selected.some((game) => game.black === engineA.label) && selected.some((game) => game.white === engineA.label)
  }).length
  const failures = Object.fromEntries(
    (['timeout', 'oom', 'crash', 'illegal-move', 'session', 'other'] as const).map((kind) => [kind, technicalFailureGames.filter((game) => game.technicalFailureKind === kind).length]),
  ) as Record<TechnicalFailureKind, number>

  return {
    schemaVersion: 2,
    runId,
    generatedAt: new Date().toISOString(),
    startedAt: new Date(runStartedAt).toISOString(),
    phase,
    provisional: !eligibleForStrengthConclusion,
    status: phase === 'in-progress' ? 'in-progress' : !eligibleForStrengthConclusion ? 'inconclusive' : matched40To60 ? 'matched' : 'not-matched',
    methodology: 'fixed paired 19x19 openings; each engine receives both colors; Chinese area scoring; komi 7.5',
    statisticalLimitations: [
      'The 100 games are color-swapped pairs, not 100 independent opening samples.',
      `${openings.length} positions come from ${new Set(openings.map((opening) => opening.familyId)).size} base opening families and rotational transforms.`,
      'The game-level Wilson interval is reported descriptively as requested; pairing and shared opening families violate its independence assumption, so it is not an Elo interval.',
    ],
    eloConclusion: null,
    engineA: { kind: engineA.kind, label: engineA.label, capabilities: engineA.capabilities },
    engineB: { kind: engineB.kind, label: engineB.label, capabilities: engineB.capabilities },
    artifacts,
    openings: openings.length,
    distinctOpeningFamilies: new Set(openings.map((opening) => opening.familyId)).size,
    gamesRequested,
    gamesAttempted: games.length,
    gamesCompleted: normal.length,
    pairsCompleted,
    completionRate: gamesRequested ? normal.length / gamesRequested : 0,
    technicalFailures: technicalFailureGames.length,
    failures,
    retriedTechnicalFailures: retryHistory.length,
    retryHistory,
    wallClockElapsedMs: Date.now() - runStartedAt,
    totalGameElapsedMs: games.reduce((sum, game) => sum + game.elapsedMs, 0),
    formalDesign,
    eligibleForStrengthConclusion,
    results: {
      engineAWins: aWins,
      engineBWins: bWins,
      draws,
      engineAWinRate: aWinRate,
      engineAWilson95: aWilson95,
      wilsonScope: 'descriptive game-level interval; correlated paired/opening-family structure is not modeled',
      engineABlackWinRate: aBlackWinRate,
      engineAWhiteWinRate: aWhiteWinRate,
      colorBiasFlag: normal.length > 0 && Math.abs(aBlackWinRate - aWhiteWinRate) > 0.15,
      pointEstimateWithin40To60,
      matched40To60,
    },
    games,
  }
}

function classifyTechnicalFailure(message: string): TechnicalFailureKind {
  if (/out of memory|\boom\b|cuda.*alloc|allocation failed/i.test(message)) return 'oom'
  if (/timed out|timeout|abort/i.test(message)) return 'timeout'
  if (/exited|broken pipe|stdin.*(?:not writable|不可写)|engine_busy|service unavailable|服务不可用/i.test(message)) return 'crash'
  if (/illegal|invalid (?:move|coordinate)|无效坐标|着法.*(?:无效|无法执行)|超级劫|superko/i.test(message)) return 'illegal-move'
  if (/\b401\b|session_required|session.*(?:expired|invalid)|会话.*(?:过期|无效)/i.test(message)) return 'session'
  return 'other'
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

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60
  return hours ? `${hours}h ${minutes}m ${remainder}s` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
