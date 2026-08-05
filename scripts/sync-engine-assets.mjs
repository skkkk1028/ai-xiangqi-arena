import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const packageRoot = resolve(root, 'node_modules', 'fairy-stockfish-nnue.wasm')
const output = resolve(root, 'public', 'engine')
const files = ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']
const networks = [
  {
    name: 'xiangqi-c07e94a5c7cb.nnue',
    url: 'https://cdn.jsdelivr.net/gh/fairy-stockfish/Fairy-Stockfish-NNUE@master/xiangqi-c07e94a5c7cb.nnue',
    sha256: 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
  },
]
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

await Promise.all(networks.map(ensureNetwork))
await Promise.all(pikafishNetworks.map(syncPikafishParts))
await syncTfjsWasm()

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
