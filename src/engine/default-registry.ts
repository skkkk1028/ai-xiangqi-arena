import { FairyStockfishAdapter } from './fairy-stockfish-adapter'
import { PikafishAdapter } from './pikafish-adapter'
import {
  FAIRY_STOCKFISH_CONFIG,
  FAIRY_STOCKFISH_ENGINE_ID,
  PIKAFISH_2025_CONFIG,
  PIKAFISH_CONFIG,
} from './config'
import { EngineRegistry } from './registry'

export const engineRegistry = new EngineRegistry()

engineRegistry.registerEngine(FAIRY_STOCKFISH_CONFIG, (config, context) =>
  new FairyStockfishAdapter(config, context),
)
engineRegistry.registerEngine(PIKAFISH_CONFIG, (config, context) =>
  new PikafishAdapter(config, context),
)
engineRegistry.registerEngine(PIKAFISH_2025_CONFIG, (config, context) =>
  new PikafishAdapter(config, context),
)

export const DEFAULT_ENGINE_ID = FAIRY_STOCKFISH_ENGINE_ID
