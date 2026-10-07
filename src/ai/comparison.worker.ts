import { searchBestMove } from './search'
import type { BoardState, Color } from '../game/types'

export interface ComparisonRequest { board: BoardState; turn: Color; depth: number; enabled: boolean }
self.onmessage = ({ data }: MessageEvent<ComparisonRequest>) => {
  try {
    const result = searchBestMove(data.board, data.turn, 15_000, 20261003, data.depth,
      { transpositionTable: data.enabled, comparison: true })
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '搜索失败。' })
  }
}
