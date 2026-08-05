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
      let timeout
      const waiter = {
        predicate,
        resolve: (line) => {
          clearTimeout(timeout)
          resolve(line)
        },
      }
      waiters.push(waiter)
      timeout = setTimeout(() => {
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
    'setoption MultiPV 3',
    'setoption Use_NNUE true',
    `setoption EvalFile /${networkName}`,
    'setoption UCI_ShowWDL true',
    'setoption Skill_Level 20',
    'setoption UCI_LimitStrength false',
  ].forEach((command) => engine.postMessage(command))
  await commandAndWait('isready', (line) => line === 'readyok')

  const measureSearch = async (multiPv) => {
    engine.postMessage(`setoption MultiPV ${multiPv}`)
    engine.postMessage('setoption name Clear Hash')
    const firstLine = lines.length
    engine.postMessage('position startpos')
    const startedAt = Date.now()
    const bestmove = await commandAndWait(
      'go movetime 750',
      (line) => /^bestmove|^nobestmove/.test(line),
    )
    const searchLines = lines.slice(firstLine)
    const depth = searchLines.reduce((highest, line) => {
      const rank = /(?:^|\s)multipv\s+(\d+)(?:\s|$)/.exec(line)?.[1]
      const parsed = /(?:^|\s)depth\s+(\d+)(?:\s|$)/.exec(line)?.[1]
      return (!rank || rank === '1') && parsed ? Math.max(highest, Number(parsed)) : highest
    }, 0)
    const ranks = new Set(
      searchLines
        .map((line) => /(?:^|\s)multipv\s+(\d+)(?:\s|$)/.exec(line)?.[1])
        .filter(Boolean),
    )
    return { bestmove, depth, ranks, elapsedMs: Date.now() - startedAt }
  }

  // Keep a MultiPV 1 baseline, then exercise the production transition sequence.
  const singlePv = await measureSearch(1)
  const quadPv = await measureSearch(4)
  const doublePv = await measureSearch(2)
  const triplePv = await measureSearch(3)

  const nnueLine = lines.find((line) => /NNUE evaluation using .* enabled/i.test(line))
  const classicalLine = lines.find((line) => /classical evaluation enabled/i.test(line))
  const bestmove = triplePv.bestmove
  if (
    !nnueLine ||
    classicalLine ||
    !bestmove ||
    !hasRanks(quadPv, 4) ||
    !hasRanks(doublePv, 2) ||
    !hasRanks(triplePv, 3) ||
    singlePv.depth <= 0 ||
    quadPv.depth < Math.max(1, singlePv.depth - 5) ||
    doublePv.depth < Math.max(1, singlePv.depth - 3) ||
    triplePv.depth < Math.max(1, singlePv.depth - 4) ||
    singlePv.elapsedMs > 5_000 ||
    quadPv.elapsedMs > 5_000 ||
    doublePv.elapsedMs > 5_000 ||
    triplePv.elapsedMs > 5_000
  ) {
    throw new Error(
      `NNUE verification failed.\nNNUE=${nnueLine ?? 'missing'}\nClassical=${classicalLine ?? 'none'}\nBestmove=${bestmove ?? 'missing'}\nMultiPV4=${[...quadPv.ranks].join(',') || 'missing'}\nMultiPV2=${[...doublePv.ranks].join(',') || 'missing'}\nMultiPV3=${[...triplePv.ranks].join(',') || 'missing'}\nDepth=${singlePv.depth}/${quadPv.depth}/${doublePv.depth}/${triplePv.depth}\nElapsed=${singlePv.elapsedMs}/${quadPv.elapsedMs}/${doublePv.elapsedMs}/${triplePv.elapsedMs}`,
    )
  }
  console.log(nnueLine)
  console.log(bestmove)
  console.log(
    `dynamic multipv ranks 4=[${[...quadPv.ranks].sort().join(',')}], ` +
      `2=[${[...doublePv.ranks].sort().join(',')}], ` +
      `3=[${[...triplePv.ranks].sort().join(',')}]`,
  )
  console.log(
    `search comparison multipv1 depth=${singlePv.depth} time=${singlePv.elapsedMs}ms; ` +
      `multipv4 depth=${quadPv.depth} time=${quadPv.elapsedMs}ms; ` +
      `multipv2 depth=${doublePv.depth} time=${doublePv.elapsedMs}ms; ` +
      `multipv3 depth=${triplePv.depth} time=${triplePv.elapsedMs}ms`,
  )
  engine.terminate()
}

function hasRanks(result, expected) {
  for (let rank = 1; rank <= expected; rank += 1) {
    if (!result.ranks.has(String(rank))) return false
  }
  return true
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
