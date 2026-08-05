import { describe, expect, it } from 'vitest'
import {
  classifyPersonalityPhase,
  PERSONALITY_RUNTIME,
  selectPersonalityMove,
} from '../engine/personality'
import { matchUcciMove, moveToUcci } from '../engine/ucci'
import { applyMove, createEmptyBoard, createInitialBoard } from '../game/board'
import { getLegalMoves, isInCheck } from '../game/rules'
import type {
  BoardState,
  Color,
  Piece,
  PieceType,
  SearchCandidate,
  SearchInfo,
  Wdl,
} from '../game/types'

const SAFE_WDL: Wdl = { win: 400, draw: 400, loss: 200 }

describe('AI 人格近优候选选择', () => {
  it('红方只在40厘兵安全集合内偏向主动中央炮', () => {
    const board = createInitialBoard()
    const decision = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 100, SAFE_WDL, ['b0c2', 'b9c7']),
      candidate(2, 'h2e2', 100, SAFE_WDL, ['h2e2', 'h9g7']),
      candidate(3, 'a0a1', 10, SAFE_WDL),
    ])

    expect(decision.ucci).toBe('h2e2')
    expect(decision.thresholdCp).toBe(40)
    expect(decision.usedPersonality).toBe(true)
  })

  it('候选不足时按40、60、80扩展，但不超过80厘兵', () => {
    const board = createInitialBoard()
    const expanded = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 100, SAFE_WDL, ['b0c2', 'b9c7']),
      candidate(2, 'h2e2', 30, SAFE_WDL, ['h2e2', 'h9g7']),
    ])
    expect(expanded.thresholdCp).toBe(80)
    expect(expanded.ucci).toBe('b0c2')
    expect(expanded.usedPersonality).toBe(false)

    const rejected = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 100, SAFE_WDL),
      candidate(2, 'h2e2', 19, SAFE_WDL),
    ])
    expect(rejected.ucci).toBe('b0c2')
    expect(rejected.reason).toBe('insufficient-safe-candidates')
  })

  it('普通中局40/60/80厘兵边界按包含端点执行', () => {
    const board = createInitialBoard()
    const thresholdForDrop = (drop: number) =>
      decide(board, 'red', 'b0c2', [
        candidate(1, 'b0c2', 100, SAFE_WDL),
        candidate(2, 'h2e2', 100 - drop, SAFE_WDL),
      ]).thresholdCp

    expect(thresholdForDrop(40)).toBe(40)
    expect(thresholdForDrop(41)).toBe(60)
    expect(thresholdForDrop(60)).toBe(60)
    expect(thresholdForDrop(61)).toBe(80)
    expect(thresholdForDrop(80)).toBe(80)
    expect(thresholdForDrop(81)).toBeNull()
  })

  it('WDL明显下降时，即使厘兵差较小也执行第一选择', () => {
    const board = createInitialBoard()
    const decision = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 100, { win: 600, draw: 300, loss: 100 }),
      candidate(2, 'h2e2', 80, { win: 490, draw: 310, loss: 200 }),
    ])
    expect(decision.ucci).toBe('b0c2')
    expect(decision.usedPersonality).toBe(false)
  })

  it('候选深度不足或局面已呈决定性优势时不启用人格覆盖', () => {
    const board = createInitialBoard()
    const shallow = [
      { ...candidate(1, 'b0c2', 100, SAFE_WDL), depth: 11 },
      { ...candidate(2, 'h2e2', 100, SAFE_WDL), depth: 11 },
    ]
    expect(decide(board, 'red', 'b0c2', shallow)).toMatchObject({
      ucci: 'b0c2',
      reason: 'forced-best',
    })

    const decisive = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 400, { win: 820, draw: 160, loss: 20 }),
      candidate(2, 'h2e2', 400, { win: 820, draw: 160, loss: 20 }),
    ])
    expect(decisive).toMatchObject({ ucci: 'b0c2', reason: 'forced-best' })
  })

  it('同一根着跨连续深度的相对评价不稳定时回退第一选择', () => {
    const board = createInitialBoard()
    const principal = candidate(1, 'b0c2', 20, SAFE_WDL)
    const unstable = candidate(2, 'h2e2', 20, SAFE_WDL)
    unstable.previous = {
      depth: 17,
      score: { kind: 'cp', value: -30 },
      wdl: { win: 370, draw: 400, loss: 230 },
    }
    expect(decide(board, 'red', 'b0c2', [principal, unstable])).toMatchObject({
      ucci: 'b0c2',
      reason: 'insufficient-safe-candidates',
    })
  })

  it('将杀、必须应将、重度受攻和唯一候选均强制执行第一选择', () => {
    const initial = createInitialBoard()
    const mate = decide(initial, 'red', 'b0c2', [
      candidate(1, 'b0c2', { kind: 'mate', value: 3 }, SAFE_WDL),
      candidate(2, 'h2e2', 500, SAFE_WDL),
    ])
    expect(mate.ucci).toBe('b0c2')
    expect(mate.reason).toBe('forced-best')

    const attacked = decide(initial, 'red', 'b0c2', [
      candidate(1, 'b0c2', -250, { win: 50, draw: 300, loss: 650 }),
      candidate(2, 'h2e2', -260, { win: 45, draw: 305, loss: 650 }),
    ])
    expect(attacked.ucci).toBe('b0c2')
    expect(attacked.reason).toBe('forced-best')

    const checkedBoard = checkingPosition()
    const legal = getLegalMoves(checkedBoard, 'black')
    expect(isInCheck(checkedBoard, 'black')).toBe(true)
    expect(legal.length).toBeGreaterThan(1)
    const checkedCandidates = legal.slice(0, 2).map((move, index) =>
      candidate(index + 1, moveToUcci(move), 0 - index * 10, SAFE_WDL),
    )
    const checked = selectPersonalityMove({
      board: checkedBoard,
      color: 'black',
      legalMoves: legal,
      bestmove: checkedCandidates[0].pv[0],
      bestInfo: checkedCandidates[0],
      candidates: checkedCandidates,
      seed: 7,
    })
    expect(checked.ucci).toBe(checkedCandidates[0].pv[0])
    expect(checked.reason).toBe('forced-best')

    const onlyCandidate = decide(initial, 'red', 'b0c2', [
      candidate(1, 'b0c2', 20, SAFE_WDL),
    ])
    expect(onlyCandidate.ucci).toBe('b0c2')
    expect(onlyCandidate.reason).toBe('insufficient-safe-candidates')
  })

  it('第一选择直接终结对局时不允许人格覆盖', () => {
    const board = terminalBestPosition()
    const decision = decide(board, 'red', 'e7e8', [
      candidate(1, 'e7e8', 120, SAFE_WDL),
      candidate(2, 'd8d7', 120, SAFE_WDL),
    ])
    expect(decision).toMatchObject({ ucci: 'e7e8', reason: 'forced-best' })
  })

  it('存在多种合法着但替代着允许强制将军时执行唯一防守', () => {
    const board = uniqueDefensePosition()
    expect(isInCheck(board, 'red')).toBe(false)
    const afterAlternative = applyMove(
      board,
      matchUcciMove(board, getLegalMoves(board, 'red'), 'a3a4')!,
    )
    const matingThreat = matchUcciMove(
      afterAlternative,
      getLegalMoves(afterAlternative, 'black'),
      'e2e1',
    )
    expect(matingThreat).not.toBeNull()
    const afterThreat = applyMove(afterAlternative, matingThreat!)
    expect(isInCheck(afterThreat, 'red')).toBe(true)
    expect(getLegalMoves(afterThreat, 'red')).toHaveLength(0)
    const decision = decide(board, 'red', 'e1e2', [
      candidate(1, 'e1e2', 20, SAFE_WDL),
      candidate(2, 'a3a4', 20, SAFE_WDL),
    ])
    expect(decision).toMatchObject({
      ucci: 'e1e2',
      reason: 'insufficient-safe-candidates',
      usedPersonality: false,
    })
  })

  it('替代着允许唯一但安全的应将时仍执行第一选择', () => {
    const board = singleSafeDefensePosition()
    const afterAlternative = applyMove(
      board,
      matchUcciMove(board, getLegalMoves(board, 'red'), 'a3a4')!,
    )
    const forcingCheck = matchUcciMove(
      afterAlternative,
      getLegalMoves(afterAlternative, 'black'),
      'e2e1',
    )
    expect(forcingCheck).not.toBeNull()
    const afterThreat = applyMove(afterAlternative, forcingCheck!)
    const replies = getLegalMoves(afterThreat, 'red')
    expect(isInCheck(afterThreat, 'red')).toBe(true)
    expect(replies).toHaveLength(1)
    expect(moveToUcci(replies[0])).toBe('d0e1')
    expect(isInCheck(applyMove(afterThreat, replies[0]), 'red')).toBe(false)

    expect(
      decide(board, 'red', 'e1e2', [
        candidate(1, 'e1e2', 20, SAFE_WDL),
        candidate(2, 'a3a4', 20, SAFE_WDL),
      ]),
    ).toMatchObject({
      ucci: 'e1e2',
      reason: 'insufficient-safe-candidates',
      usedPersonality: false,
    })
  })

  it('缺失WDL、非法PV或陈旧深度均不能进入人格候选集', () => {
    const board = createInitialBoard()
    const missingWdl = [
      { ...candidate(1, 'b0c2', 20, SAFE_WDL), wdl: null },
      candidate(2, 'h2e2', 20, SAFE_WDL),
    ]
    expect(decide(board, 'red', 'b0c2', missingWdl).reason).toBe('forced-best')

    const stale = [
      candidate(1, 'b0c2', 20, SAFE_WDL),
      { ...candidate(2, 'h2e2', 20, SAFE_WDL), depth: 17 },
    ]
    expect(decide(board, 'red', 'b0c2', stale).reason).toBe(
      'insufficient-safe-candidates',
    )

    const illegal = [
      candidate(1, 'b0c2', 20, SAFE_WDL),
      candidate(2, 'a9a8', 20, SAFE_WDL),
    ]
    expect(decide(board, 'red', 'b0c2', illegal).reason).toBe(
      'insufficient-safe-candidates',
    )
  })

  it('WDL期望损失20‰可入选，21‰被硬安全线拒绝', () => {
    const board = createInitialBoard()
    const principalWdl = { win: 500, draw: 400, loss: 100 }
    const allowed = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 20, principalWdl),
      candidate(2, 'h2e2', 20, { win: 480, draw: 400, loss: 120 }),
    ])
    expect(allowed.reason).toBe('personality')

    const rejected = decide(board, 'red', 'b0c2', [
      candidate(1, 'b0c2', 20, principalWdl),
      candidate(2, 'h2e2', 20, { win: 479, draw: 400, loss: 121 }),
    ])
    expect(rejected).toMatchObject({
      ucci: 'b0c2',
      reason: 'insufficient-safe-candidates',
    })
  })

  it('黑方在安全集合内偏向宫内补士', () => {
    const board = createInitialBoard()
    const decision = decide(board, 'black', 'a6a5', [
      candidate(1, 'a6a5', 40, SAFE_WDL, ['a6a5', 'b0c2']),
      candidate(2, 'd9e8', 40, SAFE_WDL, ['d9e8', 'b0c2']),
    ])
    expect(decision.ucci).toBe('d9e8')
    expect(decision.usedPersonality).toBe(true)
  })

  it('残局从25厘兵开始，战斗局面从60厘兵开始', () => {
    const endgame = sparsePosition()
    expect(classifyPersonalityPhase(endgame, 'red')).toBe('endgame')
    expect(PERSONALITY_RUNTIME.thresholdsCp.endgame[0]).toBe(25)

    const complex = complexPosition()
    expect(classifyPersonalityPhase(complex, 'red')).toBe('complex')
    expect(PERSONALITY_RUNTIME.thresholdsCp.complex[0]).toBe(60)
  })

  it('1000组候选中从不突破动态阈值或WDL安全线', () => {
    const board = createInitialBoard()
    const legalMoves = getLegalMoves(board, 'red')
    for (let seed = 0; seed < 1_000; seed += 1) {
      const drop = seed % 101
      const wdlDrop = seed % 71
      const candidates = [
        candidate(1, 'b0c2', 100, { win: 450, draw: 400, loss: 150 }),
        candidate(2, 'h2e2', 100 - drop, {
          win: 450 - wdlDrop,
          draw: 400,
          loss: 150 + wdlDrop,
        }),
      ]
      const decision = selectPersonalityMove({
        board,
        color: 'red',
        legalMoves,
        bestmove: 'b0c2',
        bestInfo: candidates[0],
        candidates,
        seed,
      })
      if (decision.ucci === 'h2e2') {
        expect(drop).toBeLessThanOrEqual(decision.thresholdCp!)
        expect(wdlDrop).toBeLessThanOrEqual(PERSONALITY_RUNTIME.maxLossIncreasePermille)
      }
    }
  })
})

