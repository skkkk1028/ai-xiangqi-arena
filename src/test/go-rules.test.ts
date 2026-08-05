import { describe, expect, it } from 'vitest'
import { GameController } from '../games/core'
import {
  CHINESE_GO_RULESET,
  countLiberties,
  createGoBoard,
  GO_PASS_MOVE,
  goPositionKey,
  getLegalGoMoves,
  GoGameEngine,
  tryPlayGoMove,
  type GoBoard,
  type GoGameState,
  type GoPlayer,
  type GoRuleset,
  type GoScoringStrategy,
} from '../games/go'

function place(board: GoBoard, row: number, col: number, color: GoPlayer) {
  board[row][col] = color
}

function createFixtureState(board: GoBoard, turn: GoPlayer): GoGameState {
  const key = goPositionKey(board)
  return {
    board,
    turn,
    phase: 'playing',
    history: [],
    lastMove: null,
    result: null,
    consecutivePasses: 0,
    prisoners: { black: 0, white: 0 },
    positionHistory: [key],
    positionCounts: new Map([[key, 1]]),
  }
}

function createScoringFixture(
  board: GoBoard,
  options: { turn?: GoPlayer; prisoners?: Record<GoPlayer, number> } = {},
): GoGameState {
  return {
    ...createFixtureState(board, options.turn ?? 'black'),
    phase: 'scoring',
    consecutivePasses: 2,
    prisoners: options.prisoners ?? { black: 0, white: 0 },
  }
}

function createKoFixture(): GoBoard {
  const board = createGoBoard()
  // Black can capture the white stone at (3,3) by playing (4,3).
  for (const [row, col] of [[3, 3], [5, 3], [4, 2], [4, 4]]) place(board, row, col, 'white')
  for (const [row, col] of [[2, 3], [3, 2], [3, 4]]) place(board, row, col, 'black')
  return board
}

function placeKoShape(
  board: GoBoard,
  centerRow: number,
  centerCol: number,
  capturingColor: GoPlayer,
) {
  const capturedColor = capturingColor === 'black' ? 'white' : 'black'
  place(board, centerRow, centerCol, capturedColor)
  place(board, centerRow + 2, centerCol, capturedColor)
  place(board, centerRow + 1, centerCol - 1, capturedColor)
  place(board, centerRow + 1, centerCol + 1, capturedColor)
  place(board, centerRow - 1, centerCol, capturingColor)
  place(board, centerRow, centerCol - 1, capturingColor)
  place(board, centerRow, centerCol + 1, capturingColor)
}

function createBlackSingleTerritoryBoard(): GoBoard {
  const board = createGoBoard()
  for (const [row, col] of [[1, 2], [2, 1], [2, 3], [3, 2]]) place(board, row, col, 'black')
  // Makes the external empty region neutral instead of a one-colour fixture artefact.
  place(board, 10, 10, 'white')
  return board
}

function createDeadStringBoard(): GoBoard {
  const board = createGoBoard()
  for (const col of [5, 6, 7]) place(board, 5, col, 'black')
  place(board, 12, 12, 'black')
  place(board, 10, 10, 'white')
  return board
}

