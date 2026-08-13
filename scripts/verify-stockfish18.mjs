#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = process.cwd()
const expected = new Map([
  ['stockfish-18.js', '10a0f96d5e2a1bc8646bf4a1a69353ede52499e7d94f6376f7b810404b010ced'],
  ['stockfish-18.wasm', '8bef136a3d7a428b5cbc624459a2091fd3e750c22a48dad9ad3b292ac80373cb'],
  ['stockfish-18-single.js', 'ce07b916870473a837b598b9b558c125e24568624e47dabc3381474558ee201d'],
  ['stockfish-18-single.wasm', 'f611ac05ddb248fe975a4f180ac9fec7f7fb650f8f17f5fe4230fcc0fe6419c7'],
])
for (const [name, hash] of expected) {
  const bytes = name.endsWith('.wasm')
    ? Buffer.concat(await Promise.all(Array.from({ length: 6 }, (_, index) => readFile(resolve(root, 'public', 'engine', `${name}.part-${String(index + 1).padStart(2, '0')}`)))))
    : await readFile(resolve(root, 'public', 'engine', name))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== hash) throw new Error(`${name} SHA-256 mismatch: ${actual}`)
}
const require = createRequire(import.meta.url)
const initStockfish = require('stockfish')
const engine = await initStockfish('single')
const lines = []
let resolveBestmove
let rejectBestmove
const bestmove = new Promise((resolvePromise, reject) => { resolveBestmove = resolvePromise; rejectBestmove = reject })
const timeout = setTimeout(() => rejectBestmove(new Error('Stockfish 18 verification timed out.')), 90_000)
engine.listener = (raw) => {
  const line = String(raw).trim()
  lines.push(line)
  if (line.startsWith('bestmove ')) resolveBestmove(line)
}
engine.sendCommand('uci')
engine.sendCommand('setoption name Threads value 1')
engine.sendCommand('setoption name Hash value 64')
engine.sendCommand('setoption name MultiPV value 1')
engine.sendCommand('setoption name UCI_LimitStrength value false')
engine.sendCommand('setoption name UCI_ShowWDL value true')
engine.sendCommand('isready')
engine.sendCommand('position startpos')
engine.sendCommand('go nodes 10000')
const moveLine = await bestmove
clearTimeout(timeout)
engine.sendCommand('quit')
if (!lines.some((line) => /^id name Stockfish 18 WASM$/i.test(line))) throw new Error('The package did not identify as Stockfish 18 WASM.')
if (!/^bestmove\s+[a-h][1-8][a-h][1-8][qrbn]?(?:\s|$)/.test(moveLine)) throw new Error(`Invalid bestmove: ${moveLine}`)
process.stdout.write(`${JSON.stringify({ status: 'passed', version: 'stockfish.js@18.0.8', upstream: 'Stockfish 18 cb3d4ee', bestmove: moveLine.split(/\s+/)[1], nodes: 10000, assets: Object.fromEntries(expected) }, null, 2)}\n`)