function decide(
  board: BoardState,
  color: Color,
  bestmove: string,
  candidates: SearchCandidate[],
) {
  return selectPersonalityMove({
    board,
    color,
    legalMoves: getLegalMoves(board, color),
    bestmove,
    bestInfo: candidates[0],
    candidates,
    seed: 20260730,
  })
}

function candidate(
  multipv: number,
  ucci: string,
  score: number | SearchInfo['score'],
  wdl: Wdl,
  pv: string[] = [ucci],
): SearchCandidate {
  const normalizedScore = typeof score === 'number' ? { kind: 'cp' as const, value: score } : score
  return {
    multipv,
    depth: 18,
    nodes: 100_000,
    nps: 50_000,
    elapsedMs: 1_000,
    score: normalizedScore,
    wdl,
    pv,
    previous: {
      depth: 17,
      score: normalizedScore,
      wdl: { ...wdl },
    },
    previousPrincipal: {
      depth: 17,
      score: normalizedScore,
      wdl: { ...wdl },
    },
  }
}

let pieceId = 0
function piece(color: Color, type: PieceType): Piece {
  return { id: `personality-${pieceId++}`, color, type }
}

function checkingPosition(): BoardState {
  const board = createEmptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[1][4] = piece('red', 'chariot')
  return board
}

