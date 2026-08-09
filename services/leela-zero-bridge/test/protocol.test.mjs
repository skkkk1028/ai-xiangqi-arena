import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAnalyzeRequest } from '../src/protocol.mjs'

test('accepts a valid alternating 19x19 position', () => {
  const request = validateAnalyzeRequest({
    requestId: 'lz-1', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5,
    moves: [['B', 'D16'], ['W', 'Q4']],
  })
  assert.equal(request.moves.length, 2)
})

test('rejects mismatched colors and player', () => {
  assert.throws(() => validateAnalyzeRequest({
    requestId: 'lz-2', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5,
    moves: [['W', 'D16']],
  }), /颜色或格式/)
})
