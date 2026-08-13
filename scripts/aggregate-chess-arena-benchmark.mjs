#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const input = resolve(root, arg('--input') ?? 'reports/chess-arena-strength/formal-stc')
const expectedPairs = Number(arg('--expected-pairs') ?? 1000)
const entries = await readdir(input, { withFileTypes: true })
const checkpoints = []
try { checkpoints.push(JSON.parse(await readFile(resolve(input, 'checkpoint.json'), 'utf8'))) } catch { /* multi-worker input */ }
for (const entry of entries.filter((value) => value.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  try { checkpoints.push(JSON.parse(await readFile(resolve(input, entry.name, 'checkpoint.json'), 'utf8'))) } catch { /* incomplete worker without a checkpoint */ }
}
if (!checkpoints.length) throw new Error(`No checkpoints found below ${input}.`)
const pairRows = []
for (const checkpoint of checkpoints) {
  const offset = Number(checkpoint.conditions.pairOffset)
  for (let index = 0; index < checkpoint.pairs.length; index++) {
    const games = checkpoint.games.filter((game) => game.pair === offset + index + 1)
    if (games.length !== 2) throw new Error(`Pair ${offset + index + 1} does not contain exactly two games.`)
    if (games[0].openingIndex !== games[1].openingIndex) throw new Error(`Pair ${offset + index + 1} does not use the same opening for both colors.`)
    if (new Set(games.map((game) => game.candidateColor)).size !== 2) throw new Error(`Pair ${offset + index + 1} does not reverse candidate color.`)
    pairRows.push({ pair: offset + index + 1, openingIndex: games[0].openingIndex, score: Number(checkpoint.pairs[index]), games })
  }
}
pairRows.sort((a, b) => a.pair - b.pair)
if (new Set(pairRows.map((row) => row.pair)).size !== pairRows.length) throw new Error('Duplicate global pair indexes detected.')
if (new Set(pairRows.map((row) => row.openingIndex)).size !== pairRows.length) throw new Error('Duplicate opening indexes detected; expected sampling without replacement.')
const conditionKeys = ['engineA', 'engineB', 'engineAHash', 'engineBHash', 'openingHash', 'initialMs', 'incrementMs', 'threads', 'hashMb', 'seed']
for (const checkpoint of checkpoints.slice(1)) {
  for (const key of conditionKeys) {
    if (checkpoint.conditions[key] !== checkpoints[0].conditions[key]) throw new Error(`Worker condition mismatch for ${key}.`)
  }
}
if (pairRows.some((row) => row.pair < 1 || row.pair > expectedPairs)) throw new Error(`Pair index outside 1..${expectedPairs}.`)
if (pairRows.length === expectedPairs) {
  for (let index = 0; index < pairRows.length; index++) {
    if (pairRows[index].pair !== index + 1) throw new Error(`Completed run has a pair index gap before ${index + 1}.`)
  }
}
const games = pairRows.flatMap((row) => row.games)
const wins = games.filter((game) => game.candidateScore === 1).length
const draws = games.filter((game) => game.candidateScore === 0.5).length
const losses = games.length - wins - draws
const normalized = pairRows.map((row) => row.score / 2)
const score = mean(normalized)
const variance = normalized.reduce((sum, value) => sum + (value - score) ** 2, 0) / Math.max(1, normalized.length - 1)
const standardError = Math.sqrt(variance / normalized.length)
const score95 = [clamp(score - 1.959963984540054 * standardError), clamp(score + 1.959963984540054 * standardError)]
const penta = [0, 0, 0, 0, 0]
for (const row of pairRows) penta[Math.round(row.score * 2)] += 1
const relativeElo = elo(score)
const relativeElo95 = score95.map(elo)
const illegalMoves = games.filter((game) => game.illegalMove).length
const timeForfeits = games.filter((game) => game.timeout).length
const searchRows = games.flatMap((game) => (game.searches ?? []).map((search) => ({ pair: game.pair, openingIndex: game.openingIndex, candidateColor: game.candidateColor, ...search })))
const performanceByEngine = Object.fromEntries(['obsidian-16', 'stockfish-18'].map((engineId) => {
  const rows = searchRows.filter((row) => row.engineId === engineId)
  return [engineId, summarizeSearches(rows)]
}))
const complete = pairRows.length === expectedPairs
const clean = illegalMoves === 0 && timeForfeits === 0
const equivalent = complete && clean && relativeElo95[0] >= -50 && relativeElo95[1] <= 50
const status = equivalent ? 'passed' : !complete ? 'running' : clean ? 'failed' : 'failed-runtime'
const report = {
  schema: 'project10-chess-arena-aggregate-v1',
  generatedAt: new Date().toISOString(),
  input,
  conditions: { ...checkpoints[0].conditions, expectedPairs, pairedColorReversal: true },
  summary: { pairs: pairRows.length, games: games.length, wins, draws, losses, score, relativeElo, relativeElo95, score95, los: normalCdf((score - 0.5) / Math.max(1e-12, standardError)), pentanomial: penta, illegalMoves, timeForfeits, performanceByEngine },
  qualification: { status, rule: `Exactly ${expectedPairs} paired openings; complete paired 95% Elo interval inside [-50,+50]; zero illegal moves and time forfeits.`, note: 'Relative engine Elo under the recorded conditions; not human FIDE Elo.' },
  workers: checkpoints.map((checkpoint) => ({ pairOffset: checkpoint.conditions.pairOffset, completedPairs: checkpoint.pairs.length, targetPairs: checkpoint.conditions.targetPairs, updatedAt: checkpoint.updatedAt })),
}
await writeFile(resolve(input, 'aggregate-report.json'), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(resolve(input, 'AGGREGATE_REPORT.md'), markdown(report))
await writeFile(resolve(input, 'games.pgn'), pairRows.flatMap((row) => row.games.map((game) => game.pgn)).join('\n\n'))
await writeFile(resolve(input, 'games.csv'), csv(games))
await writeFile(resolve(input, 'searches.csv'), searchCsv(searchRows))
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.5 }
function clamp(value) { return Math.max(0.000001, Math.min(0.999999, value)) }
function elo(value) { return -400 * Math.log10(1 / clamp(value) - 1) }
function normalCdf(value) { const sign = value < 0 ? -1 : 1; const x = Math.abs(value) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * x); const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); return (1 + erf) / 2 }
function summarizeSearches(rows) { const value = (key) => rows.map((row) => Number(row[key])).filter(Number.isFinite); const metric = (key) => { const values = value(key).sort((a,b)=>a-b); return { mean: mean(values), p95: percentile(values,.95) } }; return { searches: rows.length, wallMs: metric('wallMs'), uciMs: metric('uciMs'), depth: metric('depth'), nodes: metric('nodes'), nps: metric('nps') } }
function percentile(values, p) { if (!values.length) return 0; const index = (values.length - 1) * p; const lower = Math.floor(index), upper = Math.ceil(index); return values[lower] + (values[upper] - values[lower]) * (index - lower) }
function markdown(report) { const s = report.summary; return `# Obsidian 16.0 vs Stockfish 18 配对汇总\n\n- 状态：**${report.qualification.status}**\n- 样本：${s.pairs} 对 / ${s.games} 盘\n- Obsidian 胜和负：${s.wins}/${s.draws}/${s.losses}\n- 得分率：${(s.score * 100).toFixed(2)}%\n- 相对 Elo：${s.relativeElo.toFixed(2)}，配对 95% 区间 [${s.relativeElo95.map((value) => value.toFixed(2)).join(', ')}]\n- LOS：${(s.los * 100).toFixed(2)}%\n- Pentanomial：${s.pentanomial.join(' / ')}\n- 非法着法 / 超时：${s.illegalMoves} / ${s.timeForfeits}\n\n${report.qualification.note}\n` }
function csv(rows) { const fields = ['pair','candidateColor','result','candidateScore','plies','illegalMove','timeout','elapsedMs','depth','nodes','nps']; return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => JSON.stringify(row[field] ?? '')).join(',')).join('\n')}\n` }
function searchCsv(rows) { const fields = ['pair','openingIndex','candidateColor','ply','side','engineId','uci','wallMs','uciMs','depth','nodes','nps','clockAfterMs']; return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => JSON.stringify(row[field] ?? '')).join(',')).join('\n')}\n` }
