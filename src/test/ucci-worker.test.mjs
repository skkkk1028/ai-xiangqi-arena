import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('生产 UCCI Worker 搜索状态机', () => {
  afterEach(() => vi.useRealTimers())

  it('满强度公平配置只有MultiPV会在运行时动态变化', () => {
    const source = loadWorkerSource()
    const configSource = readFileSync(resolve(process.cwd(), 'src/engine/config.ts'), 'utf8')
    expect(configSource).toContain('Skill_Level: 20')
    expect(configSource).toContain('Use_NNUE: true')
    expect(configSource).toContain('UCI_LimitStrength: false')
    expect(source.match(/setoption Skill_Level /g)).toHaveLength(1)
    expect(source.match(/setoption Use_NNUE /g)).toHaveLength(1)
    expect(source.match(/setoption UCI_LimitStrength /g)).toHaveLength(1)
    expect(source.match(/setoption Threads /g)).toHaveLength(1)
    expect(source.match(/setoption hashsize /g)).toHaveLength(1)

    const runtimeSearch = source.slice(source.indexOf('function startSearch'))
    expect(runtimeSearch).toContain('send(`setoption MultiPV ${requestedMultiPv}`)')
    expect(runtimeSearch).toContain('go movetime ${message.movetimeMs}')
    expect(runtimeSearch).toContain('message.maxDepth')
    expect(runtimeSearch).not.toContain('Skill_Level')
    expect(runtimeSearch).not.toContain('Use_NNUE')
    expect(runtimeSearch).not.toContain('UCI_LimitStrength')
    expect(runtimeSearch).not.toContain('setoption Threads')
    expect(runtimeSearch).not.toContain('setoption hashsize')
  })

  it('通用 Worker 仅装载已注册适配器，不直接依赖 Fairy-Stockfish', () => {
    const host = readFileSync(resolve(process.cwd(), 'public/engine/ucci.worker.js'), 'utf8')
    expect(host).toContain('importScripts(message.adapterUrl)')
    expect(host).toContain('adapterFactories.get(message.config.engineType)')
    expect(host).not.toMatch(/fairy|stockfish|nnue/i)
  })

  it('Pikafish 适配器使用标准 UCI 且不通过 Skill 降低棋力', () => {
    const source = readFileSync(resolve(process.cwd(), 'public/engine/pikafish.adapter.js'), 'utf8')
    expect(source).toContain("self.registerEngineAdapter('pikafish'")
    expect(source).toContain("send('uci')")
    expect(source).toContain('setoption name ${name} value ${value}')
    expect(source).toContain("send('ucinewgame')")
    expect(source).toContain("send('isready')")
    expect(source).toContain("self[config.moduleGlobal || 'Pikafish']")
    expect(source).not.toMatch(/skill|limitstrength/i)
    expect(source.indexOf('const uciOk = waitFor')).toBeLessThan(source.indexOf("send('uci')"))
    expect(source.indexOf('const readyOk = waitFor')).toBeLessThan(source.indexOf("send('isready')"))
  })

  it('通用 Worker 按注册类型转发完整引擎生命周期', async () => {
    const calls = []
    const outbound = []
    const runtime = {
      init: async (message) => calls.push(['init', message.config.engineType]),
      sendCommand: (command) => calls.push(['command', command]),
      setPosition: (moves) => calls.push(['position', moves]),
      search: (message) => calls.push(['search', message.searchId]),
      stop: () => calls.push(['stop']),
      newGame: () => calls.push(['newgame']),
      dispose: () => calls.push(['dispose']),
    }
    const workerSelf = { postMessage: (message) => outbound.push(message) }
    const context = createContext({
      self: workerSelf,
      Map,
      Error,
      String,
      importScripts: () => workerSelf.registerEngineAdapter('fake', () => runtime),
    })
    const host = readFileSync(resolve(process.cwd(), 'public/engine/ucci.worker.js'), 'utf8')
    runInContext(host, context)

    await workerSelf.onmessage({
      data: { type: 'init', adapterUrl: '/fake.js', config: { engineType: 'fake' } },
    })
    await workerSelf.onmessage({ data: { type: 'command', command: 'isready' } })
    await workerSelf.onmessage({ data: { type: 'set-position', moves: ['a0a1'] } })
    await workerSelf.onmessage({ data: searchMessage(7, 3) })
    await workerSelf.onmessage({ data: { type: 'stop' } })
    await workerSelf.onmessage({ data: { type: 'newgame' } })
    await workerSelf.onmessage({ data: { type: 'dispose' } })

    expect(calls).toEqual([
      ['init', 'fake'],
      ['command', 'isready'],
      ['position', ['a0a1']],
      ['search', 7],
      ['stop'],
      ['newgame'],
      ['dispose'],
    ])
    expect(outbound).toEqual([])
  })

  it('连续执行4→2→3，并保持每次搜索的 searchId 隔离', () => {
    const harness = createHarness()
    for (const [searchId, multiPv] of [
      [1, 4],
      [2, 2],
      [3, 3],
    ]) {
      harness.api.startSearch(searchMessage(searchId, multiPv))
      harness.api.handleEngineLine('info depth 10 multipv 1 score 0 wdl 1 998 1 pv a0a1')
      harness.api.handleEngineLine('bestmove a0a1')
    }

    expect(harness.commands.filter((command) => command.startsWith('setoption MultiPV'))).toEqual([
      'setoption MultiPV 4',
      'setoption MultiPV 2',
      'setoption MultiPV 3',
    ])
    expect(
      harness.outbound
        .filter((message) => message.type === 'line' && String(message.line).startsWith('bestmove'))
        .map((message) => message.searchId),
    ).toEqual([1, 2, 3])
    expect(
      harness.outbound
        .filter((message) => message.type === 'search-started')
        .map((message) => message.searchId),
    ).toEqual([1, 2, 3])
  })

  it('排队搜索和新对局都等待旧搜索停止，且新局等待 readyok', async () => {
    const harness = createHarness()
    harness.api.startSearch(searchMessage(10, 4))
    await harness.dispatch(searchMessage(11, 2))
    expect(harness.commands.at(-1)).toBe('stop')
    expect(harness.api.getState()).toMatchObject({ activeSearchId: 10, queuedSearchId: 11 })

    harness.api.handleEngineLine('bestmove a0a1')
    expect(harness.api.getState()).toMatchObject({ activeSearchId: 11, queuedSearchId: null })
    expect(harness.commands).toContain('setoption MultiPV 2')

    await harness.dispatch({ type: 'newgame' })
    expect(harness.api.getState().pendingNewGame).toBe(true)
    harness.api.handleEngineLine('bestmove b0c2')
    expect(harness.commands.slice(-2)).toEqual(['uccinewgame', 'isready'])
    expect(harness.api.getState()).toMatchObject({
      activeSearchId: null,
      queuedSearchId: null,
      pendingNewGame: false,
      waitingNewGameReady: true,
    })

    await harness.dispatch(searchMessage(12, 3))
    expect(harness.api.getState()).toMatchObject({
      activeSearchId: null,
      queuedSearchId: 12,
      waitingNewGameReady: true,
    })
    harness.api.handleEngineLine('readyok')
    expect(harness.api.getState()).toMatchObject({
      activeSearchId: 12,
      queuedSearchId: null,
      waitingNewGameReady: false,
    })
  })

  it('WASM既超时又不响应stop时触发fatal，而不是永久阻塞', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.api.startSearch(searchMessage(20, 2, 50))

    await vi.advanceTimersByTimeAsync(5_050)
    expect(harness.commands.at(-1)).toBe('stop')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(harness.outbound.at(-1)).toMatchObject({
      type: 'fatal',
      message: '引擎搜索超时且未响应 stop。',
    })
    expect(harness.api.getState().activeSearchId).toBeNull()
  })

  it('新对局 readyok 丢失时触发 fatal，而不是永久阻塞排队搜索', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.dispatch({ type: 'newgame' })
    await harness.dispatch(searchMessage(30, 3))
    expect(harness.api.getState()).toMatchObject({
      activeSearchId: null,
      queuedSearchId: 30,
      waitingNewGameReady: true,
    })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.outbound.at(-1)).toMatchObject({
      type: 'fatal',
      message: '新对局等待 readyok 超时。',
    })
    expect(harness.api.getState()).toMatchObject({
      activeSearchId: null,
      queuedSearchId: null,
      waitingNewGameReady: false,
    })
  })
})

