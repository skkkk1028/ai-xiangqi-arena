import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const bases = process.argv.slice(2)
if (bases.length === 0) throw new Error('Pass at least one Cloudflare Pages base URL.')

const localIndex = await readFile(resolve(process.cwd(), '.vite-output/index.html'), 'utf8')
const expectedAsset = extractMainAsset(localIndex)

for (const value of bases) {
  const base = new URL(value)
  const response = await fetch(base, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${base} returned HTTP ${response.status}.`)
  const html = await response.text()
  const asset = extractMainAsset(html)
  if (asset !== expectedAsset) throw new Error(`${base} is not serving the latest main asset (${asset}).`)
  assertHeader(response, 'cross-origin-opener-policy', 'same-origin')
  assertHeader(response, 'cross-origin-embedder-policy', 'require-corp')
  assertHeader(response, 'cross-origin-resource-policy', 'same-origin')
  process.stdout.write(JSON.stringify({ url: base.href, status: response.status, asset }) + '\n')
}

const modelUrl = new URL('/api/go/model/strong.bin.gz', bases.at(-1))
const modelResponse = await fetch(modelUrl, {
  headers: { Range: 'bytes=0-1023', 'Accept-Encoding': 'identity' },
  signal: AbortSignal.timeout(60_000),
})
if (modelResponse.status !== 206) throw new Error(`Strong model range returned HTTP ${modelResponse.status}.`)
const modelBytes = await modelResponse.arrayBuffer()
if (modelBytes.byteLength !== 1_024) throw new Error(`Strong model range returned ${modelBytes.byteLength} bytes.`)
assertHeader(modelResponse, 'cross-origin-resource-policy', 'same-origin')
assertHeader(modelResponse, 'x-content-type-options', 'nosniff')
if (!modelResponse.headers.get('cache-control')?.includes('max-age=14400')) {
  throw new Error('Strong model cache policy is missing.')
}
process.stdout.write(JSON.stringify({
  url: modelUrl.href,
  status: modelResponse.status,
  bytes: modelBytes.byteLength,
  contentRange: modelResponse.headers.get('content-range'),
  cacheControl: modelResponse.headers.get('cache-control'),
}) + '\n')

function extractMainAsset(html) {
  const match = html.match(/assets\/main-[^"']+\.js/)
  if (!match) throw new Error('Main application asset was not found in index.html.')
  return match[0]
}

function assertHeader(response, name, expected) {
  const actual = response.headers.get(name)
  if (actual !== expected) throw new Error(`${name} was ${actual ?? 'missing'}; expected ${expected}.`)
}
