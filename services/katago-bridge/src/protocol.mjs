export const KATAGO_RULES = Object.freeze({
  ko: 'POSITIONAL',
  scoring: 'AREA',
  tax: 'NONE',
  suicide: false,
  hasButton: false,
  whiteHandicapBonus: '0',
  friendlyPassOk: true,
})

export const SEARCH_PROFILES = Object.freeze({
  fast: Object.freeze({ maxVisits: 200, timeoutMs: 8_000 }),
  strong: Object.freeze({ maxVisits: 800, timeoutMs: 30_000 }),
})

export function validateAnalyzeRequest(value) {
  if (!value || typeof value !== 'object') throw new ProtocolError('INVALID_REQUEST', '请求体必须是 JSON 对象。')
  const requestId = requireString(value.requestId, 'requestId', 160)
  const gameId = requireString(value.gameId, 'gameId', 80)
  if (gameId !== 'go') throw new ProtocolError('INVALID_GAME', 'KataGo 服务只接受围棋请求。')
  if (value.player !== 'black' && value.player !== 'white') {
    throw new ProtocolError('INVALID_PLAYER', 'player 必须是 black 或 white。')
  }
  if (!(value.profile in SEARCH_PROFILES)) {
    throw new ProtocolError('INVALID_PROFILE', '未知的 KataGo 搜索档位。')
  }
  if (value.boardSize !== 19 || value.komi !== 7.5) {
    throw new ProtocolError('INVALID_RULES', '服务端仅支持十九路、7.5 贴目的当前规则集。')
  }
  if (JSON.stringify(value.rules) !== JSON.stringify(KATAGO_RULES)) {
    throw new ProtocolError('INVALID_RULES', '客户端规则与服务端位置超级劫规则不一致。')
  }
  if (!Array.isArray(value.moves) || value.moves.length > 1_000) {
    throw new ProtocolError('INVALID_MOVES', 'moves 必须是不超过 1000 手的棋谱。')
  }
  const moves = value.moves.map((move, index) => validateMoveTuple(move, index))
  return {
    requestId,
    gameId,
    player: value.player,
    profile: value.profile,
    boardSize: 19,
    komi: 7.5,
    rules: KATAGO_RULES,
    moves,
  }
}

export function buildKataGoQuery(request) {
  const profile = SEARCH_PROFILES[request.profile]
  return {
    id: request.requestId,
    moves: request.moves,
    initialPlayer: request.moves.length === 0 ? (request.player === 'black' ? 'B' : 'W') : undefined,
    rules: KATAGO_RULES,
    komi: 7.5,
    boardXSize: 19,
    boardYSize: 19,
    maxVisits: profile.maxVisits,
    analysisPVLen: 12,
    reportDuringSearchEvery: 0.5,
  }
}

export function normalizeAnalysisResult(raw, metadata) {
  if (!raw || typeof raw !== 'object') throw new ProtocolError('INVALID_ENGINE_RESULT', 'KataGo 返回值不是对象。')
  if (raw.noResults) throw new ProtocolError('NO_ENGINE_RESULT', 'KataGo 搜索结束时没有产生候选着。')
  const root = raw.rootInfo
  if (!root || typeof root !== 'object' || !Number.isFinite(root.winrate)) {
    throw new ProtocolError('INVALID_ENGINE_RESULT', 'KataGo 结果缺少有效 rootInfo。')
  }
  const candidates = Array.isArray(raw.moveInfos)
    ? raw.moveInfos
        .filter((candidate) => candidate && typeof candidate.move === 'string' && Number.isFinite(candidate.winrate))
        .sort((left, right) => numberOr(left.order, 999) - numberOr(right.order, 999))
        .slice(0, 5)
        .map((candidate, order) => ({
          move: candidate.move,
          order: numberOr(candidate.order, order),
          visits: Math.max(0, Math.trunc(numberOr(candidate.visits, 0))),
          prior: Number.isFinite(candidate.prior) ? candidate.prior : null,
          winrate: clamp(candidate.winrate, 0, 1),
          scoreLead: Number.isFinite(candidate.scoreLead) ? candidate.scoreLead : null,
          pv: Array.isArray(candidate.pv) ? candidate.pv.filter((move) => typeof move === 'string').slice(0, 12) : [],
        }))
    : []
  if (candidates.length === 0) throw new ProtocolError('NO_CANDIDATES', 'KataGo 没有返回候选着。')

  return {
    type: 'analysis',
    stage: raw.isDuringSearch ? 'partial' : 'final',
    requestId: metadata.requestId,
    engineVersion: metadata.engineVersion,
    modelName: metadata.modelName,
    profile: metadata.profile,
    elapsedMs: Math.max(0, Date.now() - metadata.startedAt),
    truncated: Boolean(metadata.truncated),
    root: {
      winrate: clamp(root.winrate, 0, 1),
      scoreLead: Number.isFinite(root.scoreLead) ? root.scoreLead : null,
      visits: Math.max(0, Math.trunc(numberOr(root.visits, 0))),
    },
    candidates,
  }
}

export class ProtocolError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
    this.status = status
  }
}

function validateMoveTuple(move, index) {
  if (!Array.isArray(move) || move.length !== 2 || !['B', 'W'].includes(move[0])) {
    throw new ProtocolError('INVALID_MOVES', `第 ${index + 1} 手格式无效。`)
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

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
