import { closeSync, openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const options = Object.fromEntries([
  [process.argv[2], process.argv[3]],
  [process.argv[4], process.argv[5]],
  [process.argv[6], process.argv[7]],
])
const [command, ...args] = process.argv.slice(8)
if (!command || !options['--cwd'] || !options['--stdout'] || !options['--stderr']) {
  throw new Error(`Usage: --cwd DIR --stdout FILE --stderr FILE COMMAND [ARGS...]; received ${JSON.stringify(process.argv.slice(2))}`)
}

const stdout = openSync(options['--stdout'], 'a')
const stderr = openSync(options['--stderr'], 'a')
try {
  const child = spawn(command, args, {
    cwd: options['--cwd'],
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  })
  await Promise.race([
    once(child, 'spawn'),
    once(child, 'error').then(([error]) => { throw error }),
  ])
  child.unref()
  process.stdout.write(`${child.pid}\n`)
} finally {
  closeSync(stdout)
  closeSync(stderr)
}