function sparsePosition(): BoardState {
  const board = createEmptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[7][0] = piece('red', 'chariot')
  board[2][8] = piece('black', 'chariot')
  return board
}

function complexPosition(): BoardState {
  const board = createEmptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[5][4] = piece('red', 'chariot')
  board[5][2] = piece('black', 'soldier')
  board[5][6] = piece('black', 'soldier')
  board[3][4] = piece('black', 'soldier')
  board[9][2] = piece('red', 'elephant')
  board[9][3] = piece('red', 'advisor')
  board[9][5] = piece('red', 'advisor')
  board[9][6] = piece('red', 'elephant')
  board[8][1] = piece('red', 'horse')
  board[8][7] = piece('red', 'horse')
  board[0][3] = piece('black', 'advisor')
  board[0][5] = piece('black', 'advisor')
  return board
}

function terminalBestPosition(): BoardState {
  const board = createEmptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[2][4] = piece('red', 'chariot')
  board[1][3] = piece('red', 'chariot')
  board[1][5] = piece('red', 'chariot')
  return board
}

function uniqueDefensePosition(): BoardState {
  const board = createEmptyBoard()
  board[0][4] = piece('black', 'general')
  board[9][4] = piece('red', 'general')
  board[8][4] = piece('red', 'chariot')
  board[6][0] = piece('red', 'soldier')
  board[7][4] = piece('black', 'chariot')
  board[8][3] = piece('black', 'chariot')
  board[8][5] = piece('black', 'chariot')
  return board
}

function singleSafeDefensePosition(): BoardState {
  const board = uniqueDefensePosition()
  board[9][3] = piece('red', 'advisor')
  return board
}
