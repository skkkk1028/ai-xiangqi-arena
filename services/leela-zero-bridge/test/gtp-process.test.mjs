import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { LeelaZeroProcess, sha256File } from '../src/gtp-process.mjs'

test('parses fragmented GTP responses and replays the full position before genmove', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'leela-zero-bridge-'))
  const binary = join(directory, 'leelaz.exe')
  const model = join(directory, 'network.gz')
  await Promise.all([writeFile(binary, 'fake binary'), writeFile(model, 'fake model')])
  const commands = []
  const child = fakeGtpChild(commands)
  let spawnOptions
  const engine = new LeelaZeroProcess({
    binaryPath: binary,
    binarySha256: await sha256File(binary),
    modelPath: model,
    modelSha256: await sha256File(model),
    playouts: 3200,
    threads: 8,
    spawn: (_binary, _args, options) => { spawnOptions = options; return child },
  })

  const capabilities = await engine.start()
  assert.equal(capabilities.engineVersion, 'Leela Zero 0.17')
  assert.equal(spawnOptions.windowsHide, true)
  const result = await engine.analyze({
    player: 'black',
    moves: [['B', 'D16'], ['W', 'Q4']],
  })
  assert.equal(result.move, 'Q16')
  assert.deepEqual(commands.slice(-7), [
    'boardsize 19',
    'clear_board',
    'komi 7.5',
    'lz-setoption name playouts value 3200',
    'play black D16',
    'play white Q4',
    'genmove black',
  ])
  await engine.close()
})

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
      const value = command === 'name' ? 'Leela Zero' : command === 'version' ? '0.17' : command.startsWith('genmove') ? 'Q16' : ''
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
