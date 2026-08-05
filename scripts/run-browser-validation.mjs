#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

/**
 * Run the page-owned browser validation through an already-running Chrome
 * DevTools Protocol endpoint. This deliberately has no browser launcher and
 * no third-party dependency: Chrome is the system-under-test, while this
 * process only polls the page's explicit validation contract.
 *
 * Page contract (preferred):
 *
 * window.__AI_XIANGQI_BROWSER_VALIDATION__ = {
 *   status: 'running' | 'passed' | 'failed',
 *   metrics: { ... },
 *   failures: [ ... ],
 * }
 *
 * `complete`/`done` plus `passed`/`ok`/`success` are also accepted to make
 * the runner tolerant of a compact page-side implementation.
 */

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222'
const DEFAULT_PAGE_URL = 'http://127.0.0.1:4173/browser-validation.html'
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1_000
const DEFAULT_POLL_MS = 1_000

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const startedAt = new Date().toISOString()
  const startedAtMs = Date.now()
  let target = null
  let client = null
  let outcome = null
  let exitCode = 1
  let pageClosed = false

  try {
    target = await createTarget(options.cdpUrl)
    client = await CdpClient.connect(target.webSocketDebuggerUrl, connectionTimeout(options.timeoutMs))

    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Page.bringToFront')
    const navigation = await client.send('Page.navigate', { url: options.pageUrl })
    if (navigation.errorText) {
      throw new Error(`Chrome 无法打开验证页面：${navigation.errorText}`)
    }
    await client.send('Page.bringToFront')

    outcome = await pollValidation(client, options, startedAtMs)
    exitCode = outcome.status === 'passed' ? 0 : 1
  } catch (error) {
    outcome = {
      status: 'error',
      error: serializeError(error),
    }
  } finally {
    try {
      client?.close()
    } catch {
      // Closing an already-failed CDP socket is best effort only.
    }

    if (target && !options.keepPage) {
      try {
        await closeTarget(options.cdpUrl, target.id)
        pageClosed = true
      } catch (error) {
        outcome = {
          ...(outcome ?? { status: 'error' }),
          cleanupError: serializeError(error),
        }
        exitCode = 1
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const report = {
    ...outcome,
    startedAt,
    finishedAt,
    elapsedMs: Date.now() - startedAtMs,
    cdpUrl: options.cdpUrl,
    pageUrl: options.pageUrl,
    timeoutMs: options.timeoutMs,
    pollMs: options.pollMs,
    targetId: target?.id ?? null,
    pageClosed,
  }
  if (options.outputPath) {
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  writeJson(report)
  process.exitCode = exitCode
}

function parseArguments(args) {
  const options = {
    cdpUrl: DEFAULT_CDP_URL,
    pageUrl: DEFAULT_PAGE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
    outputPath: null,
    keepPage: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === '--keep-page') {
      options.keepPage = true
      continue
    }

    const [name, inlineValue] = argument.split(/=(.*)/s, 2)
    const value = inlineValue ?? args[++index]
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} 需要一个值`)
    }

    if (name === '--cdp-url') options.cdpUrl = normaliseHttpUrl(value, '--cdp-url')
    else if (name === '--page-url') options.pageUrl = normaliseHttpUrl(value, '--page-url')
    else if (name === '--timeout-ms') options.timeoutMs = parsePositiveInteger(value, '--timeout-ms')
    else if (name === '--poll-ms') options.pollMs = parsePositiveInteger(value, '--poll-ms')
    else if (name === '--output') options.outputPath = value
    else throw new Error(`未知参数：${argument}`)
  }

  if (options.pollMs > options.timeoutMs) options.pollMs = options.timeoutMs
  return options
}

function normaliseHttpUrl(value, label) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} 不是有效 URL：${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 只接受 http(s) URL：${value}`)
  }
  return parsed.href
}

function parsePositiveInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} 必须是正整数：${value}`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} 必须是正整数：${value}`)
  }
  return parsed
}

async function createTarget(cdpUrl) {
  const endpoint = chromeEndpoint(cdpUrl, '/json/new?about:blank')
  const response = await fetchWithTimeout(endpoint, { method: 'PUT' }, 15_000)
  if (!response.ok) {
    throw new Error(`Chrome CDP 未能创建页面（HTTP ${response.status}）：${await response.text()}`)
  }
  const target = await response.json()
  if (!target?.id || !target.webSocketDebuggerUrl) {
    throw new Error('Chrome CDP 创建的页面没有 target id 或 WebSocket 地址')
  }
  return target
}

async function closeTarget(cdpUrl, targetId) {
  const endpoint = chromeEndpoint(cdpUrl, `/json/close/${encodeURIComponent(targetId)}`)
  const response = await fetchWithTimeout(endpoint, { method: 'GET' }, 10_000)
  if (!response.ok) {
    throw new Error(`Chrome CDP 未能关闭本次创建的页面（HTTP ${response.status}）`)
  }
}

