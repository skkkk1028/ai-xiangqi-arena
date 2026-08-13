#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = process.cwd()
const networkFetch = globalThis.fetch
const output = resolve(root, 'public', 'engine')
const prefix = 'chess-nn-3475407dc199.nnue.part-'
const expectedBytes = 47_721_371
const expectedHash = '3475407dc19973ea44467678634cce023d620e419770c111cc8937fe6689ec87'
const maxPartBytes = 20 * 1024 * 1024

const names = ['01', '02', '03'].map((id) => `${prefix}${id}`)
const hash = createHash('sha256')
let total = 0
const partSizes = []
const modelParts = []
for (const name of names) {
  const bytes = await readFile(resolve(output, name))
  const size = (await stat(resolve(output, name))).size
  if (size > maxPartBytes) throw new Error(`${name} exceeds the 20 MiB deployment limit (${size}).`)
  total += size
  partSizes.push({ name, bytes: size })
  modelParts.push(bytes)
  hash.update(bytes)
}
const actualHash = hash.digest('hex')
if (total !== expectedBytes) throw new Error(`Chess NNUE size mismatch: ${total} !== ${expectedBytes}`)
if (actualHash !== expectedHash) throw new Error(`Chess NNUE SHA-256 mismatch: ${actualHash}`)

// Protocol smoke: exercise the same UCI + NNUE combination used by the Worker.
// Chromium verification remains a separate deployment gate because Node cannot
// provide COOP/COEP or SharedArrayBuffer isolation semantics.
globalThis.fetch = undefined
const require = createRequire(import.meta.url)
const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js')
const engine = await Stockfish({ locateFile: (file) => resolve(root, 'node_modules', 'fairy-stockfish-nnue.wasm', file) })
const lines = []
const waiters = []
engine.addMessageListener((raw) => {
  const line = String(raw).trim()
  if (!line) return
  lines.push(line)
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    if (waiters[index].predicate(line)) waiters.splice(index, 1)[0].resolve(line)
  }
})
const waitFor = (predicate, timeoutMs = 30_000) => new Promise((resolvePromise, reject) => {
  const waiter = { predicate, resolve: resolvePromise }
  waiters.push(waiter)
  setTimeout(() => {
    const index = waiters.indexOf(waiter)
    if (index >= 0) waiters.splice(index, 1)
    reject(new Error('Chess UCI protocol verification timed out.'))
  }, timeoutMs)
})
engine.postMessage('uci')
await waitFor((line) => line === 'uciok')
const model = Buffer.concat(modelParts)
engine.FS.writeFile('/chess-nn-3475407dc199.nnue', model)
for (const command of [
  'setoption name UCI_Variant value chess',
  'setoption name Threads value 1',
  'setoption name Hash value 32',
  'setoption name MultiPV value 4',
  'setoption name UCI_ShowWDL value true',
  'setoption name Use NNUE value true',
  'setoption name Skill Level value 20',
  'setoption name UCI_LimitStrength value false',
  'setoption name EvalFile value /chess-nn-3475407dc199.nnue',
]) engine.postMessage(command)
engine.postMessage('isready')
await waitFor((line) => line === 'readyok')
engine.postMessage('position startpos')
engine.postMessage('go depth 1')
await waitFor((line) => /^bestmove\s+[a-h][1-8][a-h][1-8][qrbn]?/.test(line))
if (!lines.some((line) => /NNUE evaluation using .* enabled/i.test(line))) {
  throw new Error(`Chess NNUE was not confirmed by Fairy-Stockfish. Output: ${lines.slice(-20).join(' | ')}`)
}
engine.terminate()

const browserArgs = parseBrowserArgs(process.argv.slice(2))
const browser = browserArgs.cdpUrl
  ? await verifyChromium(browserArgs)
  : { status: 'not-run', reason: '未提供 --cdp-url；已完成 WASM/UCI/NNUE 预检。' }

console.log(JSON.stringify({
  status: 'passed',
  mode: 'wasm-uci-nnue-preflight',
  model: 'nn-3475407dc199.nnue',
  bytes: total,
  sha256: actualHash,
  parts: partSizes,
  browser,
  note: browser.status === 'passed'
    ? browserArgs.professional
      ? `已验证固定 Stockfish 18 专业模式在生产 Chromium 页面完成 ${browser.halfMoves} 个半回合，并通过暂停无迟到落子门禁。`
      : `已验证真实 Fairy-Stockfish WASM 的 UCI、chess variant、NNUE 指纹、${browser.halfMoves} 个半回合和暂停无迟到落子。`
    : '已验证真实 Fairy-Stockfish WASM 的 UCI、chess variant、NNUE 指纹和 bestmove；传入 --cdp-url 后可执行 Chromium/COOP/COEP 连续 20 半回合门禁。',
}, null, 2))

