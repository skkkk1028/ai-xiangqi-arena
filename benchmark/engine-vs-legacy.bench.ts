import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { searchBestMove } from '../src/ai/search'
import { OPENING_PREFIXES } from '../src/engine/openings'
import { matchUcciMove, moveToUcci, parseBestmove } from '../src/engine/ucci'
import { applyMove, createInitialBoard, opposite, positionKey } from '../src/game/board'
import { getLegalMoves, isInCheck } from '../src/game/rules'
import type { BoardState, Color, Move } from '../src/game/types'

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const networkName = 'xiangqi-c07e94a5c7cb.nnue'
const gameCount = Number(process.env.BENCHMARK_GAMES ?? 100)
const maxPlies = 180
const perMoveMs = Number(process.env.BENCHMARK_MOVE_MS ?? 35)

interface GameOutcome {
  game: number
  opening: number
  professionalColor: Color
  winner: Color | null
  reason: 'checkmate' | 'stalemate' | 'repetition' | 'no-capture' | 'ply-limit'
  plies: number
  illegalMoves: number
}

interface EngineModule {
  FS: { writeFile(path: string, data: Uint8Array): void }
  addMessageListener(listener: (line: unknown) => void): void
  postMessage(command: string): void
  terminate(): void
}

class ProfessionalEngine {
  private module!: EngineModule
  private readonly lines: string[] = []
  private readonly waiters: Array<{
    predicate: (line: string) => boolean
    resolve: (line: string) => void
  }> = []

  async init() {
    const savedFetch = globalThis.fetch
    // Emscripten's Node loader must use fs for the local WASM binary.
    // @ts-expect-error Intentionally hidden during the CJS module load.
    globalThis.fetch = undefined
    const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js') as (
      options?: Record<string, unknown>,
    ) => Promise<EngineModule>
    this.module = await Stockfish({
      locateFile: (filename: string) =>
        resolve(projectRoot, 'node_modules', 'fairy-stockfish-nnue.wasm', filename),
    })
    globalThis.fetch = savedFetch
    this.module.addMessageListener((raw) => this.handleLine(String(raw).trim()))

    await this.commandAndWait('ucci', (line) => line === 'ucciok')
    const network = readFileSync(resolve(projectRoot, 'public', 'engine', networkName))
    this.module.FS.writeFile(`/${networkName}`, network)
    ;[
      'setoption Threads 1',
      'setoption hashsize 64',
      'setoption Ponder false',
      'setoption MultiPV 1',
      'setoption Skill_Level 20',
      'setoption UCI_LimitStrength false',
      'setoption UCI_ShowWDL true',
      'setoption Use_NNUE true',
      `setoption EvalFile /${networkName}`,
      'setoption usemillisec true',
    ].forEach((command) => this.module.postMessage(command))
    await this.commandAndWait('isready', (line) => line === 'readyok')
    this.module.postMessage('position startpos')
    await this.commandAndWait('go depth 1', (line) => parseBestmove(line) !== undefined)
  }

  isNnueConfirmed(): boolean {
    return (
      this.lines.some((line) => /NNUE evaluation using .* enabled/i.test(line)) &&
      !this.lines.some((line) => /classical evaluation enabled/i.test(line))
    )
  }

  newGame() {
    this.module.postMessage('uccinewgame')
  }

  async search(history: string[], movetimeMs: number): Promise<string | null> {
    this.module.postMessage(`position startpos${history.length ? ` moves ${history.join(' ')}` : ''}`)
    const line = await this.commandAndWait(
      `go movetime ${movetimeMs}`,
      (output) => parseBestmove(output) !== undefined,
      10_000,
    )
    return parseBestmove(line) ?? null
  }

  close() {
    this.module.terminate()
  }

  private commandAndWait(
    command: string,
    predicate: (line: string) => boolean,
    timeoutMs = 30_000,
  ): Promise<string> {
    const result = new Promise<string>((resolve, reject) => {
      const waiter = { predicate, resolve }
      this.waiters.push(waiter)
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error(`等待引擎响应超时：${command}`))
      }, timeoutMs)
    })
    this.module.postMessage(command)
    return result
  }

  private handleLine(line: string) {
    if (!line) return
    this.lines.push(line)
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      if (this.waiters[index].predicate(line)) {
        this.waiters.splice(index, 1)[0].resolve(line)
      }
    }
  }
}

