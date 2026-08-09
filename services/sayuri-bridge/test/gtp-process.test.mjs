import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { SayuriProcess, sha256File } from '../src/gtp-process.mjs'

test('uses the verified search flags and replays the full position before genmove', async () => {
  const fixture = await createFixture()
  const commands = []
  const child = fakeGtpChild(commands)
  let spawnArgs
  const engine = new SayuriProcess({
    ...fixture,
    playouts: 20_000,
    threads: 16,
    batchSize: 8,
    spawn: (_binary, args) => { spawnArgs = args; return child },
  })

  const capabilities = await engine.start()
  assert.equal(capabilities.engineVersion, 'Sayuri 0.10.0')
  assert.deepEqual(spawnArgs.slice(0, 8), ['-w', fixture.modelPath, '-p', '20000', '-t', '16', '--batch-size', '8'])
  assert.ok(spawnArgs.includes('--use-optimistic-policy'))
  assert.ok(spawnArgs.includes('--friendly-pass'))
  assert.deepEqual(spawnArgs.slice(-2), ['--resign-threshold', '0'])
  const result = await engine.analyze({
    player: 'black',
    moves: [['B', 'D16'], ['W', 'Q4']],
  })
  assert.equal(result.move, 'Q16')
  assert.deepEqual(commands.slice(-6), [
    'boardsize 19',
    'clear_board',
    'komi 7.5',
    'play black D16',
    'play white Q4',
    'genmove black',
  ])
  await engine.close()
})

test('restarts with a fresh process after an engine crash', async () => {
  const fixture = await createFixture()
  const children = [fakeGtpChild([]), fakeGtpChild([])]
  let spawnCount = 0
  const engine = new SayuriProcess({ ...fixture, spawn: () => children[spawnCount++] })
  await engine.start()
  children[0].emit('exit', 7, null)
  assert.equal(engine.ready, false)
  await engine.start()
  assert.equal(spawnCount, 2)
  await engine.close()
})

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sayuri-bridge-'))
  const binaryPath = join(directory, 'sayuri.exe')
  const modelPath = join(directory, 'network.bin.txt')
  await Promise.all([writeFile(binaryPath, 'fake binary'), writeFile(modelPath, 'fake model')])
  return {
    binaryPath,
    binarySha256: await sha256File(binaryPath),
    modelPath,
    modelSha256: await sha256File(modelPath),
  }
}

function fakeGtpChild(commands) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = {
    writable: true,
    write(line) {
      const match = /^(\d+)\s+(.+)\n$/.exec(line)
      assert.ok(match)
      const id = match[1]
      const command = match[2]
      commands.push(command)
      const value = command === 'name' ? 'Sayuri' : command === 'version' ? '0.10.0' : command.startsWith('genmove') ? 'Q16' : ''
      const response = `=${id} ${value}\n\n`
      queueMicrotask(() => {
        child.stdout.write(response.slice(0, 3))
        child.stdout.write(response.slice(3))
      })
      return true
    },
    end() { this.writable = false },
  }
  child.kill = () => child.emit('exit', 0, null)
  return child
}
