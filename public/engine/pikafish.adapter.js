'use strict'

let config = null
let engine = null
let assetBase = ''
let outputWaiters = []
let activeSearchId = null
let queuedSearch = null
let activeSearchTimer = null
let currentMultiPv = 3
let pendingNewGame = false
let waitingNewGameReady = false
let newGameReadyTimer = null
let searchGraceMs = 5_000
let stopResponseGraceMs = 3_000
let newGameReadyTimeoutMs = 30_000
const recentLines = []

const observers = new Set()

self.registerEngineAdapter('pikafish', () => ({
  init: initialize,
  sendCommand(command) {
    ensureEngine()
    send(command)
  },
  setPosition(moves) {
    ensureEngine()
    send(positionCommand(moves))
  },
  search(message) {
    ensureEngine()
    if (activeSearchId !== null || waitingNewGameReady) {
      queuedSearch = message
      if (activeSearchId !== null) stopActiveSearch('切换搜索后 Pikafish 未响应 stop。')
    } else {
      startSearch(message)
    }
  },
  stop() {
    queuedSearch = null
    if (engine && activeSearchId !== null) stopActiveSearch('Pikafish 未能停止搜索。')
  },
  newGame() {
    if (!engine) return
    queuedSearch = null
    pendingNewGame = true
    if (activeSearchId !== null) stopActiveSearch('新对局前 Pikafish 未能停止搜索。')
    else finishNewGame()
  },
  dispose,
}))

async function initialize(message) {
  if (engine) return
  config = message.config
  assetBase = message.assetBase
  currentMultiPv = Number(config.options.MultiPV) || 3
  searchGraceMs = config.timeControl.searchGraceMs
  stopResponseGraceMs = config.timeControl.stopGraceMs
  newGameReadyTimeoutMs = config.timeControl.newGameReadyTimeoutMs

  progress('checking', 0, 1, '检查 WebAssembly、线程与跨源隔离')
  if (
    typeof WebAssembly !== 'object' ||
    typeof SharedArrayBuffer !== 'function' ||
    self.crossOriginIsolated !== true
  ) {
    throw new Error('当前浏览器环境不支持多线程 WebAssembly Pikafish。')
  }

  progress('loading', 0, 1, '加载 Pikafish WebAssembly')
  importScripts(`${assetBase}${config.loaderPath}`)
  const moduleFactory = self[config.moduleGlobal || 'Pikafish']
  if (typeof moduleFactory !== 'function') throw new Error('Pikafish 加载器未注册。')

  const networkUrls = (config.nnueParts?.length ? config.nnueParts : [config.nnuePath])
    .map((path) => `${assetBase}${path}`)
  const bytes = await downloadNetwork(networkUrls)
  progress('verifying', bytes.byteLength, bytes.byteLength, '校验 Pikafish NNUE 参数 SHA-256')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  if (hash !== config.nnueSha256) {
    throw new Error(`Pikafish NNUE 参数校验失败（实际 ${hash.slice(0, 12)}…）。`)
  }

  engine = await moduleFactory({
    locateFile: (path) => `${assetBase}${path.endsWith('.wasm') ? config.wasmPath : path}`,
    mainScriptUrlOrBlob: `${assetBase}${config.loaderPath}`,
    print: handleEngineLine,
    printErr: handleEngineLine,
  })
  engine.FS.writeFile(`/${config.nnuePath}`, new Uint8Array(bytes))
  engine.ccall('pikafish_init', null, [], [])

  progress('initializing', 1, 4, '建立 UCI 会话')
  const uciOk = waitFor((line) => line === 'uciok', 15_000, '等待 uciok 超时')
  send('uci')
  await uciOk

  const options = [
    ['Threads', config.threads],
    ['Hash', config.hash],
    ['Ponder', config.options.Ponder],
    ['MultiPV', config.options.MultiPV],
    ['UCI_ShowWDL', config.options.UCI_ShowWDL],
    ['EvalFile', `/${config.nnuePath}`],
  ]
  for (const [name, value] of options) send(`setoption name ${name} value ${value}`)
  progress('initializing', 2, 4, '应用满强度 Pikafish NNUE 配置')
  const readyOk = waitFor((line) => line === 'readyok', 30_000, '等待 readyok 超时')
  send('isready')
  await readyOk

  progress('initializing', 3, 4, '用测试局面确认 Pikafish NNUE 已启用')
  const verification = []
  const unsubscribe = observe((line) => verification.push(line))
  const selfCheck = waitFor(
    (line) => /^bestmove|^nobestmove/.test(line),
    30_000,
    'Pikafish NNUE 自检搜索超时',
  )
  send('position startpos')
  send('go depth 1')
  await selfCheck
  unsubscribe()
  if (!/NNUE evaluation using/i.test(verification.join('\n'))) {
    throw new Error('未检测到 Pikafish NNUE 启用确认，已阻止开局。')
  }

  progress('ready', 1, 1, `${config.name} 已就绪`)
  self.postMessage({
    type: 'ready',
    profile: {
      id: config.id,
      engineType: config.engineType,
      protocol: config.protocol,
      name: config.name,
      version: config.version,
      commit: config.commit,
      network: config.nnuePath,
      networkSha256: config.nnueSha256,
      threads: config.threads,
      hashMb: config.hash,
    },
  })
}

function ensureEngine() {
  if (!engine) throw new Error('Pikafish 尚未就绪。')
}

function send(command) {
  try {
    engine.ccall('pikafish_command', null, ['string'], [command])
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === 'object'
          ? JSON.stringify(error)
          : String(error)
    throw new Error(
      `Pikafish 执行命令失败：${command}；${detail || '未知异常'}；最近输出：${recentLines.join(' | ')}`,
    )
  }
}