function createHarness() {
  const commands = []
  const outbound = []
  let adapterFactory
  const workerSelf = {
    crossOriginIsolated: true,
    postMessage: (message) => outbound.push(message),
    registerEngineAdapter: (_engineType, factory) => {
      adapterFactory = factory
    },
  }
  const context = createContext({
    self: workerSelf,
    setTimeout,
    clearTimeout,
    WebAssembly,
    SharedArrayBuffer,
    Uint8Array,
    crypto: globalThis.crypto,
    fetch: globalThis.fetch,
    importScripts: () => undefined,
    Stockfish: () => undefined,
    Error,
    String,
    Number,
    Math,
    Set,
    Promise,
  })
  const source = loadWorkerSource()
  runInContext(
    `${source}\nself.__workerTest = {\n` +
      `  setEngine(value) { engine = value },\n` +
      `  startSearch,\n` +
      `  handleEngineLine,\n` +
      `  getState() { return { activeSearchId, queuedSearchId: queuedSearch?.searchId ?? null, pendingNewGame, waitingNewGameReady } }\n` +
      `}`,
    context,
  )
  const api = workerSelf.__workerTest
  const adapter = adapterFactory()
  api.setEngine({
    postMessage: (command) => commands.push(command),
    terminate: () => undefined,
  })
  return {
    api,
    commands,
    outbound,
    dispatch: async (message) => {
      if (message.type === 'search') adapter.search(message)
      else if (message.type === 'stop') adapter.stop()
      else if (message.type === 'newgame') adapter.newGame()
      else if (message.type === 'command') adapter.sendCommand(message.command)
      else if (message.type === 'set-position') adapter.setPosition(message.moves)
    },
  }
}

function loadWorkerSource() {
  return readFileSync(resolve(process.cwd(), 'public/engine/fairy-stockfish.adapter.js'), 'utf8')
}

function searchMessage(searchId, multiPv, movetimeMs = 1_000) {
  return { type: 'search', searchId, moves: [], movetimeMs, multiPv }
}
