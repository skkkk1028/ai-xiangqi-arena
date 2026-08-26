import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}

const page = new URL('/xiangqi-calibration.html', options.previewUrl)
page.searchParams.set('engine', options.engine)
page.searchParams.set('opponent', options.opponent)
page.searchParams.set('pairs', String(options.pairs))
page.searchParams.set('nodes', String(options.nodes))
page.searchParams.set('max-plies', String(options.maxPlies))
page.searchParams.set('search-timeout-ms', String(options.searchTimeoutMs))

const runner = resolve(process.cwd(), 'scripts', 'run-browser-validation.mjs')
const timeoutMs = Math.max(
  options.timeoutMs,
  options.pairs * 2 * options.maxPlies * Math.min(options.searchTimeoutMs, 15_000) + 120_000,
)
const args = [
  runner,
  '--cdp-url', options.cdpUrl,
  '--page-url', page.href,
  '--timeout-ms', String(timeoutMs),
  '--poll-ms', String(options.pollMs),
]
if (options.output) args.push('--output', options.output)

const child = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
if (child.error) throw child.error
process.exitCode = child.status ?? 1

function parseArguments(args) {
  const options = {
    cdpUrl: 'http://127.0.0.1:9222',
    previewUrl: 'http://127.0.0.1:4173',
    engine: 'pikafish-2026-nnue',
    opponent: 'fairy-stockfish-nnue',
    pairs: 20,
    nodes: 100_000,
    maxPlies: 240,
    searchTimeoutMs: 120_000,
    timeoutMs: 600_000,
    pollMs: 1_000,
    output: null,
    help: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    const [name, inlineValue] = argument.split(/=(.*)/s, 2)
    const value = inlineValue ?? args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值`)
    if (name === '--cdp-url') options.cdpUrl = value
    else if (name === '--preview-url') options.previewUrl = value
    else if (name === '--engine') options.engine = value
    else if (name === '--opponent') options.opponent = value
    else if (name === '--pairs') options.pairs = positiveInteger(value, name)
    else if (name === '--nodes') options.nodes = positiveInteger(value, name)
    else if (name === '--max-plies') options.maxPlies = positiveInteger(value, name)
    else if (name === '--search-timeout-ms') options.searchTimeoutMs = positiveInteger(value, name)
    else if (name === '--timeout-ms') options.timeoutMs = positiveInteger(value, name)
    else if (name === '--poll-ms') options.pollMs = positiveInteger(value, name)
    else if (name === '--output') options.output = value
    else throw new Error(`未知参数：${argument}`)
  }
  if (options.pairs > 500) throw new Error('--pairs 不能超过 500')
  if (options.nodes < 10_000 || options.nodes > 5_000_000) throw new Error('--nodes 必须在 10000–5000000 之间')
  if (options.maxPlies < 20 || options.maxPlies > 600) throw new Error('--max-plies 必须在 20–600 之间')
  if (options.pollMs > options.timeoutMs) options.pollMs = options.timeoutMs
  return options
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} 必须是正整数：${value}`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} 必须是正整数：${value}`)
  return parsed
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/calibrate-xiangqi-strength.mjs [options]\n\n` +
    `  --engine <id>                 红方首个引擎（默认 pikafish-2026-nnue）\n` +
    `  --opponent <id>               对手引擎（默认 fairy-stockfish-nnue）\n` +
    `  --pairs <n>                   换色开局对数，1–500（默认 20）\n` +
    `  --nodes <n>                   每步固定节点数（默认 100000）\n` +
    `  --max-plies <n>               单局半回合上限（默认 240）\n` +
    `  --search-timeout-ms <n>      单步保护超时（默认 120000）\n` +
    `  --cdp-url <url>               Chromium CDP 地址（默认 http://127.0.0.1:9222）\n` +
    `  --preview-url <url>           预览站点地址（默认 http://127.0.0.1:4173）\n` +
    `  --output <path>               保存 JSON 报告\n` +
    `  -h, --help                    显示帮助\n`)
}
