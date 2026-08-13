#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'

const seed = 20260813
const count = 1000
const source = resolve(process.cwd(), 'benchmark-assets/chess/UHO_Lichess_4852_v1.epd')
const output = resolve(process.cwd(), `benchmark-assets/chess/UHO_Lichess_4852_v1.seed-${seed}.count-${count}.json`)
const bytes = await readFile(source)
const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
const fens = bytes.toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/).slice(0, 4).join(' ')).filter((fen) => { try { new Chess(fen); return true } catch { return false } })
if (fens.length < count) throw new Error(`Opening book has only ${fens.length} valid FENs.`)
const indexes = shuffledIndexes(fens.length, seed).slice(0, count)
const manifest = { schema: 'project10-chess-opening-selection-v1', source: 'UHO_Lichess_4852_v1.epd', sourceSha256, seed, count, selection: 'seeded-shuffle-without-replacement-v1', entries: indexes.map((index) => ({ openingIndex: index + 1, fen: fens[index] })) }
await writeFile(output, `${JSON.stringify(manifest)}\n`)
process.stdout.write(`${JSON.stringify({ output, sourceSha256, validOpenings: fens.length, selected: manifest.entries.length })}\n`)

function shuffledIndexes(length, initialSeed){const values=Array.from({length},(_,index)=>index);let state=initialSeed>>>0;const random=()=>{state=(state+0x6d2b79f5)>>>0;let value=state;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return((value^(value>>>14))>>>0)/4294967296};for(let index=length-1;index>0;index--){const other=Math.floor(random()*(index+1));[values[index],values[other]]=[values[other],values[index]]}return values}
