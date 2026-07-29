const fs = require('node:fs')
const path = require('node:path')

// Emscripten's Node loader must use the filesystem rather than Node's fetch.
globalThis.fetch = undefined
const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js')

const root = path.resolve(__dirname, '..')
const networkName = 'xiangqi-c07e94a5c7cb.nnue'
const networkPath = path.join(root, 'public', 'engine', networkName)

async function main() {
  const engine = await Stockfish({
    locateFile: (filename) =>
      path.join(root, 'node_modules', 'fairy-stockfish-nnue.wasm', filename),
  })
  const lines = []
  const waiters = []
  engine.addMessageListener((raw) => {
    const line = String(raw).trim()
    if (!line) return
    lines.push(line)
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].predicate(line)) waiters.splice(index, 1)[0].resolve(line)
    }
  })

  const waitFor = (predicate, timeoutMs = 30_000) =>
    new Promise((resolve, reject) => {
      const waiter = { predicate, resolve }
      waiters.push(waiter)
      setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error('Engine verification timed out.'))
      }, timeoutMs)
    })
  const commandAndWait = (command, predicate) => {
    const result = waitFor(predicate)
    engine.postMessage(command)
    return result
  }

  await commandAndWait('ucci', (line) => line === 'ucciok')
  engine.FS.writeFile(`/${networkName}`, fs.readFileSync(networkPath))
  ;[
    'setoption Threads 1',
    'setoption hashsize 64',
    'setoption Use_NNUE true',
    `setoption EvalFile /${networkName}`,
    'setoption UCI_ShowWDL true',
    'setoption Skill_Level 20',
    'setoption UCI_LimitStrength false',
  ].forEach((command) => engine.postMessage(command))
  await commandAndWait('isready', (line) => line === 'readyok')
  engine.postMessage('position startpos')
  await commandAndWait('go depth 2', (line) => /^bestmove|^nobestmove/.test(line))

  const nnueLine = lines.find((line) => /NNUE evaluation using .* enabled/i.test(line))
  const classicalLine = lines.find((line) => /classical evaluation enabled/i.test(line))
  const bestmove = [...lines].reverse().find((line) => /^bestmove/.test(line))
  if (!nnueLine || classicalLine || !bestmove) {
    throw new Error(
      `NNUE verification failed.\nNNUE=${nnueLine ?? 'missing'}\nClassical=${classicalLine ?? 'none'}\nBestmove=${bestmove ?? 'missing'}`,
    )
  }
  console.log(nnueLine)
  console.log(bestmove)
  engine.terminate()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
