import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { KataGoProcess, sha256File } from '../src/katago-process.mjs'
import {
  KATAGO_RULES,
  SEARCH_PROFILES,
  buildKataGoQuery,
  normalizeAnalysisResult,
  validateAnalyzeRequest,
} from '../src/protocol.mjs'

const VALID_REQUEST = {
  requestId: 'game-1-turn-1',
  gameId: 'go',
  player: 'black',
  profile: 'fast',
  boardSize: 19,
  komi: 7.5,
  rules: KATAGO_RULES,
  moves: [['B', 'D4'], ['W', 'pass']],
}

test('validates and clamps browser requests to fixed KataGo rules and profiles', () => {
  const input = validateAnalyzeRequest(VALID_REQUEST)
  const query = buildKataGoQuery(input)
  assert.deepEqual(query.rules, KATAGO_RULES)
  assert.equal(query.maxVisits, SEARCH_PROFILES.fast.maxVisits)
  assert.equal(query.reportDuringSearchEvery, 0.5)
  assert.throws(() => validateAnalyzeRequest({ ...VALID_REQUEST, komi: 6.5 }), /十九路/)
  assert.throws(() => validateAnalyzeRequest({ ...VALID_REQUEST, profile: 'unlimited' }), /未知/)
})

test('normalizes only five ordered candidates and black-perspective root data', () => {
  const raw = {
    id: 'game-1-turn-1',
    isDuringSearch: false,
    rootInfo: { winrate: 0.63, scoreLead: 4.5, visits: 200 },
    moveInfos: [
      { move: 'Q16', order: 1, visits: 20, prior: 0.1, winrate: 0.6, pv: ['Q16'] },
      { move: 'D16', order: 0, visits: 180, prior: 0.3, winrate: 0.64, scoreLead: 5, pv: ['D16', 'Q4'] },
    ],
  }
  const event = normalizeAnalysisResult(raw, {
    requestId: raw.id,
    engineVersion: '1.16-test',
    modelName: 'test.bin.gz',
    profile: 'fast',
    startedAt: Date.now(),
    truncated: false,
  })
  assert.equal(event.stage, 'final')
  assert.equal(event.root.winrate, 0.63)
  assert.equal(event.candidates[0].move, 'D16')
  assert.deepEqual(event.candidates[0].pv, ['D16', 'Q4'])
})

test('KataGo process parses fragmented async JSON and sends terminate on abort', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'katago-bridge-'))
  const binary = join(dir, 'katago')
  const model = join(dir, 'model.bin.gz')
  const config = join(dir, 'analysis.cfg')
  await Promise.all([
    writeFile(binary, 'fake binary'),
    writeFile(model, 'fake model'),
    writeFile(config, 'reportAnalysisWinratesAs = BLACK'),
  ])
  const writes = []
  const child = createFakeChild(writes)
  const process = new KataGoProcess({
    binaryPath: binary,
    binarySha256: await sha256File(binary),
    modelPath: model,
    modelSha256: await sha256File(model),
    configPath: config,
    spawn: () => child,
  })
  const capabilities = await process.start()
  assert.deepEqual(capabilities, { engineVersion: '1.16-test', modelName: 'fake-model.bin.gz' })

  const updates = []
  const final = await process.analyze({ id: 'analysis-1', moves: [] }, { onUpdate: (value) => updates.push(value) })
  assert.equal(updates.length, 2)
  assert.equal(final.isDuringSearch, false)

  const controller = new AbortController()
  const pending = process.analyze({ id: 'analysis-abort', moves: [] }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(writes.some((value) => value.action === 'terminate' && value.terminateId === 'analysis-abort'))
  await process.close()
})

test('a crashed KataGo process reports the failure and can be started with a fresh child', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'katago-restart-'))
  const binary = join(dir, 'katago')
  const model = join(dir, 'model.bin.gz')
  const config = join(dir, 'analysis.cfg')
  await Promise.all([writeFile(binary, 'binary'), writeFile(model, 'model'), writeFile(config, 'config')])
  const children = [createFakeChild([]), createFakeChild([])]
  let spawnCount = 0
  let exitError
  const process = new KataGoProcess({
    binaryPath: binary,
    binarySha256: await sha256File(binary),
    modelPath: model,
    modelSha256: await sha256File(model),
    configPath: config,
    spawn: () => children[spawnCount++],
    onExit: (error) => { exitError = error },
  })
  await process.start()
  children[0].emit('exit', 7, null)
  assert.match(exitError.message, /exited/)
  assert.equal(process.ready, false)
  await process.start()
  assert.equal(spawnCount, 2)
  assert.equal(process.ready, true)
  await process.close()
})

function createFakeChild(writes) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = {
    writable: true,
    write(line) {
      const query = JSON.parse(line)
      writes.push(query)
      if (query.action === 'query_version') emitSplit(child.stdout, { ...query, version: '1.16-test', git_hash: 'test' })
      else if (query.action === 'query_models') emitSplit(child.stdout, { ...query, models: [{ name: 'fake-model.bin.gz' }] })
      else if (!query.action && query.id !== 'analysis-abort') {
        emitSplit(child.stdout, analysisResult(query.id, true))
        emitSplit(child.stdout, analysisResult(query.id, false))
      }
      return true
    },
    end() { this.writable = false },
  }
  child.kill = () => child.emit('exit', 0, null)
  return child
}

function emitSplit(stream, value) {
  const line = `${JSON.stringify(value)}\n`
  queueMicrotask(() => {
    stream.write(line.slice(0, 9))
    stream.write(line.slice(9))
  })
}

function analysisResult(id, isDuringSearch) {
  return {
    id,
    isDuringSearch,
    rootInfo: { winrate: 0.5, scoreLead: 0, visits: isDuringSearch ? 20 : 200 },
    moveInfos: [{ move: 'D16', order: 0, visits: 200, prior: 0.2, winrate: 0.5, pv: ['D16'] }],
  }
}
