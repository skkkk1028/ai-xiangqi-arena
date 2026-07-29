import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const packageRoot = resolve(root, 'node_modules', 'fairy-stockfish-nnue.wasm')
const output = resolve(root, 'public', 'engine')
const files = ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']
const networkName = 'xiangqi-c07e94a5c7cb.nnue'
const networkPath = resolve(output, networkName)
const networkUrl =
  'https://cdn.jsdelivr.net/gh/fairy-stockfish/Fairy-Stockfish-NNUE@master/xiangqi-c07e94a5c7cb.nnue'
const networkSha256 = 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11'

await mkdir(output, { recursive: true })
await Promise.all(files.map((file) => copyFile(resolve(packageRoot, file), resolve(output, file))))

let network
try {
  network = await readFile(networkPath)
} catch {
  network = null
}

if (!network || sha256(network) !== networkSha256) {
  const response = await fetch(networkUrl)
  if (!response.ok) {
    throw new Error(`Failed to download Xiangqi NNUE: HTTP ${response.status}`)
  }
  network = Buffer.from(await response.arrayBuffer())
  const actualHash = sha256(network)
  if (actualHash !== networkSha256) {
    throw new Error(`Xiangqi NNUE checksum mismatch: ${actualHash}`)
  }
  await writeFile(networkPath, network)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