function chromeEndpoint(cdpUrl, path) {
  const base = new URL(cdpUrl)
  return `${base.protocol}//${base.host}${path}`
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`连接 Chrome CDP 超时（${timeoutMs} ms）：${url}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function connectionTimeout(timeoutMs) {
  return Math.max(1_000, Math.min(timeoutMs, 30_000))
}

async function pollValidation(client, options, startedAtMs) {
  const deadline = startedAtMs + options.timeoutMs
  let lastValidation = null
  let lastPage = null

  while (Date.now() <= deadline) {
    const observation = await readPageValidation(client)
    lastPage = observation.page
    if (observation.kind === 'error') {
      return {
        status: 'failed',
        reason: 'page-validation-error',
        validation: observation.error,
        page: lastPage,
      }
    }
    if (observation.kind === 'value') {
      lastValidation = observation.value
      const status = classifyValidation(observation.value)
      if (status === 'passed' || status === 'failed') {
        return {
          status,
          validation: observation.value,
          page: lastPage,
        }
      }
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(options.pollMs, remainingMs))
  }

  return {
    status: 'timeout',
    reason: 'validation-timeout',
    validation: lastValidation,
    page: lastPage,
  }
}

async function readPageValidation(client) {
  const result = await client.send('Runtime.evaluate', {
    expression: `
      (async () => {
        try {
          const source = window.__AI_XIANGQI_BROWSER_VALIDATION__
          const value = typeof source === 'function' ? await source() : source
          return {
            kind: value === undefined ? 'missing' : 'value',
            value,
            page: {
              href: location.href,
              readyState: document.readyState,
              crossOriginIsolated: window.crossOriginIsolated === true,
              sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
              userAgent: navigator.userAgent,
            },
          }
        } catch (error) {
          return {
            kind: 'error',
            error: {
              name: error instanceof Error ? error.name : 'Error',
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
            page: { href: location.href, readyState: document.readyState },
          }
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  })

  if (result.exceptionDetails) {
    return {
      kind: 'error',
      error: {
        name: 'Runtime.evaluate',
        message: result.exceptionDetails.text ?? 'Chrome 执行验证状态读取失败',
      },
      page: null,
    }
  }

  const value = result.result?.value
  if (!value || typeof value !== 'object') {
    return {
      kind: 'error',
      error: { name: 'ValidationProtocolError', message: '页面验证状态未返回可读取对象' },
      page: null,
    }
  }
  return value
}

function classifyValidation(value) {
  if (typeof value === 'string') return classifyStatus(value)
  if (!value || typeof value !== 'object') return 'running'

  if (value.failed === true) return 'failed'
  const explicit = classifyStatus(value.status ?? value.state ?? value.result)
  if (explicit !== 'running') return explicit

  if (value.complete === true || value.completed === true || value.done === true || value.finished === true) {
    if (value.passed === false || value.ok === false || value.success === false) return 'failed'
    return 'passed'
  }
  return 'running'
}

function classifyStatus(value) {
  if (typeof value !== 'string') return 'running'
  const normalised = value.trim().toLowerCase()
  if (['passed', 'pass', 'success', 'succeeded', 'ok'].includes(normalised)) return 'passed'
  if (['failed', 'fail', 'error', 'errored', 'aborted'].includes(normalised)) return 'failed'
  return 'running'
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

class CdpClient {
  static async connect(url, timeoutMs) {
    if (typeof WebSocket !== 'function') {
      throw new Error('当前 Node.js 没有原生 WebSocket；请使用 Node.js 22+ 运行此脚本')
    }

    const socket = new WebSocket(url)
    const client = new CdpClient(socket)
    await client.waitForOpen(timeoutMs)
    return client
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.closed = false
    socket.addEventListener('message', (event) => this.handleMessage(event))
    socket.addEventListener('error', () => this.rejectPending(new Error('Chrome CDP WebSocket 连接错误')))
    socket.addEventListener('close', () => {
      this.closed = true
      this.rejectPending(new Error('Chrome CDP WebSocket 已关闭'))
    })
  }

  waitForOpen(timeoutMs) {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`连接 Chrome CDP WebSocket 超时（${timeoutMs} ms）`))
      }, timeoutMs)
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('无法连接 Chrome CDP WebSocket；请确认 Chrome 使用 --remote-debugging-port 和 --remote-allow-origins 启动'))
      }
      const cleanup = () => {
        clearTimeout(timeout)
        this.socket.removeEventListener('open', onOpen)
        this.socket.removeEventListener('error', onError)
      }
      this.socket.addEventListener('open', onOpen, { once: true })
      this.socket.addEventListener('error', onError, { once: true })
    })
  }

  send(method, params = {}, timeoutMs = 30_000) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Chrome CDP WebSocket 不可用，无法调用 ${method}`))
    }

    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chrome CDP 调用超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.rejectPending(new Error('Chrome CDP 客户端已关闭'))
    this.socket.close()
  }

  handleMessage(event) {
    let message
    try {
      message = JSON.parse(readWebSocketData(event.data))
    } catch {
      return
    }
    if (!Number.isInteger(message.id)) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(`Chrome CDP ${message.error.code ?? ''}: ${message.error.message ?? 'unknown error'}`))
    } else {
      pending.resolve(message.result ?? {})
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function readWebSocketData(value) {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  return String(value)
}

function serializeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  return { name: 'Error', message: String(error) }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/run-browser-validation.mjs [options]\n\n` +
    `  --cdp-url <url>     Chrome remote-debugging HTTP endpoint (default: ${DEFAULT_CDP_URL})\n` +
    `  --page-url <url>    Validation page to open (default: ${DEFAULT_PAGE_URL})\n` +
    `  --timeout-ms <ms>   Overall validation timeout (default: ${DEFAULT_TIMEOUT_MS})\n` +
    `  --poll-ms <ms>      Page validation polling interval (default: ${DEFAULT_POLL_MS})\n` +
    `  --output <path>     Write the complete JSON result to a local file\n` +
    `  --keep-page          Do not close the tab created by this script\n` +
    `  -h, --help           Show this help\n`)
}

main().catch((error) => {
  writeJson({ status: 'error', error: serializeError(error) })
  process.exitCode = 1
})
