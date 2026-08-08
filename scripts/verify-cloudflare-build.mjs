import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd(), '.vite-output')
const workerPath = join(root, '_worker.js')
const headersPath = join(root, '_headers')
const indexPath = join(root, 'index.html')

await Promise.all([stat(workerPath), stat(headersPath), stat(indexPath)])

const [worker, headers, javascript] = await Promise.all([
  readFile(workerPath, 'utf8'),
  readFile(headersPath, 'utf8'),
  readJavascript(join(root, 'assets')),
])

requireText(worker, 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz', 'Cloudflare worker strong model')
requireText(worker, 'Cross-Origin-Embedder-Policy', 'Cloudflare worker isolation headers')
requireText(headers, 'Cross-Origin-Opener-Policy: same-origin', 'static COOP header')
requireText(headers, 'Cross-Origin-Embedder-Policy: require-corp', 'static COEP header')
requireText(javascript, 'api/go/model/strong.bin.gz', 'browser KataGo model endpoint')
if (javascript.includes('/api/go/katago')) {
  throw new Error('Cloudflare browser build still contains the Native KataGo bridge endpoint.')
}

process.stdout.write('Cloudflare build verified: browser KataGo, strong model proxy and isolation headers are present.\n')

async function readJavascript(directory) {
  const files = await walk(directory)
  const jsFiles = files.filter((file) => file.endsWith('.js'))
  return (await Promise.all(jsFiles.map((file) => readFile(file, 'utf8')))).join('\n')
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return nested.flat()
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} is missing from the generated site.`)
}
