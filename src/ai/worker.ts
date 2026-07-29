/// <reference lib="webworker" />

import type { SearchRequest, SearchResponse } from '../game/types'
import { searchBestMove } from './search'

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const request = event.data
  if (request.type !== 'search') return
  const result = searchBestMove(
    request.board,
    request.color,
    request.timeBudgetMs,
    request.seed,
    request.maxDepth,
  )
  const response: SearchResponse = {
    type: 'result',
    requestId: request.requestId,
    ...result,
  }
  self.postMessage(response)
}

export {}
