import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SayuriProcess } from '../services/sayuri-bridge/src/gtp-process.mjs'

const configurations = [
  { threads: 8, batchSize: 4 },
  { threads: 12, batchSize: 6 },
  { threads: 16, batchSize: 8 },
  { threads: 24, batchSize: 12 },
]
const configuredPlayouts = positiveInt(process.env.SAYURI_PLAYOUTS, 250)
const budgets = argumentInts('--playouts', [configuredPlayouts])
const movesPerConfiguration = argumentInt('--moves', 20)
const timeoutMs = 180_000
const kataGoResidentAtStart = await kataGoReady()
const startedAt = Date.now()
const report = {
  generatedAt: new Date().toISOString(),
  engineVersion: 'Sayuri v0.10.0 CUDA 12 Windows x64',
  modelPath: process.env.SAYURI_MODEL_PATH,
  modelSha256: process.env.SAYURI_MODEL_SHA256,
  gpu: gpuInfo(),
  kataGoResidentAtStart,
  criterion: `configured playout budget (${configuredPlayouts}) with ${movesPerConfiguration} normal returns, every move <=180s, then lowest average latency`,
  exactCompletedPlayoutsObservable: false,
  note: 'GTP genmove does not return an exact completed-playout count; a normal return without const-time is treated as reaching the configured maximum. This short stability screen is not a strength or Elo result.',
  trials: [],
  selected: null,
}

for (const playouts of budgets) {
  const stableAtBudget = []
  for (const configuration of configurations) {
    const trial = await runTrial({ ...configuration, playouts })
    report.trials.push(trial)
    process.stdout.write(`${playouts}p t${configuration.threads}/b${configuration.batchSize}: ${trial.stable ? 'stable' : 'failed'} · ${trial.completedMoves}/${movesPerConfiguration} moves · avg ${trial.averageMoveMs ?? '—'}ms\n`)
    if (trial.eligibleForSelection) stableAtBudget.push(trial)
  }
  if (stableAtBudget.length) {
    stableAtBudget.sort((left, right) => left.averageMoveMs - right.averageMoveMs)
    report.selected = stableAtBudget[0]
    break
  }
}

const outputDir = resolve('reports/go-ai-calibration')
await mkdir(outputDir, { recursive: true })
report.elapsedMs = Date.now() - startedAt
const output = resolve(outputDir, `sayuri-stability-${Date.now()}.json`)
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`Report: ${output}\n`)
if (!report.selected) process.exitCode = 1

async function runTrial({ threads, batchSize, playouts }) {
  const startedAt = Date.now()
  const engine = new SayuriProcess({
    binaryPath: process.env.SAYURI_BIN_PATH,
    binarySha256: process.env.SAYURI_BIN_SHA256,
    modelPath: process.env.SAYURI_MODEL_PATH,
    modelSha256: process.env.SAYURI_MODEL_SHA256,
    threads,
    batchSize,
    playouts,
    timeoutMs,
  })
  const durations = []
  const moves = []
  let consecutivePasses = 0
  let failure = null
  try {
    await engine.start()
    while (durations.length < movesPerConfiguration) {
      const player = moves.length % 2 === 0 ? 'black' : 'white'
      const startedAt = Date.now()
      const result = await engine.analyze({ player, moves }, AbortSignal.timeout(timeoutMs + 5_000))
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > timeoutMs) throw new Error(`move exceeded ${timeoutMs}ms`)
      durations.push(elapsedMs)
      const vertex = result.move.toUpperCase()
      moves.push([player === 'black' ? 'B' : 'W', vertex])
      consecutivePasses = vertex === 'PASS' ? consecutivePasses + 1 : 0
      if (consecutivePasses >= 2) {
        moves.length = 0
        consecutivePasses = 0
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await engine.close()
  }
  const kataGoResidentAtEnd = await kataGoReady()
  const stable = !failure && durations.length === movesPerConfiguration
  return {
    playouts, threads, batchSize,
    requestedMoves: movesPerConfiguration,
    completedMoves: durations.length,
    completionRate: durations.length / movesPerConfiguration,
    stable,
    eligibleForSelection: stable && kataGoResidentAtStart && kataGoResidentAtEnd,
    failure,
    failureKind: failure ? classifyFailure(failure) : null,
    elapsedMs: Date.now() - startedAt,
    averageMoveMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    maximumMoveMs: durations.length ? Math.max(...durations) : null,
    kataGoResidentAtEnd,
  }
}

function classifyFailure(message) {
  if (/out of memory|\boom\b|cuda.*alloc|allocation failed/i.test(message)) return 'oom'
  if (/timed out|timeout|exceeded/i.test(message)) return 'timeout'
  if (/exited|broken pipe|stdin.*not writable/i.test(message)) return 'crash'
  return 'other'
}

async function kataGoReady() {
  try {
    const response = await fetch('http://127.0.0.1:8788/health/ready', { signal: AbortSignal.timeout(2_000) })
    return response.ok && Boolean((await response.json()).ready)
  } catch {
    return false
  }
}

function gpuInfo() {
  try {
    return execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { encoding: 'utf8', timeout: 10_000 }).trim()
  } catch {
    return 'unavailable'
  }
}

function argumentInt(name, fallback) {
  const prefix = `${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function argumentInts(name, fallback) {
  const prefix = `${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (!value) return fallback
  const parsed = value.split(',').map(Number)
  return parsed.length && parsed.every((item) => Number.isInteger(item) && item > 0) ? parsed : fallback
}

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
