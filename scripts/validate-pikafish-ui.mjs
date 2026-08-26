#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222'
const DEFAULT_PAGE_URL = 'http://127.0.0.1:4173/#/games/xiangqi'

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const report = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    cdpUrl: options.cdpUrl,
    pageUrl: options.pageUrl,
    checks: {},
  }
  let target = null
  let client = null

  try {
    target = await createTarget(options.cdpUrl)
    client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.navigate', { url: options.pageUrl })

    await waitFor(client, `document.querySelector('button[aria-label="真人 vs AI"]')?.disabled === false`, options.timeoutMs)
    report.checks.homeReady = true

    await click(client, '真人 vs AI')
    await waitFor(client, '#human-engine', options.timeoutMs)
    report.checks.humanPickerHasPikafish2026 = await evaluate(client, `
      [...document.querySelector('#human-engine').options]
        .some((option) => option.value === 'pikafish-2026-nnue')
    `)
    await selectValue(client, '#human-engine', 'pikafish-2026-nnue')
    await clickSelector(client, 'input[name="difficulty"][value="1"]')
    await click(client, '开始人机对战')
    await waitFor(client, `.human-match-page .chess-board-shell`, options.timeoutMs)
    report.checks.humanMatchPikafish2026 = await evaluate(client, `
      document.body.textContent.includes('Pikafish 2026 NNUE') &&
      document.body.textContent.includes('暂定档位')
    `)

    await click(client, '暂停')
    await waitFor(client, `.human-match-page .board-paused`, options.timeoutMs)
    report.checks.humanPause = true
    await click(client, '继续')
    await waitFor(client, `.human-match-page button[aria-label="红方兵 7行1列"]`, options.timeoutMs)
    report.checks.humanResume = true

    await clickSelector(client, `.human-match-page button[aria-label="红方兵 7行1列"]`)
    await clickSelector(client, `.human-match-page button[aria-label="6行1列空位"]`)
    await waitFor(client, `document.body.textContent.includes('兵九进一')`, options.timeoutMs)
    await waitFor(client, `document.body.textContent.includes('2 步')`, options.timeoutMs)
    report.checks.humanMoveAndPikafishReply = true

    await clickSelector(client, `.human-match-page button[aria-label="返回首页"]`)
    await waitFor(client, `document.querySelector('button[aria-label="AI 引擎对战 / AI 引擎大战"]')?.disabled === false`, options.timeoutMs)
    await clickSelector(client, `button[aria-label="AI 引擎对战 / AI 引擎大战"]`)
    await waitFor(client, '#red-engine', options.timeoutMs)
    report.checks.battlePickerHasPikafish2026 = await evaluate(client, `
      [...document.querySelector('#red-engine').options]
        .some((option) => option.value === 'pikafish-2026-nnue') &&
      [...document.querySelector('#black-engine').options]
        .some((option) => option.value === 'pikafish-2026-nnue')
    `)
    await selectValue(client, '#red-engine', 'pikafish-2026-nnue')
    await selectValue(client, '#black-engine', 'fairy-stockfish-nnue')
    await click(client, '开始引擎对战')
    await waitFor(client, `.match-page .chess-board-shell`, options.timeoutMs)
    report.checks.engineBattlePikafish2026 = await evaluate(client, `
      document.body.textContent.includes('Pikafish 2026 NNUE') &&
      document.body.textContent.includes('Fairy-Stockfish NNUE')
    `)
    await click(client, '暂停')
    await waitFor(client, `.match-page .board-paused`, options.timeoutMs)
    report.checks.engineBattlePause = true
    await click(client, '继续')
    await waitFor(client, `document.body.textContent.includes('1 步')`, options.timeoutMs)
    report.checks.engineBattleResumeAndMove = true

    report.status = Object.values(report.checks).every(Boolean) ? 'passed' : 'failed'
  } catch (error) {
    report.error = serializeError(error)
  } finally {
    report.finishedAt = new Date().toISOString()
    report.elapsedMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()
    if (client) client.close()
    if (target) {
      try {
        await closeTarget(options.cdpUrl, target.id)
        report.pageClosed = true
      } catch (error) {
        report.cleanupError = serializeError(error)
      }
    }
  }

  if (options.outputPath) await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.status === 'passed' ? 0 : 1
}

function parseArguments(args) {
  const options = { cdpUrl: DEFAULT_CDP_URL, pageUrl: DEFAULT_PAGE_URL, timeoutMs: 90_000, outputPath: null }
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值`)
    if (name === '--cdp-url') options.cdpUrl = httpUrl(value, name)
    else if (name === '--page-url') options.pageUrl = httpUrl(value, name)
    else if (name === '--timeout-ms') options.timeoutMs = positiveInteger(value, name)
    else if (name === '--output') options.outputPath = value
    else throw new Error(`未知参数：${name}`)
  }
  return options
}

function httpUrl(value, name) {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} 只接受 http(s) URL`)
  return parsed.href
}

function positiveInteger(value, name) {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`${name} 必须是正整数`)
  return Number(value)
}

async function createTarget(cdpUrl) {
  const response = await fetch(`${endpoint(cdpUrl)}/json/new?about:blank`, { method: 'PUT' })
  if (!response.ok) throw new Error(`Chrome CDP 未能创建页面（HTTP ${response.status}）`)
  return response.json()
}

async function closeTarget(cdpUrl, id) {
  const response = await fetch(`${endpoint(cdpUrl)}/json/close/${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(`Chrome CDP 未能关闭页面（HTTP ${response.status}）`)
}

function endpoint(cdpUrl) {
  const parsed = new URL(cdpUrl)
  return `${parsed.protocol}//${parsed.host}`
}

async function waitFor(client, selectorOrExpression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const expression = selectorOrExpression.startsWith('document.')
      ? selectorOrExpression
      : `Boolean(document.querySelector(${JSON.stringify(selectorOrExpression)}))`
    if (await evaluate(client, expression)) return
    await sleep(200)
  }
  throw new Error(`等待 UI 条件超时：${selectorOrExpression}`)
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    throw new Error(details.exception?.description ?? details.text ?? '页面脚本执行失败')
  }
  return result.result?.value
}

async function click(client, label) {
  await evaluate(client, `
    (() => {
      const normalise = (value) => value.replace(/\\s+/g, ' ').trim()
      const button = [...document.querySelectorAll('button')]
        .find((candidate) =>
          candidate.getAttribute('aria-label') === ${JSON.stringify(label)} ||
          normalise(candidate.textContent) === ${JSON.stringify(label)}
        )
      if (!button || button.disabled) throw new Error('未找到可点击按钮：${label}')
      button.click()
    })()
  `)
}

async function clickSelector(client, selector) {
  await evaluate(client, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement) || element.hasAttribute('disabled')) {
        throw new Error('未找到可点击元素：${selector}')
      }
      element.click()
    })()
  `)
}

async function selectValue(client, selector, value) {
  await evaluate(client, `
    (() => {
      const select = document.querySelector(${JSON.stringify(selector)})
      if (!(select instanceof HTMLSelectElement)) throw new Error('未找到选择器：${selector}')
      select.value = ${JSON.stringify(value)}
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()
  `)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url)
    const client = new CdpClient(socket)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 Chrome CDP 超时')), 30_000)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接 Chrome CDP')) }, { once: true })
    })
    return client
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')) } catch { return }
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result ?? {})
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    for (const pending of this.pending.values()) pending.reject(new Error('CDP 已关闭'))
    this.pending.clear()
    this.socket.close()
  }
}

function serializeError(error) {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: 'Error', message: String(error) }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
  process.exitCode = 1
})