describe('Go core rules', () => {
  it('initializes the locked Chinese ruleset on an empty 19×19 board', () => {
    const game = new GoGameEngine()
    const state = game.init()

    expect(CHINESE_GO_RULESET).toMatchObject({
      id: 'chinese',
      boardSize: 19,
      komi: 7.5,
      suicideForbidden: true,
      repetition: 'positional-superko',
    })
    expect(state.board).toHaveLength(19)
    expect(state.board.every((row) => row.length === 19)).toBe(true)
    expect(state.board.flat().every((stone) => stone === null)).toBe(true)
    expect(state.turn).toBe('black')
    expect(state.phase).toBe('playing')
    expect(game.getLegalMoves(state)).toHaveLength(361)
    expect(game.getState(state)).toBe(state)
    expect(game.getHistory(state)).toEqual([])
    expect(game.isGameOver(state)).toBe(false)
  })

  it('calculates liberties for a connected string', () => {
    const board = createGoBoard()
    place(board, 1, 1, 'black')
    place(board, 1, 2, 'black')
    place(board, 0, 1, 'white')
    place(board, 2, 1, 'white')

    expect(countLiberties(board, { row: 1, col: 1 })).toBe(4)
  })

  it('captures a string on its final liberty without mutating the original board', () => {
    const board = createGoBoard()
    place(board, 1, 1, 'white')
    place(board, 0, 1, 'black')
    place(board, 1, 0, 'black')
    place(board, 1, 2, 'black')

    const outcome = tryPlayGoMove(board, { row: 2, col: 1 }, 'black')

    expect(outcome?.captures).toEqual([{ row: 1, col: 1 }])
    expect(outcome?.board[1][1]).toBeNull()
    expect(outcome?.board[2][1]).toBe('black')
    expect(board[1][1]).toBe('white')
  })

  it('captures an entire connected string in one move', () => {
    const board = createGoBoard()
    place(board, 1, 1, 'white')
    place(board, 1, 2, 'white')
    for (const [row, col] of [[0, 1], [0, 2], [1, 0], [1, 3], [2, 2]]) {
      place(board, row, col, 'black')
    }

    const outcome = tryPlayGoMove(board, { row: 2, col: 1 }, 'black')

    expect(outcome?.captures).toEqual(expect.arrayContaining([{ row: 1, col: 1 }, { row: 1, col: 2 }]))
    expect(outcome?.captures).toHaveLength(2)
  })

  it('rejects suicide but permits a capture that gains liberties', () => {
    const suicideBoard = createGoBoard()
    place(suicideBoard, 0, 1, 'white')
    place(suicideBoard, 1, 0, 'white')
    place(suicideBoard, 1, 2, 'white')
    place(suicideBoard, 2, 1, 'white')

    expect(tryPlayGoMove(suicideBoard, { row: 1, col: 1 }, 'black')).toBeNull()
    expect(getLegalGoMoves(suicideBoard, 'black')).not.toContainEqual({ row: 1, col: 1 })

    const rescueBoard = createGoBoard()
    place(rescueBoard, 1, 2, 'white')
    for (const [row, col] of [[0, 1], [1, 0], [2, 1], [0, 2], [1, 3], [2, 2]]) {
      place(rescueBoard, row, col, 'black')
    }
    const rescue = tryPlayGoMove(rescueBoard, { row: 1, col: 1 }, 'black')
    expect(rescue?.board[1][1]).toBe('black')
    expect(rescue?.captures).toEqual([{ row: 1, col: 2 }])
  })

  it('rejects off-board and occupied placements', () => {
    const board = createGoBoard()
    place(board, 3, 3, 'black')

    expect(tryPlayGoMove(board, { row: -1, col: 0 }, 'white')).toBeNull()
    expect(tryPlayGoMove(board, { row: 3, col: 3 }, 'white')).toBeNull()
  })

  it('integrates turn, captures and records with GameController', async () => {
    const controller = new GameController(new GoGameEngine(), [
      { id: 'black', name: 'Black', kind: 'human' },
      { id: 'white', name: 'White', kind: 'human' },
    ])
    await controller.start()

    for (const action of [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
      { row: 1, col: 0 },
      { row: 5, col: 5 },
      { row: 1, col: 2 },
      { row: 5, col: 6 },
      { row: 2, col: 1 },
    ]) {
      controller.play(action)
    }

    const snapshot = controller.getSnapshot()
    const history = snapshot.state.history
    expect(snapshot.state.turn).toBe('white')
    expect(snapshot.state.board[1][1]).toBeNull()
    expect(history).toHaveLength(7)
    expect(history.at(-1)).toMatchObject({
      moveNumber: 7,
      color: 'black',
      notation: 'B17',
      captures: [{ row: 1, col: 1 }],
    })
    expect(controller.getLegalActions()).not.toContainEqual({ row: 1, col: 1 })
  })

  it('reports immediate ko before positional superko and permits recapture after intervening moves', () => {
    const game = new GoGameEngine()
    const initial = createFixtureState(createKoFixture(), 'black')
    const captured = game.applyMove(initial, { row: 4, col: 3 })

    expect(captured.history.at(-1)?.captures).toEqual([{ row: 3, col: 3 }])
    expect(game.getMoveRejectionReason(captured, { row: 3, col: 3 })).toBe('ko')
    expect(game.getLegalMoves(captured)).not.toContainEqual({ row: 3, col: 3 })
    expect(game.getLegalActions(captured)).not.toContainEqual({ row: 3, col: 3 })
    expect(() => game.applyMove(captured, { row: 3, col: 3 })).toThrow('劫规则')

    const afterWhiteElsewhere = game.applyMove(captured, { row: 10, col: 10 })
    const afterBlackElsewhere = game.applyMove(afterWhiteElsewhere, { row: 10, col: 11 })
    const recaptured = game.applyMove(afterBlackElsewhere, { row: 3, col: 3 })
    expect(recaptured.board[4][3]).toBeNull()
    expect(recaptured.history.at(-1)?.captures).toEqual([{ row: 4, col: 3 }])
  })

  it('rejects the final recapture in a three-ko cycle through positional superko', () => {
    const board = createGoBoard()
    placeKoShape(board, 3, 3, 'black')
    placeKoShape(board, 3, 9, 'white')
    placeKoShape(board, 3, 15, 'black')
    const game = new GoGameEngine()
    let state = createFixtureState(board, 'black')

    for (const action of [
      { row: 4, col: 3 },
      { row: 4, col: 9 },
      { row: 4, col: 15 },
      { row: 3, col: 3 },
      { row: 3, col: 9 },
    ]) {
      state = game.applyMove(state, action)
    }

    const finalRecapture = { row: 3, col: 15 }
    expect(game.getMoveRejectionReason(state, finalRecapture)).toBe('repetition')
    expect(game.getLegalActions(state)).not.toContainEqual(finalRecapture)
    expect(() => game.applyMove(state, finalRecapture)).toThrow('局面重复')
  })
})

