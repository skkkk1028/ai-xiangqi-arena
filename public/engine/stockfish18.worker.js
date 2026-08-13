'use strict'

// Product-protocol wrapper around the pinned nmrugg Stockfish.js 18 worker.
// The inner worker remains an unmodified GPLv3 release artifact.
let engine = null
let config = null
let assetBase = ''
let waiters = []
let activeSearchId = null
let queuedSearch = null
let currentMultiPv = 1
let waitingNewGameReady = false

self.onmessage = async (event) => {
  const message = event.data
  try {
    if (message.type === 'init') await initialize(message)
    else if (!engine) throw new Error('Stockfish 18 尚未就绪。')
    else if (message.type === 'command') send(message.command)
    else if (message.type === 'set-position') setPosition(message.moves)
    else if (message.type === 'search') queueOrStartSearch(message)
    else if (message.type === 'stop') stop()
    else if (message.type === 'newgame') newGame()
    else if (message.type === 'dispose') dispose()
  } catch (error) {
    fatal(error)
  }
}

async function initialize(message) {
  if (engine) return
  config = message.config
  assetBase = message.assetBase
  currentMultiPv = Number(config.options.MultiPV) || 1
  const multithreaded = !config.loaderPath.includes('-single')
  progress('checking', 0, 1, multithreaded ? '检查多线程 WebAssembly 隔离环境' : '检查单线程 WebAssembly 环境')
  if (typeof WebAssembly !== 'object') throw new Error('当前浏览器不支持 WebAssembly。')
  if (multithreaded && (typeof SharedArrayBuffer !== 'function' || self.crossOriginIsolated !== true)) {
    throw new Error('完整多线程 Stockfish 18 需要 SharedArrayBuffer 与跨源隔离。')
  }
  progress('loading', 0, 1, `加载 ${config.name} 完整版（约 108 MiB）`)
  const scriptUrl = new URL(config.loaderPath, assetBase).href
  let wasmUrl = new URL(config.wasmPath, assetBase).href
  if (Array.isArray(config.wasmParts) && config.wasmParts.length) {
    const bytes = await downloadAndVerifyParts(config.wasmParts, config.wasmSha256)
    wasmUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }))
  }
  engine = new Worker(`${scriptUrl}#${encodeURIComponent(wasmUrl)}`)
  engine.onmessage = (innerEvent) => handleLine(innerEvent.data)
  engine.onerror = (innerError) => fatal(new Error(innerError.message || 'Stockfish 18 Worker 异常。'))

  send('uci')
  await waitFor((line) => line === 'uciok', 90_000, '等待 Stockfish 18 UCI 初始化超时。')
  const commands = [
    ['Hash', config.hash],
    ['Ponder', false],
    ['MultiPV', currentMultiPv],
    ['UCI_LimitStrength', false],
    ['UCI_ShowWDL', true],
  ]
  if (multithreaded) commands.unshift(['Threads', config.threads])
  for (const [name, value] of commands) send(`setoption name ${name} value ${value}`)
  send('isready')
  await waitFor((line) => line === 'readyok', 90_000, '等待 Stockfish 18 readyok 超时。')
  progress('initializing', 3, 4, '执行真实起始局面搜索')
  send('position startpos')
  send('go depth 1')
  await waitFor((line) => /^bestmove\s+[a-h][1-8][a-h][1-8][qrbn]?/.test(line), 30_000, 'Stockfish 18 自检搜索超时。')
  progress('ready', 1, 1, 'Stockfish 18 专业模式已就绪')
  self.postMessage({
    type: 'ready',
    profile: {
      id: config.id,
      engineType: config.engineType,
      protocol: 'UCI',
      name: `${config.name} · UCI`,
      version: config.version,
      commit: config.commit,
      network: 'Stockfish 18 embedded NNUE',
      networkSha256: config.nnueSha256,
      threads: multithreaded ? config.threads : 1,
      hashMb: config.hash,
    },
  })
}

