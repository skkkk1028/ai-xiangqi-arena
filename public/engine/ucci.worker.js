/* global Stockfish */
'use strict'

const NETWORK = 'xiangqi-c07e94a5c7cb.nnue'
const NETWORK_SHA256 = 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11'
const ENGINE_VERSION = 'fairy-stockfish-nnue.wasm@1.1.11'
const ENGINE_COMMIT = '5589ea54'

let engine = null
let outputWaiters = []
let activeSearchId = null
let queuedSearch = null
let assetBase = ''

self.onmessage = async (event) => {
  const message = event.data
  try {
    if (message.type === 'init') await initialize(message)
    else if (message.type === 'search') {
      if (!engine) throw new Error('专业引擎尚未就绪。')
      if (activeSearchId !== null) {
        queuedSearch = message
        send('stop')
      } else {
        startSearch(message)
      }
    } else if (message.type === 'stop') {
      queuedSearch = null
      if (engine && activeSearchId !== null) send('stop')
    } else if (message.type === 'newgame') {
      if (engine) {
        send('stop')
        send('uccinewgame')
        send('isready')
      }
    }
  } catch (error) {
    fatal(error)
  }
}

async function initialize(message) {
  if (engine) return
  assetBase = message.assetBase
  progress('checking', 0, 1, '检查 WebAssembly、线程与跨源隔离')
  if (
    typeof WebAssembly !== 'object' ||
    typeof SharedArrayBuffer !== 'function' ||
    self.crossOriginIsolated !== true
  ) {
    throw new Error('当前浏览器环境不支持专业多线程 WebAssembly 引擎。')
  }

  progress('loading', 0, 1, '加载 Fairy-Stockfish WebAssembly')
  importScripts(`${assetBase}stockfish.js`)
  engine = await Stockfish({
    locateFile: (path) => `${assetBase}${path}`,
    mainScriptUrlOrBlob: `${assetBase}stockfish.js`,
  })
  engine.addMessageListener(handleEngineLine)

  const bytes = await downloadNetwork(`${assetBase}${NETWORK}`)
  progress('verifying', bytes.byteLength, bytes.byteLength, '校验 NNUE 参数 SHA-256')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (hash !== NETWORK_SHA256) {
    throw new Error(`NNUE 参数校验失败（实际 ${hash.slice(0, 12)}…）。`)
  }
  engine.FS.writeFile(`/${NETWORK}`, new Uint8Array(bytes))

  progress('initializing', 1, 4, '建立 UCCI 会话')
  send('ucci')
  await waitFor((line) => line === 'ucciok', 15_000, '等待 ucciok 超时')

  const options = [
    `setoption Threads ${message.threads}`,
    `setoption hashsize ${message.hashMb}`,
    'setoption Ponder false',
    'setoption MultiPV 1',
    'setoption Skill_Level 20',
    'setoption UCI_LimitStrength false',
    'setoption UCI_ShowWDL true',
    'setoption Use_NNUE true',
    `setoption EvalFile /${NETWORK}`,
    'setoption usemillisec true',
  ]
  options.forEach(send)
  progress('initializing', 2, 4, '应用满强度 NNUE 配置')
  send('isready')
  await waitFor((line) => line === 'readyok', 30_000, '等待 readyok 超时')

  progress('initializing', 3, 4, '用测试局面确认 NNUE 已启用')
  const verification = []
  const listener = (line) => verification.push(line)
  const unsubscribe = observe(listener)
  send('position startpos')
  send('go depth 1')
  await waitFor((line) => /^bestmove|^nobestmove/.test(line), 30_000, 'NNUE 自检搜索超时')
  unsubscribe()
  const joined = verification.join('\n')
  if (/classical evaluation enabled/i.test(joined)) {
    throw new Error('引擎退回经典评估，已阻止开局。')
  }
  if (!/NNUE evaluation using .* enabled/i.test(joined)) {
    throw new Error('未检测到 NNUE 启用确认，已阻止开局。')
  }

  progress('ready', 1, 1, 'Fairy-Stockfish NNUE 已就绪')
  self.postMessage({
    type: 'ready',
    profile: {
      name: 'Fairy-Stockfish NNUE · UCCI',
      version: ENGINE_VERSION,
      commit: ENGINE_COMMIT,
      network: NETWORK,
      networkSha256: NETWORK_SHA256,
      threads: message.threads,
      hashMb: message.hashMb,
    },
  })
}

async function downloadNetwork(url) {
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`NNUE 参数下载失败（HTTP ${response.status}）。`)
  const total = Number(response.headers.get('content-length')) || 0
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    progress('downloading', buffer.byteLength, buffer.byteLength, '下载 NNUE 参数')
    return buffer
  }
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    progress('downloading', loaded, total, '下载 NNUE 参数')
  }
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

function progress(phase, loaded, total, message) {
  self.postMessage({ type: 'progress', progress: { phase, loaded, total, message } })
}

function send(command) {
  engine.postMessage(command)
}

const observers = new Set()

function observe(listener) {
  observers.add(listener)
  return () => observers.delete(listener)
}

function handleEngineLine(rawLine) {
  const line = String(rawLine).trim()
  if (!line) return
  observers.forEach((listener) => listener(line))
  const waiters = outputWaiters
  outputWaiters = []
  waiters.forEach((waiter) => {
    if (waiter.predicate(line)) waiter.resolve(line)
    else outputWaiters.push(waiter)
  })
  if (activeSearchId !== null) {
    const completedSearchId = activeSearchId
    self.postMessage({ type: 'line', line, searchId: completedSearchId })
    if (/^bestmove|^nobestmove/.test(line)) {
      activeSearchId = null
      if (queuedSearch) {
        const next = queuedSearch
        queuedSearch = null
        startSearch(next)
      }
    }
  }
}

function startSearch(message) {
  activeSearchId = message.searchId
  send(`position startpos${message.moves.length ? ` moves ${message.moves.join(' ')}` : ''}`)
  send(`go movetime ${message.movetimeMs}`)
}

function waitFor(predicate, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject }
    outputWaiters.push(waiter)
    const timeout = setTimeout(() => {
      outputWaiters = outputWaiters.filter((entry) => entry !== waiter)
      reject(new Error(timeoutMessage))
    }, timeoutMs)
    const originalResolve = waiter.resolve
    waiter.resolve = (line) => {
      clearTimeout(timeout)
      originalResolve(line)
    }
  })
}

function fatal(error) {
  const message = error instanceof Error ? error.message : String(error)
  try {
    engine?.terminate?.()
  } catch {
    // The worker will be discarded after a fatal initialization/runtime error.
  }
  engine = null
  self.postMessage({ type: 'fatal', message })
}