describe('Chinese area scoring', () => {
  it('counts living stones, single-colour territory and neutral points', () => {
    const game = new GoGameEngine()
    const score = game.previewScore(createScoringFixture(createBlackSingleTerritoryBoard()))

    expect(score).toMatchObject({
      ruleset: { id: 'chinese', komi: 7.5 },
      method: 'chinese-area',
      black: { livingStones: 4, territory: 1, prisoners: 0, total: 5 },
      white: { livingStones: 1, territory: 0, prisoners: 0, total: 8.5 },
      neutralPoints: 355,
      winner: 'white',
      margin: 3.5,
    })
  })

  it('counts separate territory for both sides and leaves dame neutral', () => {
    const bothTerritories = createGoBoard()
    for (const [row, col] of [[1, 2], [2, 1], [2, 3], [3, 2]]) place(bothTerritories, row, col, 'black')
    for (const [row, col] of [[1, 6], [2, 5], [2, 7], [3, 6]]) place(bothTerritories, row, col, 'white')

    const game = new GoGameEngine()
    const score = game.previewScore(createScoringFixture(bothTerritories))
    expect(score.black).toMatchObject({ livingStones: 4, territory: 1, total: 5 })
    expect(score.white).toMatchObject({ livingStones: 4, territory: 1, total: 12.5 })
    expect(score.neutralPoints).toBe(351)

    const dame = createGoBoard()
    for (const [row, col] of [[7, 8], [9, 8]]) place(dame, row, col, 'black')
    for (const [row, col] of [[8, 7], [8, 9]]) place(dame, row, col, 'white')
    const dameScore = game.previewScore(createScoringFixture(dame))
    expect(dameScore.black.territory).toBe(0)
    expect(dameScore.white.territory).toBe(0)
    expect(dameScore.neutralPoints).toBe(357)
  })

  it('applies the fixed 7.5 komi and keeps prisoners out of Chinese area totals', () => {
    const komiBoard = createGoBoard()
    place(komiBoard, 4, 4, 'black')
    place(komiBoard, 14, 14, 'black')
    place(komiBoard, 9, 9, 'white')
    const defaultGame = new GoGameEngine()
    const defaultScore = defaultGame.previewScore(createScoringFixture(komiBoard))
    expect(defaultScore.black.total).toBe(2)
    expect(defaultScore.white.total).toBe(8.5)
    expect(defaultScore.winner).toBe('white')
    expect(defaultScore.margin).toBe(6.5)

    const zeroKomiRuleset: GoRuleset = {
      ...CHINESE_GO_RULESET,
      id: 'test-zero-komi',
      komi: 0,
    }
    const zeroKomiScore = new GoGameEngine({ ruleset: zeroKomiRuleset })
      .previewScore(createScoringFixture(komiBoard))
    expect(zeroKomiScore.winner).toBe('black')
    expect(zeroKomiScore.margin).toBe(1)

    const prisonerBoard = createGoBoard()
    place(prisonerBoard, 12, 12, 'black')
    place(prisonerBoard, 10, 10, 'white')
    const prisonerScore = defaultGame.previewScore(createScoringFixture(prisonerBoard, {
      prisoners: { black: 12, white: 7 },
    }))
    expect(prisonerScore.black).toMatchObject({ livingStones: 1, territory: 0, prisoners: 12, total: 1 })
    expect(prisonerScore.white).toMatchObject({ livingStones: 1, territory: 0, prisoners: 7, total: 8.5 })
  })

  it('expands a dead-stone representative to its entire string without double counting it', () => {
    const game = new GoGameEngine()
    const state = createScoringFixture(createDeadStringBoard())

    const singleRepresentative = game.previewScore(state, {
      deadStoneRepresentatives: [{ row: 5, col: 5 }],
    })
    const twoRepresentatives = game.previewScore(state, {
      deadStoneRepresentatives: [{ row: 5, col: 5 }, { row: 5, col: 7 }],
    })

    expect(singleRepresentative.confirmedDeadStones).toEqual([
      { row: 5, col: 5 },
      { row: 5, col: 6 },
      { row: 5, col: 7 },
    ])
    expect(singleRepresentative.black.livingStones).toBe(1)
    expect(twoRepresentatives.confirmedDeadStones).toEqual(singleRepresentative.confirmedDeadStones)
    expect(twoRepresentatives.black.total).toBe(singleRepresentative.black.total)
  })

  it('rejects invalid dead-stone representatives with clear rule errors', () => {
    const game = new GoGameEngine()
    const state = createScoringFixture(createDeadStringBoard())

    expect(() => game.previewScore(state, {
      deadStoneRepresentatives: [{ row: -1, col: 0 }],
    })).toThrow('超出棋盘范围')
    expect(() => game.previewScore(state, {
      deadStoneRepresentatives: [{ row: 1.5, col: 0 }],
    })).toThrow('超出棋盘范围')
    expect(() => game.previewScore(state, {
      deadStoneRepresentatives: [{ row: 0, col: 0 }],
    })).toThrow('必须指向棋盘上的棋子')
    expect(() => game.previewScore(state, {
      deadStoneRepresentatives: [{ row: 5, col: 5 }, { row: 5, col: 5 }],
    })).toThrow('重复选择')
  })

  it('uses an injected scoring strategy only when a Go caller explicitly previews or finalizes', () => {
    const scoreCapture: { input: Parameters<GoScoringStrategy['score']>[0] | null } = { input: null }
    const scoring: GoScoringStrategy = {
      id: 'test-area',
      name: 'Test area',
      score(input) {
        scoreCapture.input = input
        return {
          ruleset: input.ruleset,
          method: 'test-area',
          black: { livingStones: 1, territory: 179, prisoners: input.prisoners.black, total: 180 },
          white: { livingStones: 1, territory: 162, prisoners: input.prisoners.white, total: 170.5 },
          komi: input.komi,
          neutralPoints: 0,
          confirmedDeadStones: input.confirmedDeadStones,
          winner: 'black',
          margin: 9.5,
        }
      },
    }
    const game = new GoGameEngine({ scoring })
    const scoringState = game.applyMove(game.applyMove(game.init(), GO_PASS_MOVE), GO_PASS_MOVE)

    expect(scoringState.phase).toBe('scoring')
    expect(scoreCapture.input).toBeNull()
    const preview = game.previewScore(scoringState)
    expect(scoreCapture.input?.komi).toBe(7.5)
    expect(preview).toMatchObject({ method: 'test-area', black: { total: 180 }, white: { total: 170.5 } })
  })
})