async function downloadAndVerifyParts(parts, expectedHash) {
  const chunks = []
  let total = 0
  for (const [index, name] of parts.entries()) {
    const response = await fetch(new URL(name, assetBase), { cache: 'force-cache' })
    if (!response.ok) throw new Error(`Stockfish 18 WASM 分片下载失败：${name} · HTTP ${response.status}`)
    const chunk = new Uint8Array(await response.arrayBuffer())
    chunks.push(chunk)
    total += chunk.byteLength
    progress('downloading', index + 1, parts.length, `加载 Stockfish 18 WASM 分片 ${index + 1}/${parts.length}`)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  progress('verifying', total, total, '校验 Stockfish 18 WASM SHA-256')
  const digest = await crypto.subtle.digest('SHA-256', merged)
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (actual !== expectedHash) throw new Error(`Stockfish 18 WASM 校验失败：${actual}`)
  return merged
}

function queueOrStartSearch(message) {
  if (activeSearchId !== null || waitingNewGameReady) {
    queuedSearch = message
    if (activeSearchId !== null) send('stop')
    return
  }
  startSearch(message)
}

function startSearch(message) {
  const requested = Math.max(1, Math.min(4, Math.floor(Number(message.multiPv) || 1)))
  if (requested !== currentMultiPv) {
    send(`setoption name MultiPV value ${requested}`)
    currentMultiPv = requested
  }
  activeSearchId = message.searchId
  self.postMessage({ type: 'search-started', searchId: message.searchId })
  setPosition(message.moves)
  const depth = Number(message.maxDepth)
  send(`go movetime ${Math.max(50, Math.floor(message.movetimeMs))}${depth > 0 ? ` depth ${Math.floor(depth)}` : ''}`)
}

function setPosition(moves) {
  send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`)
}

function stop() {
  queuedSearch = null
  if (activeSearchId !== null) send('stop')
}

function newGame() {
  queuedSearch = null
  if (activeSearchId !== null) send('stop')
  waitingNewGameReady = true
  send('ucinewgame')
  send('isready')
}

function handleLine(raw) {
  if (typeof raw !== 'string') return
  const line = raw.trim()
  if (!line) return
  const pendingWaiters = waiters
  waiters = []
  for (const waiter of pendingWaiters) {
    if (waiter.predicate(line)) waiter.resolve(line)
    else waiters.push(waiter)
  }
  if (waitingNewGameReady && line === 'readyok') {
    waitingNewGameReady = false
    if (queuedSearch) {
      const next = queuedSearch
      queuedSearch = null
      startSearch(next)
    }
    return
  }
  if (activeSearchId === null) return
  const completedId = activeSearchId
  self.postMessage({ type: 'line', line, searchId: completedId })
  if (/^bestmove|^nobestmove/.test(line)) {
    activeSearchId = null
    if (queuedSearch && !waitingNewGameReady) {
      const next = queuedSearch
      queuedSearch = null
      startSearch(next)
    }
  }
}

function waitFor(predicate, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve }
    waiters.push(waiter)
    const timer = setTimeout(() => {
      waiters = waiters.filter((entry) => entry !== waiter)
      reject(new Error(message))
    }, timeoutMs)
    waiter.resolve = (line) => {
      clearTimeout(timer)
      resolve(line)
    }
  })
}

function send(command) { engine.postMessage(command) }
function progress(phase, loaded, total, message) { self.postMessage({ type: 'progress', progress: { phase, loaded, total, message } }) }

function dispose() {
  try { engine?.postMessage('quit') } catch { /* best effort */ }
  engine?.terminate()
  engine = null
  waiters = []
  activeSearchId = null
  queuedSearch = null
}

function fatal(error) {
  const message = error instanceof Error ? error.message : String(error)
  dispose()
  self.postMessage({ type: 'fatal', message })
}
