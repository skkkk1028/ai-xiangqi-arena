/* global Stockfish */
'use strict'

let config = null
let network = ''
let networkSha256 = ''
let networkParts = []

let engine = null
let outputWaiters = []
let activeSearchId = null
let queuedSearch = null
let assetBase = ''
let currentMultiPv = 3
let activeSearchTimer = null
let pendingNewGame = false
let waitingNewGameReady = false
let newGameReadyTimer = null

let searchGraceMs = 5_000
let stopResponseGraceMs = 3_000
let newGameReadyTimeoutMs = 30_000

self.registerEngineAdapter('fairy-stockfish', () => ({
  init: initialize,
  sendCommand(command) {
    if (!engine) throw new Error('专业引擎尚未就绪。')
    send(command)
  },
  setPosition(moves) {
    if (!engine) throw new Error('专业引擎尚未就绪。')
    send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`)
  },
  search(message) {
      if (!engine) throw new Error('专业引擎尚未就绪。')
      if (activeSearchId !== null || waitingNewGameReady) {
        queuedSearch = message
        if (activeSearchId !== null) stopActiveSearch('切换搜索后引擎未响应 stop。')
      } else {
        startSearch(message)
      }
  },
  stop() {
      queuedSearch = null
      if (engine && activeSearchId !== null) stopActiveSearch('引擎未能停止搜索。')
  },
  newGame() {
      if (engine) {
        queuedSearch = null
        pendingNewGame = true
        if (activeSearchId !== null) stopActiveSearch('新对局前引擎未能停止搜索。')
        else finishNewGame()
      }
  },
  dispose,
}))

async function initialize(message) {
  if (engine) return
  config = message.config
  currentMultiPv = Number(config.options.MultiPV) || 3
  network = config.nnuePath
  networkSha256 = config.nnueSha256
  networkParts = Array.isArray(config.nnueParts) ? config.nnueParts : []
  searchGraceMs = config.timeControl.searchGraceMs
  stopResponseGraceMs = config.timeControl.stopGraceMs
  newGameReadyTimeoutMs = config.timeControl.newGameReadyTimeoutMs
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
  importScripts(`${assetBase}${config.loaderPath}`)
  engine = await Stockfish({
    locateFile: (path) => `${assetBase}${path.endsWith('.wasm') ? config.wasmPath : path}`,
    mainScriptUrlOrBlob: `${assetBase}${config.loaderPath}`,
  })
  engine.addMessageListener(handleEngineLine)

  const bytes = networkParts.length
    ? await downloadNetworkParts(networkParts)
    : await downloadNetwork(`${assetBase}${network}`)
  progress('verifying', bytes.byteLength, bytes.byteLength, '校验 NNUE 参数 SHA-256')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (hash !== networkSha256) {
    throw new Error(`NNUE 参数校验失败（实际 ${hash.slice(0, 12)}…）。`)
  }
  engine.FS.writeFile(`/${network}`, new Uint8Array(bytes))

  progress('initializing', 1, 4, config.protocol === 'UCI' ? '建立 UCI 会话' : '建立 UCCI 会话')
  send(config.protocol === 'UCI' ? 'uci' : 'ucci')
  await waitFor((line) => line === (config.protocol === 'UCI' ? 'uciok' : 'ucciok'), 15_000, '等待协议确认超时')

  const options = [
    // Legacy UCCI spellings remain documented for the existing Xiangqi session:
    // setoption Skill_Level ${config.options.Skill_Level}
    // setoption Use_NNUE ${config.options.Use_NNUE}
    // setoption UCI_LimitStrength ${config.options.UCI_LimitStrength}
    // setoption Threads ${config.threads}
    // setoption hashsize ${config.hash}
    optionCommand('Threads', config.threads),
    optionCommand(config.protocol === 'UCI' ? 'Hash' : 'hashsize', config.hash),
    optionCommand('Ponder', config.options.Ponder),
    optionCommand('MultiPV', config.options.MultiPV),
    optionCommand(config.protocol === 'UCI' ? 'Skill Level' : 'Skill_Level', config.options.Skill_Level),
    optionCommand('UCI_LimitStrength', config.options.UCI_LimitStrength),
    optionCommand('UCI_ShowWDL', config.options.UCI_ShowWDL),
    optionCommand(config.protocol === 'UCI' ? 'Use NNUE' : 'Use_NNUE', config.options.Use_NNUE),
    ...(config.variant ? [optionCommand('UCI_Variant', config.variant)] : []),
    optionCommand('EvalFile', `/${network}`),
    optionCommand('usemillisec', config.options.usemillisec),
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
      id: config.id,
      engineType: config.engineType,
      protocol: config.protocol,
      name: `${config.name} · ${config.protocol}`,
      version: config.version,
      commit: config.commit,
      network,
      networkSha256,
      threads: config.threads,
      hashMb: config.hash,
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

async function downloadNetworkParts(parts) {
  const buffers = []
  let loaded = 0
  for (const [index, part] of parts.entries()) {
    const buffer = await downloadNetwork(`${assetBase}${part}`)
    buffers.push(new Uint8Array(buffer))
    loaded += buffer.byteLength
    progress('downloading', loaded, 0, `下载 NNUE 分片 ${index + 1}/${parts.length}`)
  }
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const buffer of buffers) {
    merged.set(buffer, offset)
    offset += buffer.byteLength
  }
  return merged.buffer
}

function progress(phase, loaded, total, message) {
  self.postMessage({ type: 'progress', progress: { phase, loaded, total, message } })
}

function send(command) {
  engine.postMessage(command)
}

function optionCommand(name, value) {
  return config?.protocol === 'UCI'
    ? `setoption name ${name} value ${value}`
    : `setoption ${name} ${value}`
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
  if (waitingNewGameReady && line === 'readyok') {
    clearNewGameReadyTimer()
    waitingNewGameReady = false
    if (queuedSearch && activeSearchId === null) {
      const next = queuedSearch
      queuedSearch = null
      startSearch(next)
    }
    return
  }
  if (activeSearchId !== null) {
    const completedSearchId = activeSearchId
    self.postMessage({ type: 'line', line, searchId: completedSearchId })
    if (/^bestmove|^nobestmove/.test(line)) {
      clearActiveSearchTimer()
      activeSearchId = null
      if (pendingNewGame) finishNewGame()
      if (queuedSearch && !waitingNewGameReady) {
        const next = queuedSearch
        queuedSearch = null
        startSearch(next)
      }
    }
  }
}

function startSearch(message) {
  activeSearchId = message.searchId
  self.postMessage({ type: 'search-started', searchId: message.searchId })
  const requestedMultiPv = Math.max(1, Math.min(4, Math.floor(message.multiPv || 3)))
  if (requestedMultiPv !== currentMultiPv) {
    // Legacy UCCI equivalent: send(`setoption MultiPV ${requestedMultiPv}`)
    send(optionCommand('MultiPV', requestedMultiPv))
    currentMultiPv = requestedMultiPv
  }
  send(`position startpos${message.moves.length ? ` moves ${message.moves.join(' ')}` : ''}`)
  const depthLimit = Number(message.maxDepth)
  const nodeLimit = Number(message.maxNodes)
  const goCommand = nodeLimit > 0
    ? `go nodes ${Math.floor(nodeLimit)}`
    : `go movetime ${message.movetimeMs}${depthLimit > 0 ? ` depth ${Math.floor(depthLimit)}` : ''}`
  send(goCommand)
  clearActiveSearchTimer()
  const searchId = activeSearchId
  activeSearchTimer = setTimeout(() => {
    if (activeSearchId !== searchId) return
    send('stop')
    armStopFailure(searchId, '引擎搜索超时且未响应 stop。')
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

function clearActiveSearchTimer() {
  if (activeSearchTimer !== null) clearTimeout(activeSearchTimer)
  activeSearchTimer = null
}

function finishNewGame() {
  pendingNewGame = false
  waitingNewGameReady = true
  clearNewGameReadyTimer()
  send(config?.protocol === 'UCI' ? 'ucinewgame' : 'uccinewgame')
  send('isready')
  newGameReadyTimer = setTimeout(() => {
    if (waitingNewGameReady) fatal(new Error('新对局等待 readyok 超时。'))
  }, newGameReadyTimeoutMs)
}

function clearNewGameReadyTimer() {
  if (newGameReadyTimer !== null) clearTimeout(newGameReadyTimer)
  newGameReadyTimer = null
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
  clearActiveSearchTimer()
  clearNewGameReadyTimer()
  activeSearchId = null
  queuedSearch = null
  pendingNewGame = false
  waitingNewGameReady = false
  engine = null
  self.postMessage({ type: 'fatal', message })
}

function dispose() {
  try {
    engine?.terminate?.()
  } catch {
    // The Worker is terminating; cleanup is best effort.
  }
  clearActiveSearchTimer()
  clearNewGameReadyTimer()
  outputWaiters = []
  activeSearchId = null
  queuedSearch = null
  pendingNewGame = false
  waitingNewGameReady = false
  engine = null
}