function parseBrowserArgs(args) {
  const result = { cdpUrl: process.env.CHESS_VERIFY_CDP_URL ?? null, pageUrl: process.env.CHESS_VERIFY_PAGE_URL ?? 'http://127.0.0.1:4173/#/games/chess', timeoutMs: 10 * 60 * 1_000, halfMoves: 20, professional: false }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--cdp-url') result.cdpUrl = args[++index]
    else if (args[index] === '--page-url') result.pageUrl = args[++index]
    else if (args[index] === '--timeout-ms') result.timeoutMs = Number(args[++index])
    else if (args[index] === '--half-moves') result.halfMoves = Number(args[++index])
    else if (args[index] === '--professional') result.professional = true
  }
  return result
}

async function verifyChromium(options) {
  if (typeof WebSocket !== 'function') throw new Error('当前 Node 运行时没有 WebSocket，无法连接 Chromium CDP。')
  if (!networkFetch) throw new Error('当前 Node 运行时没有 fetch，无法连接 Chromium CDP。')
  const targets = await networkFetch(`${options.cdpUrl.replace(/\/$/, '')}/json/list`).then((response) => response.json())
  const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
  if (!target) throw new Error('CDP 没有找到可用的 Chromium 页面 target。')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = ++nextId
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolvePromise(message.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: options.pageUrl })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 800))
  if (options.professional) {
    const selected = await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes('专业 · 10 秒')); button?.click(); return Boolean(button); })()`, returnByValue: true })
    if (!selected.result?.value) throw new Error('Chromium 国际象棋验证找不到专业模式按钮。')
  }
  await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes('开始观战')); button?.click(); return Boolean(button); })()` })
  const started = Date.now()
  let snapshot = null
  let pauseChecked = false
  let pausedHalfMoves = null
  while (Date.now() - started < options.timeoutMs) {
    const result = await send('Runtime.evaluate', { expression: 'window.__AI_CHESS_BROWSER_VALIDATION__', returnByValue: true })
    snapshot = result.result?.value ?? null
    if (!pauseChecked && snapshot?.halfMoves >= 1) {
      const pauseResult = await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes('暂停')); button?.click(); return Boolean(button); })()`, returnByValue: true })
      if (!pauseResult.result?.value) throw new Error('Chromium 国际象棋验证找不到暂停按钮。')
      let pausedSnapshot = null
      const pauseDeadline = Date.now() + 10_000
      while (Date.now() < pauseDeadline) {
        const afterPause = await send('Runtime.evaluate', { expression: 'window.__AI_CHESS_BROWSER_VALIDATION__', returnByValue: true })
        pausedSnapshot = afterPause.result?.value
        if (pausedSnapshot?.paused === true) break
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      }
      if (pausedSnapshot?.paused !== true) throw new Error(`国际象棋页面未进入暂停状态：${JSON.stringify(pausedSnapshot)}`)
      pausedHalfMoves = pausedSnapshot.halfMoves
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
      const stablePause = await send('Runtime.evaluate', { expression: 'window.__AI_CHESS_BROWSER_VALIDATION__', returnByValue: true })
      if (stablePause.result?.value?.halfMoves !== pausedHalfMoves || stablePause.result?.value?.paused !== true) {
        throw new Error(`暂停稳定后仍有迟到落子：${JSON.stringify({ before: pausedHalfMoves, after: stablePause.result?.value })}`)
      }
      await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes('继续')); button?.click(); return Boolean(button); })()` })
      pauseChecked = true
    }
    if (snapshot?.halfMoves >= options.halfMoves || snapshot?.status === 'failed') break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
  }
  socket.close()
  if (!snapshot || snapshot.halfMoves < options.halfMoves || snapshot.status === 'failed' || !pauseChecked) throw new Error(`Chromium 国际象棋验证未完成：${JSON.stringify(snapshot)}`)
  if (options.professional && snapshot.model !== 'Stockfish 18 embedded NNUE') {
    throw new Error(`专业模式没有报告 Stockfish 18 模型：${JSON.stringify(snapshot)}`)
  }
  return { status: 'passed', halfMoves: snapshot.halfMoves, model: snapshot.model, paused: snapshot.paused, pauseChecked, error: snapshot.error }
}
