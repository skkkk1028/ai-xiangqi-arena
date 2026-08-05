'use strict'

// Protocol-neutral Worker host. Concrete engine code is loaded from the
// registered adapter path supplied by the main-thread EngineAdapter.
const adapterFactories = new Map()
let adapter = null

self.registerEngineAdapter = (engineType, factory) => {
  if (adapterFactories.has(engineType)) throw new Error(`引擎适配器重复注册：${engineType}`)
  adapterFactories.set(engineType, factory)
}

self.onmessage = async (event) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      if (adapter) return
      importScripts(message.adapterUrl)
      const factory = adapterFactories.get(message.config.engineType)
      if (!factory) throw new Error(`未注册的 Worker 引擎适配器：${message.config.engineType}`)
      adapter = factory()
      await adapter.init(message)
    } else if (!adapter) {
      throw new Error('专业引擎尚未就绪。')
    } else if (message.type === 'command') {
      adapter.sendCommand(message.command)
    } else if (message.type === 'set-position') {
      adapter.setPosition(message.moves)
    } else if (message.type === 'search') {
      adapter.search(message)
    } else if (message.type === 'stop') {
      adapter.stop()
    } else if (message.type === 'newgame') {
      adapter.newGame()
    } else if (message.type === 'dispose') {
      adapter.dispose()
      adapter = null
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: 'fatal', message: detail })
  }
}
