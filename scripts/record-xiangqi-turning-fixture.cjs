// Reproducible acceptance sample: red hangs a rook on b5; black's horse takes it.
const fs = require('node:fs')
const path = require('node:path')
globalThis.fetch = undefined
const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js')
const moves = ['a3a4', 'c6c5', 'a0a3', 'b9c7', 'a3b3', 'h9g7', 'b3b5', 'c7b5', 'b0c2']
async function main() {
  const engine = await Stockfish({ locateFile: (name) => path.resolve('node_modules/fairy-stockfish-nnue.wasm', name) })
  let lines = []
  let listener
  engine.addMessageListener((raw) => { const line = String(raw).trim(); lines.push(line); listener?.(line) })
  const command = (text, end) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${text}`)), 30000)
    listener = (line) => { if (end(line)) { clearTimeout(timer); listener = null; resolve(line) } }
    engine.postMessage(text)
  })
  await command('ucci', (line) => line === 'ucciok')
  const network = 'xiangqi-c07e94a5c7cb.nnue'
  engine.FS.writeFile(`/${network}`, fs.readFileSync(path.resolve('public/engine', network)))
  for (const option of ['Threads 1', 'hashsize 64', 'MultiPV 1', 'Use_NNUE true', `EvalFile /${network}`, 'UCI_ShowWDL true']) engine.postMessage(`setoption ${option}`)
  await command('isready', (line) => line === 'readyok')
  const evaluations = []
  for (let index = 0; index < moves.length; index++) {
    engine.postMessage('setoption name Clear Hash')
    engine.postMessage(`position startpos${index ? ` moves ${moves.slice(0, index).join(' ')}` : ''}`)
    lines = []
    await command('go depth 12', (line) => /^bestmove|^nobestmove/.test(line))
    const info = lines.filter((line) => /score (?:cp )?-?\d+/.test(line) && /wdl/.test(line)).at(-1)
    if (!info) throw new Error(`No cp/WDL at ${index}: ${lines.slice(-5).join('\n')}`)
    const [, win, draw, loss] = /wdl (\d+) (\d+) (\d+)/.exec(info)
    evaluations.push({ score: { kind: 'cp', value: Number(/score (?:cp )?(-?\d+)/.exec(info)[1]) }, wdl: { win: Number(win), draw: Number(draw), loss: Number(loss) }, depth: Number(/depth (\d+)/.exec(info)[1]) })
    console.log(index, info)
  }
  fs.writeFileSync('src/test/fixtures/xiangqi-rook-blunder.json', JSON.stringify({ source: 'Constructed legal acceptance game, red resigns after ply 9; not a historical tournament game.', engine: 'fairy-stockfish-nnue.wasm 1.1.11, xiangqi-c07e94a5c7cb.nnue, depth 12, Threads 1, Hash 64, root scores before each move', expectedBlunderIndex: 6, moves, evaluations }, null, 2) + '\n')
  engine.postMessage('quit')
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