describe('100盘 Fairy-Stockfish NNUE 对旧浏览器 AI 基准', () => {
  const professional = new ProfessionalEngine()

  beforeAll(async () => {
    await professional.init()
  })

  afterAll(() => {
    professional.close()
  })

  it('满足胜率、不败率、合法性及 NNUE 验收线', async () => {
    const outcomes: GameOutcome[] = []
    const startedAt = Date.now()

    for (let game = 0; game < gameCount; game += 1) {
      const professionalColor: Color = game % 2 === 0 ? 'red' : 'black'
      const openingIndex = Math.floor(game / 2) % OPENING_PREFIXES.length
      const outcome = await playGame(
        professional,
        game + 1,
        openingIndex,
        professionalColor,
      )
      outcomes.push(outcome)
      if ((game + 1) % 10 === 0) {
        const summary = summarize(outcomes)
        console.log(
          `[benchmark] ${game + 1}/${gameCount} · 胜 ${summary.wins} 和 ${summary.draws} 负 ${summary.losses} · 非法 ${summary.illegalMoves}`,
        )
      }
    }

    const summary = summarize(outcomes)
    const report = {
      generatedAt: new Date().toISOString(),
      engine: 'fairy-stockfish-nnue.wasm@1.1.11',
      network: networkName,
      games: gameCount,
      perMoveMs,
      maxPlies,
      elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      ...summary,
      outcomes,
    }
    writeFileSync(
      resolve(projectRoot, 'benchmark', 'latest-result.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )

    expect(professional.isNnueConfirmed()).toBe(true)
    expect(summary.illegalMoves).toBe(0)
    expect(summary.winRate).toBeGreaterThanOrEqual(0.9)
    expect(summary.unbeatenRate).toBeGreaterThanOrEqual(0.95)
  })
})

async function playGame(
  professional: ProfessionalEngine,
  game: number,
  opening: number,
  professionalColor: Color,
): Promise<GameOutcome> {
  professional.newGame()
  let board = createInitialBoard()
  let turn: Color = 'red'
  const history: string[] = []
  const repetitions = new Map<string, number>([[positionKey(board, turn), 1]])
  let noCapturePlies = 0
  let illegalMoves = 0

  for (let ply = 0; ply < maxPlies; ply += 1) {
    const legalMoves = getLegalMoves(board, turn)
    if (legalMoves.length === 0) {
      return {
        game,
        opening,
        professionalColor,
        winner: opposite(turn),
        reason: isInCheck(board, turn) ? 'checkmate' : 'stalemate',
        plies: ply,
        illegalMoves,
      }
    }

    let move: Move | null = null
    const openingMove = OPENING_PREFIXES[opening][ply]
    if (openingMove) move = matchUcciMove(board, legalMoves, openingMove)

    if (!move && turn === professionalColor) {
      const bestmove = await professional.search(history, perMoveMs)
      move = bestmove ? matchUcciMove(board, legalMoves, bestmove) : null
      if (!move) {
        illegalMoves += 1
        return {
          game,
          opening,
          professionalColor,
          winner: opposite(turn),
          reason: 'ply-limit',
          plies: ply,
          illegalMoves,
        }
      }
    }

    if (!move) {
      const legacy = searchBestMove(board, turn, perMoveMs, game * 65537 + ply * 97, 12)
      move = legacy.move
      if (!move || !legalMoves.some((candidate) => sameMove(candidate, move!))) {
        illegalMoves += 1
        return {
          game,
          opening,
          professionalColor,
          winner: opposite(turn),
          reason: 'ply-limit',
          plies: ply,
          illegalMoves,
        }
      }
    }

    history.push(moveToUcci(move))
    board = applyMove(board, move)
    turn = opposite(turn)
    noCapturePlies = move.captured ? 0 : noCapturePlies + 1
    const key = positionKey(board, turn)
    const count = (repetitions.get(key) ?? 0) + 1
    repetitions.set(key, count)
    if (count >= 3) {
      return { game, opening, professionalColor, winner: null, reason: 'repetition', plies: ply + 1, illegalMoves }
    }
    if (noCapturePlies >= 120) {
      return { game, opening, professionalColor, winner: null, reason: 'no-capture', plies: ply + 1, illegalMoves }
    }
  }
  return { game, opening, professionalColor, winner: null, reason: 'ply-limit', plies: maxPlies, illegalMoves }
}

function sameMove(left: Move, right: Move): boolean {
  return (
    left.from.row === right.from.row &&
    left.from.col === right.from.col &&
    left.to.row === right.to.row &&
    left.to.col === right.to.col
  )
}

function summarize(outcomes: GameOutcome[]) {
  let wins = 0
  let draws = 0
  let losses = 0
  let illegalMoves = 0
  for (const outcome of outcomes) {
    illegalMoves += outcome.illegalMoves
    if (!outcome.winner) draws += 1
    else if (outcome.winner === outcome.professionalColor) wins += 1
    else losses += 1
  }
  const games = outcomes.length
  return {
    wins,
    draws,
    losses,
    illegalMoves,
    winRate: games ? wins / games : 0,
    unbeatenRate: games ? (wins + draws) / games : 0,
  }
}
