import { FairyStockfishAdapter } from './fairy-stockfish-adapter'
import { PikafishAdapter } from './pikafish-adapter'
import {
  FAIRY_STOCKFISH_CONFIG,
  FAIRY_STOCKFISH_ENGINE_ID,
  CHESS_FAIRY_STOCKFISH_CONFIG,
  CHESS_STOCKFISH_18_CONFIG,
  CHESS_STOCKFISH_18_SINGLE_CONFIG,
  CHESS_STOCKFISH_18_NATIVE_CONFIG,
  CHESS_STOCKFISH_18_ARENA_CONFIG,
  CHESS_OBSIDIAN_16_CONFIG,
  PIKAFISH_2025_CONFIG,
  PIKAFISH_CONFIG,
} from './config'
import { EngineRegistry } from './registry'
import { ChessNativeStockfishAdapter } from '../games/chess/native-adapter'
import { ChessArenaNativeAdapter } from '../games/chess/arena-native-adapter'

export const engineRegistry = new EngineRegistry()

engineRegistry.registerEngine(FAIRY_STOCKFISH_CONFIG, (config, context) =>
  new FairyStockfishAdapter(config, context),
)
engineRegistry.registerEngine(CHESS_FAIRY_STOCKFISH_CONFIG, (config, context) =>
  new FairyStockfishAdapter(config, context),
)
engineRegistry.registerEngine(CHESS_STOCKFISH_18_CONFIG, (config, context) =>
  new FairyStockfishAdapter(config, context),
)
engineRegistry.registerEngine(CHESS_STOCKFISH_18_SINGLE_CONFIG, (config, context) =>
  new FairyStockfishAdapter(config, context),
)
engineRegistry.registerEngine(CHESS_STOCKFISH_18_NATIVE_CONFIG, (config, context) =>
  new ChessNativeStockfishAdapter(config, context),
)
engineRegistry.registerEngine(CHESS_STOCKFISH_18_ARENA_CONFIG, (config, context) =>
  new ChessArenaNativeAdapter(config, context, 'stockfish-18'),
)
engineRegistry.registerEngine(CHESS_OBSIDIAN_16_CONFIG, (config, context) =>
  new ChessArenaNativeAdapter(config, context, 'obsidian-16'),
)
engineRegistry.registerEngine(PIKAFISH_CONFIG, (config, context) =>
  new PikafishAdapter(config, context),
)
engineRegistry.registerEngine(PIKAFISH_2025_CONFIG, (config, context) =>
  new PikafishAdapter(config, context),
)

export const DEFAULT_ENGINE_ID = FAIRY_STOCKFISH_ENGINE_ID
