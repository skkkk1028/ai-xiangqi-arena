export const MATCH_SETTINGS = Object.freeze({
  playouts: 20_000,
  timeoutMs: 180_000,
})

export class ProtocolError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
    this.status = status
  }
}

export function validateAnalyzeRequest(value) {
  if (!value || typeof value !== 'object') throw new ProtocolError('INVALID_REQUEST', '请求体必须是 JSON 对象。')
  const requestId = requireString(value.requestId, 'requestId', 160)
  if (value.gameId !== 'go') throw new ProtocolError('INVALID_GAME', 'Sayuri 服务只接受围棋请求。')
  if (value.player !== 'black' && value.player !== 'white') {
    throw new ProtocolError('INVALID_PLAYER', 'player 必须是 black 或 white。')
  }
  if (value.boardSize !== 19 || value.komi !== 7.5) {
    throw new ProtocolError('INVALID_RULES', '服务端仅支持十九路棋盘和 7.5 贴目。')
  }
  if (!Array.isArray(value.moves) || value.moves.length > 1_000) {
    throw new ProtocolError('INVALID_MOVES', 'moves 必须是不超过 1000 手的棋谱。')
  }
  const moves = value.moves.map(validateMoveTuple)
  const expectedPlayer = moves.length % 2 === 0 ? 'black' : 'white'
  if (value.player !== expectedPlayer) throw new ProtocolError('INVALID_PLAYER', '行棋方与棋谱手数不一致。')
  return { requestId, gameId: 'go', player: value.player, boardSize: 19, komi: 7.5, moves }
}

function validateMoveTuple(move, index) {
  const expectedColor = index % 2 === 0 ? 'B' : 'W'
  if (!Array.isArray(move) || move.length !== 2 || move[0] !== expectedColor) {
    throw new ProtocolError('INVALID_MOVES', `第 ${index + 1} 手颜色或格式无效。`)
  }
  const vertex = requireString(move[1], `moves[${index}][1]`, 8)
  if (vertex.toLowerCase() !== 'pass' && !/^[A-HJ-T](?:[1-9]|1[0-9])$/i.test(vertex)) {
    throw new ProtocolError('INVALID_MOVES', `第 ${index + 1} 手坐标无效。`)
  }
  return [move[0], vertex]
}

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ProtocolError('INVALID_REQUEST', `${field} 必须是有效字符串。`)
  }
  return value
}
