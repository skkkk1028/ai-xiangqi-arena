import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAnalyzeRequest } from '../src/protocol.mjs'

test('accepts a valid alternating 19x19 position', () => {
  const request = validateAnalyzeRequest({
    requestId: 'sy-1', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5,
    moves: [['B', 'D16'], ['W', 'Q4']],
  })
  assert.equal(request.moves.length, 2)
})

test('rejects invalid coordinates, colors, and side to move', () => {
  assert.throws(() => validateAnalyzeRequest({
    requestId: 'sy-2', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5,
    moves: [['W', 'I9']],
  }), /颜色或格式|坐标/)
  assert.throws(() => validateAnalyzeRequest({
    requestId: 'sy-3', gameId: 'go', player: 'black', boardSize: 19, komi: 7.5,
    moves: [['B', 'D16']],
  }), /行棋方/)
})
