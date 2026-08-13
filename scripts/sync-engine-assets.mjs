import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const packageRoot = resolve(root, 'node_modules', 'fairy-stockfish-nnue.wasm')
const stockfish18Root = resolve(root, 'node_modules', 'stockfish')
const output = resolve(root, 'public', 'engine')
const files = ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']
const networks = [
  {
    name: 'xiangqi-c07e94a5c7cb.nnue',
    url: 'https://cdn.jsdelivr.net/gh/fairy-stockfish/Fairy-Stockfish-NNUE@master/xiangqi-c07e94a5c7cb.nnue',
    sha256: 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
  },
]
const chessNetwork = {
  sourceName: 'nn-3475407dc199.nnue',
  outputName: 'chess-nn-3475407dc199.nnue',
  url: 'https://tests.stockfishchess.org/api/nn/nn-3475407dc199.nnue',
  sha256: '3475407dc19973ea44467678634cce023d620e419770c111cc8937fe6689ec87',
}
const pikafishNetworks = [
  {
    sourceName: 'pikafish.nnue',
    outputName: 'pikafish.nnue',
    sha256: 'c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77',
  },
  {
    sourceName: 'pikafish-2025.nnue',
    outputName: 'pikafish-2025.nnue',
    sha256: '9b2ce59b760c26f284b9fcadd091fa789d9fd4e8c1dd71ffbd42212503a13e95',
  },
]
const pikafishPartSize = 20 * 1024 * 1024
const tfjsWasmSource = resolve(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist')
const tfjsWasmOutput = resolve(root, 'public', 'tfjs')

await mkdir(output, { recursive: true })
await Promise.all(files.map((file) => copyFile(resolve(packageRoot, file), resolve(output, file))))
await syncStockfish18()

await Promise.all(networks.map(ensureNetwork))
await syncChessNetworkParts(chessNetwork)
await Promise.all(pikafishNetworks.map(syncPikafishParts))
await syncTfjsWasm()

async function syncStockfish18() {
  const files = [
    'stockfish-18.js',
    'stockfish-18-single.js',
    'stockfish-18-lite-single.js',
    'stockfish-18-lite-single.wasm',
  ]
  const expected = new Map([
    ['stockfish-18.js', '10a0f96d5e2a1bc8646bf4a1a69353ede52499e7d94f6376f7b810404b010ced'],
    ['stockfish-18.wasm', '8bef136a3d7a428b5cbc624459a2091fd3e750c22a48dad9ad3b292ac80373cb'],
    ['stockfish-18-single.js', 'ce07b916870473a837b598b9b558c125e24568624e47dabc3381474558ee201d'],
    ['stockfish-18-single.wasm', 'f611ac05ddb248fe975a4f180ac9fec7f7fb650f8f17f5fe4230fcc0fe6419c7'],
    ['stockfish-18-lite-single.js', '5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391'],
    ['stockfish-18-lite-single.wasm', 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1'],
  ])
  for (const file of files) {
    const source = resolve(stockfish18Root, 'bin', file)
    const bytes = await readFile(source)
    const actual = sha256(bytes)
    if (actual !== expected.get(file)) throw new Error(`Stockfish 18 asset checksum mismatch for ${file}: ${actual}`)
    await copyFile(source, resolve(output, file))
  }
  for (const wasm of ['stockfish-18.wasm', 'stockfish-18-single.wasm']) {
    const bytes = await readFile(resolve(stockfish18Root, 'bin', wasm))
    const actual = sha256(bytes)
    if (actual !== expected.get(wasm)) throw new Error(`Stockfish 18 asset checksum mismatch for ${wasm}: ${actual}`)
    const partSize = 20 * 1024 * 1024
    const partCount = Math.ceil(bytes.byteLength / partSize)
    for (let index = 0; index < partCount; index += 1) {
      await writeFile(resolve(output, `${wasm}.part-${String(index + 1).padStart(2, '0')}`), bytes.subarray(index * partSize, (index + 1) * partSize))
    }
    await rm(resolve(output, wasm), { force: true })
  }
  await copyFile(resolve(stockfish18Root, 'Copying.txt'), resolve(output, 'STOCKFISH-18-GPL-3.0.txt'))
}

async function syncTfjsWasm() {
  await mkdir(tfjsWasmOutput, { recursive: true })
  const entries = await readdir(tfjsWasmSource, { withFileTypes: true })
  const wasmFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.wasm'))
  if (wasmFiles.length === 0) throw new Error('TensorFlow.js WASM runtime files are missing.')
  await Promise.all(
    wasmFiles.map((entry) =>
      copyFile(resolve(tfjsWasmSource, entry.name), resolve(tfjsWasmOutput, entry.name)),
    ),
  )
}

async function syncPikafishParts(network) {
  const networkPath = resolve(root, 'engine-assets', network.sourceName)
  const bytes = await readFile(networkPath)
  const actualHash = sha256(bytes)
  if (actualHash !== network.sha256) {
    throw new Error(`Bundled ${network.sourceName} checksum mismatch: ${actualHash}`)
  }
  const partCount = Math.ceil(bytes.byteLength / pikafishPartSize)
  await Promise.all(
    Array.from({ length: partCount }, (_, index) => {
      const name = `${network.outputName}.part-${String(index + 1).padStart(2, '0')}`
      const start = index * pikafishPartSize
      return writeFile(resolve(output, name), bytes.subarray(start, start + pikafishPartSize))
    }),
  )
}

async function syncChessNetworkParts(network) {
  const partCount = 3
  const partPaths = Array.from({ length: partCount }, (_, index) =>
    resolve(output, `${network.outputName}.part-${String(index + 1).padStart(2, '0')}`),
  )
  let bytes = null
  try {
    const parts = await Promise.all(partPaths.map((path) => readFile(path)))
    bytes = Buffer.concat(parts)
  } catch {
    bytes = null
  }
  if (!bytes || sha256(bytes) !== network.sha256) {
    const response = await fetch(network.url)
    if (!response.ok) throw new Error(`Failed to download ${network.sourceName}: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    const actualHash = sha256(bytes)
    if (actualHash !== network.sha256) {
      throw new Error(`${network.sourceName} checksum mismatch: ${actualHash}`)
    }
  }
  const partSize = 20 * 1024 * 1024
  await Promise.all(
    partPaths.map((path, index) =>
      writeFile(path, bytes.subarray(index * partSize, (index + 1) * partSize)),
    ),
  )
}

async function ensureNetwork(network) {
  const networkPath = resolve(output, network.name)
  let bytes
  try {
    bytes = await readFile(networkPath)
  } catch {
    bytes = null
  }
  if (bytes && sha256(bytes) === network.sha256) return
  const response = await fetch(network.url)
  if (!response.ok) {
    throw new Error(`Failed to download ${network.name}: HTTP ${response.status}`)
  }
  bytes = Buffer.from(await response.arrayBuffer())
  const actualHash = sha256(bytes)
  if (actualHash !== network.sha256) {
    throw new Error(`${network.name} checksum mismatch: ${actualHash}`)
  }
  await writeFile(networkPath, bytes)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