function positionCommand(moves) {
  return `position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`
}

function handleEngineLine(rawLine) {
  const line = String(rawLine).trim()
  if (!line) return
  recentLines.push(line)
  if (recentLines.length > 12) recentLines.shift()
  observers.forEach((listener) => listener(line))
  const waiters = outputWaiters
  outputWaiters = []
  for (const waiter of waiters) {
    if (waiter.predicate(line)) waiter.resolve(line)
    else outputWaiters.push(waiter)
  }
  if (waitingNewGameReady && line === 'readyok') {
    clearNewGameReadyTimer()
    waitingNewGameReady = false
    startQueuedSearch()
    return
  }
  if (activeSearchId === null) return
  const completedSearchId = activeSearchId
  self.postMessage({ type: 'line', line, searchId: completedSearchId })
  if (/^bestmove|^nobestmove/.test(line)) {
    clearActiveSearchTimer()
    activeSearchId = null
    if (pendingNewGame) finishNewGame()
    if (!waitingNewGameReady) startQueuedSearch()
  }
}

function startQueuedSearch() {
  if (!queuedSearch || activeSearchId !== null || waitingNewGameReady) return
  const next = queuedSearch
  queuedSearch = null
  startSearch(next)
}

function startSearch(message) {
  activeSearchId = message.searchId
  self.postMessage({ type: 'search-started', searchId: message.searchId })
  const requestedMultiPv = Math.max(2, Math.min(4, Math.floor(message.multiPv || 3)))
  if (requestedMultiPv !== currentMultiPv) {
    send(`setoption name MultiPV value ${requestedMultiPv}`)
    currentMultiPv = requestedMultiPv
  }
  send(positionCommand(message.moves))
  const depthLimit = Number(message.maxDepth)
  send(`go movetime ${message.movetimeMs}${depthLimit > 0 ? ` depth ${Math.floor(depthLimit)}` : ''}`)
  clearActiveSearchTimer()
  const searchId = activeSearchId
  activeSearchTimer = setTimeout(() => {
    if (activeSearchId !== searchId) return
    send('stop')
    armStopFailure(searchId, 'Pikafish 搜索超时且未响应 stop。')
  }, Math.max(50, Number(message.movetimeMs) || 0) + searchGraceMs)
}

function stopActiveSearch(timeoutMessage) {
  if (activeSearchId === null) return
  const searchId = activeSearchId
  send('stop')
  armStopFailure(searchId, timeoutMessage)
}

function armStopFailure(searchId, timeoutMessage) {
  clearActiveSearchTimer()
  activeSearchTimer = setTimeout(() => {
    if (activeSearchId === searchId) fatal(new Error(timeoutMessage))
  }, stopResponseGraceMs)
}

function finishNewGame() {
  pendingNewGame = false
  waitingNewGameReady = true
  clearNewGameReadyTimer()
  send('ucinewgame')
  send('isready')
  newGameReadyTimer = setTimeout(() => {
    if (waitingNewGameReady) fatal(new Error('Pikafish 新对局等待 readyok 超时。'))
  }, newGameReadyTimeoutMs)
}

async function downloadNetwork(urls) {
  const responses = await Promise.all(urls.map((url) => fetch(url, { cache: 'force-cache' })))
  const failed = responses.find((response) => !response.ok)
  if (failed) throw new Error(`Pikafish NNUE 参数下载失败（HTTP ${failed.status}）。`)
  const total = responses.reduce(
    (sum, response) => sum + (Number(response.headers.get('content-length')) || 0),
    0,
  )
  const chunks = []
  let loaded = 0
  for (const response of responses) {
    if (!response.body) {
      const value = new Uint8Array(await response.arrayBuffer())
      chunks.push(value)
      loaded += value.byteLength
      progress('downloading', loaded, total || loaded, '下载 Pikafish NNUE 参数分片')
      continue
    }
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      progress('downloading', loaded, total, '下载 Pikafish NNUE 参数分片')
    }
  }
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

function observe(listener) {
  observers.add(listener)
  return () => observers.delete(listener)
}

function waitFor(predicate, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject }
    outputWaiters.push(waiter)
    const timeout = setTimeout(() => {
      outputWaiters = outputWaiters.filter((entry) => entry !== waiter)
      const detail = recentLines.length ? `；最近输出：${recentLines.join(' | ')}` : '；引擎没有输出'
      reject(new Error(`${timeoutMessage}${detail}`))
    }, timeoutMs)
    const originalResolve = waiter.resolve
    waiter.resolve = (line) => {
      clearTimeout(timeout)
      originalResolve(line)
    }
  })
}

function progress(phase, loaded, total, message) {
  self.postMessage({ type: 'progress', progress: { phase, loaded, total, message } })
}

function clearActiveSearchTimer() {
  if (activeSearchTimer !== null) clearTimeout(activeSearchTimer)
  activeSearchTimer = null
}

function clearNewGameReadyTimer() {
  if (newGameReadyTimer !== null) clearTimeout(newGameReadyTimer)
  newGameReadyTimer = null
}

function fatal(error) {
  clearActiveSearchTimer()
  clearNewGameReadyTimer()
  activeSearchId = null
  queuedSearch = null
  pendingNewGame = false
  waitingNewGameReady = false
  engine = null
  self.postMessage({ type: 'fatal', message: error instanceof Error ? error.message : String(error) })
}

function dispose() {
  clearActiveSearchTimer()
  clearNewGameReadyTimer()
  outputWaiters = []
  observers.clear()
  activeSearchId = null
  queuedSearch = null
  pendingNewGame = false
  waitingNewGameReady = false
  engine = null
}