describe('Go scoring phase state machine', () => {
  it('enters scoring after two passes instead of fabricating a final result', () => {
    const game = new GoGameEngine()
    const afterBlackPass = game.applyMove(game.init(), GO_PASS_MOVE)
    const scoring = game.applyMove(afterBlackPass, GO_PASS_MOVE)

    expect(afterBlackPass.consecutivePasses).toBe(1)
    expect(afterBlackPass.phase).toBe('playing')
    expect(afterBlackPass.history.at(-1)).toMatchObject({ color: 'black', kind: 'pass', notation: 'pass' })
    expect(scoring.consecutivePasses).toBe(2)
    expect(scoring.phase).toBe('scoring')
    expect(scoring.result).toBeNull()
    expect(game.isFinished(scoring)).toBe(true)
    expect(game.isGameOver(scoring)).toBe(true)
    expect(game.getStatus(scoring)).toEqual({ phase: 'finished', winner: null, reason: 'scoring' })
    expect(game.getLegalMoves(scoring)).toEqual([])
    expect(game.getLegalActions(scoring)).toEqual([])
    expect(() => game.applyMove(scoring, { row: 3, col: 3 })).toThrow('计分')
    expect(() => game.applyMove(scoring, GO_PASS_MOVE)).toThrow('计分')
  })

  it('previews immutably, finalizes explicitly, and rejects scoring APIs outside scoring phase', () => {
    const game = new GoGameEngine()
    const scoring = game.applyMove(game.applyMove(game.init(), GO_PASS_MOVE), GO_PASS_MOVE)
    const boardBefore = goPositionKey(scoring.board)
    const historyBefore = scoring.history.map((record) => ({ ...record }))
    const positionsBefore = [...scoring.positionHistory]
    const countsBefore = [...scoring.positionCounts.entries()]

    const preview = game.previewScore(scoring)
    expect(preview.white.total).toBe(7.5)
    expect(scoring.phase).toBe('scoring')
    expect(scoring.result).toBeNull()
    expect(goPositionKey(scoring.board)).toBe(boardBefore)
    expect(scoring.history).toEqual(historyBefore)
    expect(scoring.positionHistory).toEqual(positionsBefore)
    expect([...scoring.positionCounts.entries()]).toEqual(countsBefore)

    const finished = game.finalizeScoring(scoring)
    expect(finished.phase).toBe('finished')
    expect(finished.result).toMatchObject({
      reason: 'scored',
      winner: 'white',
      score: { white: { total: 7.5 }, black: { total: 0 }, margin: 7.5 },
    })
    expect(game.isGameOver(finished)).toBe(true)
    expect(game.getLegalActions(finished)).toEqual([])
    expect(() => game.previewScore(game.init())).toThrow('不在计分阶段')
    expect(() => game.finalizeScoring(game.init())).toThrow('不在计分阶段')
    expect(() => game.resumePlay(game.init())).toThrow('不在计分阶段')
    expect(() => game.resumePlay(finished)).toThrow('不在计分阶段')
  })

  it('resumes play from scoring while retaining move and positional-superko history', () => {
    const game = new GoGameEngine()
    const afterOpening = game.applyMove(game.init(), { row: 3, col: 3 })
    const afterWhitePass = game.applyMove(afterOpening, GO_PASS_MOVE)
    const scoring = game.applyMove(afterWhitePass, GO_PASS_MOVE)
    const positionHistory = [...scoring.positionHistory]
    const positionCounts = [...scoring.positionCounts.entries()]
    const history = scoring.history.map((record) => ({ ...record }))

    const resumed = game.resumePlay(scoring)
    expect(resumed.phase).toBe('playing')
    expect(resumed.result).toBeNull()
    expect(resumed.consecutivePasses).toBe(0)
    expect(resumed.history).toEqual(history)
    expect(resumed.positionHistory).toEqual(positionHistory)
    expect([...resumed.positionCounts.entries()]).toEqual(positionCounts)
    expect(game.getLegalMoves(resumed)).toContainEqual({ row: 3, col: 4 })
    expect(game.applyMove(resumed, { row: 3, col: 4 }).board[3][4]).toBe('white')
  })

  it('keeps GameController stopped while the Go state is in scoring', async () => {
    const controller = new GameController(new GoGameEngine(), [
      { id: 'black', name: 'Black', kind: 'human' },
      { id: 'white', name: 'White', kind: 'human' },
    ])
    await controller.start()
    controller.play(GO_PASS_MOVE)
    const scoringSnapshot = controller.play(GO_PASS_MOVE)

    expect(scoringSnapshot.state.phase).toBe('scoring')
    expect(scoringSnapshot.status).toEqual({ phase: 'finished', winner: null, reason: 'scoring' })
    expect(controller.getLegalActions()).toEqual([])
  })
})
