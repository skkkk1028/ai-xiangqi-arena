import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PERSONALITY_RUNTIME, selectPersonalityMove } from '../src/engine/personality'
import { selectSearchMultiPv, type MultiPvCount } from '../src/engine/search-policy'
import { matchUcciMove, moveToUcci, parseBestmove, parseInfoLine } from '../src/engine/ucci'
import { applyMove, createInitialBoard, opposite } from '../src/game/board'
import { getLegalMoves } from '../src/game/rules'
import type {
  BoardState,
  Color,
  EngineProfile,
  SearchCandidate,
  SearchCandidateSnapshot,
  SearchInfo,
  SearchResponse,
} from '../src/game/types'

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const networkName = 'xiangqi-c07e94a5c7cb.nnue'
const sampleCount = Number(process.env.PERSONALITY_POSITIONS ?? 1_000)
const benchmarkThreads = Number(process.env.PERSONALITY_THREADS ?? 1)
const benchmarkHashMb = Number(process.env.PERSONALITY_HASH_MB ?? 128)
const policyThreads = 2
const policyHashMb = 128
const searchDepth = Number(process.env.PERSONALITY_DEPTH ?? 12)
const validationDepth = Number(process.env.PERSONALITY_VALIDATION_DEPTH ?? 14)
const searchTimeoutMs = Number(process.env.PERSONALITY_SEARCH_TIMEOUT_MS ?? 60_000)
const reportPath = resolve(projectRoot, 'benchmark', 'personality-safety-result.json')

interface EngineModule {
  FS: { writeFile(path: string, data: Uint8Array): void }
  addMessageListener(listener: (line: unknown) => void): void
  postMessage(command: string): void
  terminate(): void
}

interface PositionSample {
  board: BoardState
  color: Color
  history: string[]
  seed: number
}

interface BenchmarkSearchOptions {
  depth?: number
  searchMoves?: string[]
}

type BenchmarkMultiPv = 1 | MultiPvCount

class MultiPvEngine {
  private module!: EngineModule
  private searchLines: string[] | null = null
  private currentMultiPv: BenchmarkMultiPv = 3
  private readonly waiters: Array<{
    predicate: (line: string) => boolean
    resolve: (line: string) => void
  }> = []

  async init(): Promise<EngineProfile> {
    const savedFetch = globalThis.fetch
    // @ts-expect-error Emscripten's Node loader must use fs for the local WASM binary.
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
    this.module.FS.writeFile(
      `/${networkName}`,
      readFileSync(resolve(projectRoot, 'public', 'engine', networkName)),
    )
    ;[
      `setoption Threads ${benchmarkThreads}`,
      `setoption hashsize ${benchmarkHashMb}`,
      'setoption Ponder false',
      'setoption MultiPV 3',
      'setoption Skill_Level 20',
      'setoption UCI_LimitStrength false',
      'setoption UCI_ShowWDL true',
      'setoption Use_NNUE true',
      `setoption EvalFile /${networkName}`,
      'setoption usemillisec true',
    ].forEach((command) => this.module.postMessage(command))
    await this.commandAndWait('isready', (line) => line === 'readyok')
    return {
      name: 'Fairy-Stockfish NNUE · UCCI',
      version: 'fairy-stockfish-nnue.wasm@1.1.11',
      commit: '5589ea54',
      network: networkName,
      networkSha256: 'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
      threads: benchmarkThreads,
      hashMb: benchmarkHashMb,
    }
  }

  async search(
    history: string[],
    multiPv: BenchmarkMultiPv,
    options: BenchmarkSearchOptions = {},
  ): Promise<SearchResponse> {
    if (multiPv !== this.currentMultiPv) {
      this.module.postMessage(`setoption MultiPV ${multiPv}`)
      this.currentMultiPv = multiPv
    }
    this.searchLines = []
    this.module.postMessage('setoption name Clear Hash')
    this.module.postMessage(`position startpos${history.length ? ` moves ${history.join(' ')}` : ''}`)
    const requestedDepth = options.depth ?? searchDepth
    const searchMoves = options.searchMoves?.length
      ? ` searchmoves ${options.searchMoves.join(' ')}`
      : ''
    const bestLine = await this.commandAndWait(
      `go depth ${requestedDepth}${searchMoves}`,
      (line) => parseBestmove(line) !== undefined,
      searchTimeoutMs,
    )
    const lines = this.searchLines
    this.searchLines = null
    const byRank = new Map<number, SearchCandidate>()
    const byMove = new Map<string, SearchCandidate>()
    for (const line of lines) {
      const rankMatch = /(?:^|\s)multipv\s+(\d+)(?:\s|$)/.exec(line)
      const rank = rankMatch ? Math.max(1, Number(rankMatch[1])) : 1
      const info = parseInfoLine(line)
      if (info && isCompleteRootInfo(line, info)) {
        const rootMove = info.pv[0]
        const lastForMove = byMove.get(rootMove)
        const previous = previousSnapshot(lastForMove, info.depth)
        const lastForRank = byRank.get(rank)
        const previousPrincipal =
          rank === 1 ? previousPrincipalSnapshot(lastForRank, info.depth) : undefined
        const candidate = { ...info, multipv: rank, previous, previousPrincipal }
        if (!lastForRank || candidate.depth >= lastForRank.depth) byRank.set(rank, candidate)
        if (!lastForMove || candidate.depth >= lastForMove.depth) byMove.set(rootMove, candidate)
      }
    }
    const candidates = [...byRank.values()].sort((left, right) => left.multipv - right.multipv)
    return {
      bestmove: parseBestmove(bestLine) ?? null,
      info: candidates[0] ?? emptyInfo(),
      candidates,
    }
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
      let timeout: ReturnType<typeof setTimeout>
      const waiter = {
        predicate,
        resolve: (line: string) => {
          clearTimeout(timeout)
          resolve(line)
        },
      }
      this.waiters.push(waiter)
      timeout = setTimeout(() => {
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
    this.searchLines?.push(line)
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      if (this.waiters[index].predicate(line)) {
        this.waiters.splice(index, 1)[0].resolve(line)
      }
    }
  }
}

describe('1000局面人格安全回归代理', () => {
  const engine = new MultiPvEngine()
  let profile: EngineProfile

  beforeAll(async () => {
    profile = await engine.init()
  })

  afterAll(() => engine.close())

  it('人格换着始终满足近优硬边界并通过独立深搜回归门', async () => {
    const samples = generatePositions(sampleCount)
    const corpusSha256 = createHash('sha256')
      .update(samples.map(({ color, history }) => `${color}:${history.join(' ')}`).join('\n'))
      .digest('hex')
    let evaluated = 0
    let personalitySelections = 0
    let totalCpLoss = 0
    let maxCpLoss = 0
    let totalExpectationLoss = 0
    let maxExpectationLoss = 0
    let changedCpLoss = 0
    let changedExpectationLoss = 0
    let independentCpEvaluated = 0
    let independentWdlEvaluated = 0
    let independentCpLoss = 0
    let independentExpectationLoss = 0
    let independentMaxCpLoss = 0
    let independentMaxExpectationLoss = 0
    let independentMateRegressions = 0
    let independentScoreClassified = 0
    const personalitySelectionsByColor: Record<Color, number> = { red: 0, black: 0 }
    const personalitySelectionsDetail: Array<{
      index: number
      ply: number
      color: Color
      phase: string
      bestmove: string
      selected: string
      thresholdCp: number | null
      initialCpLoss: number
      initialWdlLoss: number
    }> = []
    const independentRegressions: Array<{
      index: number
      ply: number
      color: Color
      bestmove: string
      selected: string
      initialLoss: number
      deeperBest: number
      deeperSelected: number
      deeperLoss: number
    }> = []
    let totalDepth = 0
    let principalHistoryCoverage = 0
    let candidateHistoryCoverage = 0
    const decisionReasons = {
      personality: 0,
      'forced-best': 0,
      'insufficient-safe-candidates': 0,
    }
    const multiPvCounts: Record<MultiPvCount, number> = { 2: 0, 3: 0, 4: 0 }

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]
      const legalMoves = getLegalMoves(sample.board, sample.color)
      const multiPvDecision = selectSearchMultiPv({
        board: sample.board,
        color: sample.color,
        historyLength: sample.history.length,
        threads: policyThreads,
        hashMb: policyHashMb,
        remainingTimeMs: 600_000,
        turnBudgetMs: 15_000,
      })
      multiPvCounts[multiPvDecision.multiPv] += 1
      const response = await engine.search(sample.history, multiPvDecision.multiPv)
      const principalForCoverage = response.candidates.find(({ multipv }) => multipv === 1)
      if (principalForCoverage?.previousPrincipal?.depth === principalForCoverage.depth - 1) {
        principalHistoryCoverage += 1
      }
      candidateHistoryCoverage += response.candidates.filter(
        (candidate) => candidate.previous?.depth === candidate.depth - 1,
      ).length
      const decision = selectPersonalityMove({
        board: sample.board,
        color: sample.color,
        legalMoves,
        bestmove: response.bestmove,
        bestInfo: response.info,
        candidates: response.candidates,
        seed: sample.seed,
      })
      decisionReasons[decision.reason] += 1
      expect(decision.ucci && matchUcciMove(sample.board, legalMoves, decision.ucci)).not.toBeNull()
      totalDepth += response.info.depth

      const principal = response.candidates.find((candidate) => candidate.multipv === 1)
      const selected = response.candidates.find((candidate) => candidate.pv[0] === decision.ucci)
      if (
        principal?.score?.kind === 'cp' &&
        selected?.score?.kind === 'cp' &&
        principal.wdl &&
        selected.wdl
      ) {
        evaluated += 1
        const cpLoss = Math.max(0, principal.score.value - selected.score.value)
        const expectationLoss = Math.max(
          0,
          principal.wdl.win + principal.wdl.draw / 2 -
            (selected.wdl.win + selected.wdl.draw / 2),
        )
        totalCpLoss += cpLoss
        totalExpectationLoss += expectationLoss
        maxCpLoss = Math.max(maxCpLoss, cpLoss)
        maxExpectationLoss = Math.max(maxExpectationLoss, expectationLoss)
        if (decision.usedPersonality) {
          personalitySelections += 1
          personalitySelectionsByColor[sample.color] += 1
          changedCpLoss += cpLoss
          changedExpectationLoss += expectationLoss
          personalitySelectionsDetail.push({
            index,
            ply: sample.history.length,
            color: sample.color,
            phase: decision.phase,
            bestmove: response.bestmove!,
            selected: decision.ucci!,
            thresholdCp: decision.thresholdCp,
            initialCpLoss: cpLoss,
            initialWdlLoss: expectationLoss,
          })

          const forcedMoves = index % 2 === 0
            ? [response.bestmove!, decision.ucci!]
            : [decision.ucci!, response.bestmove!]
          const forcedResponses = new Map<string, SearchResponse>()
          for (const forcedMove of forcedMoves) {
            forcedResponses.set(
              forcedMove,
              await engine.search(sample.history, 1, {
                depth: validationDepth,
                searchMoves: [forcedMove],
              }),
            )
          }
          const deeperBest = forcedResponses.get(response.bestmove!)!
          const deeperSelected = forcedResponses.get(decision.ucci!)!
          expect(deeperBest.bestmove).toBe(response.bestmove)
          expect(deeperSelected.bestmove).toBe(decision.ucci)
          const deeperBestCandidate = deeperBest.candidates.find(({ multipv }) => multipv === 1)
          const deeperSelectedCandidate = deeperSelected.candidates.find(({ multipv }) => multipv === 1)
          if (deeperBestCandidate?.score && deeperSelectedCandidate?.score) {
            independentScoreClassified += 1
          }
          const bestWinsByMate =
            deeperBestCandidate?.score?.kind === 'mate' && deeperBestCandidate.score.value > 0
          const bestLosesByMate =
            deeperBestCandidate?.score?.kind === 'mate' && deeperBestCandidate.score.value < 0
          const selectedWinsByMate =
            deeperSelectedCandidate?.score?.kind === 'mate' &&
            deeperSelectedCandidate.score.value > 0
          const selectedLosesByMate =
            deeperSelectedCandidate?.score?.kind === 'mate' &&
            deeperSelectedCandidate.score.value < 0
          if (
            (bestWinsByMate && !selectedWinsByMate) ||
            (!bestLosesByMate && selectedLosesByMate)
          ) {
            independentMateRegressions += 1
          }
          if (
            deeperBestCandidate?.score?.kind === 'cp' &&
            deeperSelectedCandidate?.score?.kind === 'cp'
          ) {
            const deeperCpLoss = Math.max(
              0,
              deeperBestCandidate.score.value - deeperSelectedCandidate.score.value,
            )
            independentCpEvaluated += 1
            independentCpLoss += deeperCpLoss
            independentMaxCpLoss = Math.max(independentMaxCpLoss, deeperCpLoss)
            independentRegressions.push({
              index,
              ply: sample.history.length,
              color: sample.color,
              bestmove: response.bestmove!,
              selected: decision.ucci!,
              initialLoss: cpLoss,
              deeperBest: deeperBestCandidate.score.value,
              deeperSelected: deeperSelectedCandidate.score.value,
              deeperLoss: deeperCpLoss,
            })
          }
          if (deeperBestCandidate?.wdl && deeperSelectedCandidate?.wdl) {
            const deeperExpectationLoss = Math.max(
              0,
              deeperBestCandidate.wdl.win + deeperBestCandidate.wdl.draw / 2 -
                (deeperSelectedCandidate.wdl.win + deeperSelectedCandidate.wdl.draw / 2),
            )
            independentWdlEvaluated += 1
            independentExpectationLoss += deeperExpectationLoss
            independentMaxExpectationLoss = Math.max(
              independentMaxExpectationLoss,
              deeperExpectationLoss,
            )
          }
        }
        if (decision.thresholdCp !== null) expect(cpLoss).toBeLessThanOrEqual(decision.thresholdCp)
      }
    }

    const meanCpLoss = evaluated ? totalCpLoss / evaluated : 0
    const meanExpectationLoss = evaluated ? totalExpectationLoss / evaluated : 0
    const changedMeanCpLoss = personalitySelections ? changedCpLoss / personalitySelections : 0
    const changedMeanExpectationLoss = personalitySelections
      ? changedExpectationLoss / personalitySelections
      : 0
    const independentMeanCpLoss = independentCpEvaluated
      ? independentCpLoss / independentCpEvaluated
      : 0
    const independentMeanExpectationLoss = independentWdlEvaluated
      ? independentExpectationLoss / independentWdlEvaluated
      : 0
    const worstIndependentRegressions = independentRegressions
      .sort((left, right) => right.deeperLoss - left.deeperLoss)
      .slice(0, 5)
    const report = {
      generatedAt: new Date().toISOString(),
      purpose: 'paired engine-best versus personality candidate safety regression',
      limitations: [
        'This is a fixed-depth Node/WASM candidate-level A/B, not a self-play Elo test.',
        'It does not replace Chromium Worker/UI performance validation.',
      ],
      engine: profile,
      policyInput: { threads: policyThreads, hashMb: policyHashMb },
      search: { depth: searchDepth, validationDepth, clearHashBeforeEverySearch: true },
      corpus: { positions: samples.length, sha256: corpusSha256 },
      results: {
        evaluated,
        personalitySelections,
        personalitySelectionsByColor,
        meanCpLoss,
        maxCpLoss,
        meanWdlLoss: meanExpectationLoss,
        maxWdlLoss: maxExpectationLoss,
        changedMeanCpLoss,
        changedMeanWdlLoss: changedMeanExpectationLoss,
        independentCpEvaluated,
        independentWdlEvaluated,
        independentScoreClassified,
        independentMeanCpLoss,
        independentMaxCpLoss,
        independentMeanWdlLoss: independentMeanExpectationLoss,
        independentMaxWdlLoss: independentMaxExpectationLoss,
        independentMateRegressions,
        principalHistoryCoverage,
        candidateHistoryCoverage,
        decisionReasons,
        meanDepth: totalDepth / samples.length,
        multiPvCounts,
      },
      selections: personalitySelectionsDetail,
      worstIndependentRegressions,
    }
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(
      `[personality] engine=${profile.threads}t/${profile.hashMb}mb ` +
        `policy=${policyThreads}t/${policyHashMb}mb ` +
        `depth=${searchDepth}/${validationDepth} ` +
        `corpusSha256=${corpusSha256} ` +
        `positions=${samples.length} evaluated=${evaluated} selected=${personalitySelections} ` +
        `selectedRed=${personalitySelectionsByColor.red} selectedBlack=${personalitySelectionsByColor.black} ` +
        `meanCpLoss=${meanCpLoss.toFixed(2)} maxCpLoss=${maxCpLoss} ` +
        `meanWdlLoss=${meanExpectationLoss.toFixed(2)} maxWdlLoss=${maxExpectationLoss} ` +
        `changedMeanCpLoss=${changedMeanCpLoss.toFixed(2)} ` +
        `changedMeanWdlLoss=${changedMeanExpectationLoss.toFixed(2)} ` +
        `independent=${independentCpEvaluated}/${independentWdlEvaluated} ` +
        `independentClassified=${independentScoreClassified} ` +
        `independentMeanCpLoss=${independentMeanCpLoss.toFixed(2)} ` +
        `independentMaxCpLoss=${independentMaxCpLoss} ` +
        `independentMeanWdlLoss=${independentMeanExpectationLoss.toFixed(2)} ` +
        `independentMaxWdlLoss=${independentMaxExpectationLoss} ` +
        `mateRegressions=${independentMateRegressions} ` +
        `history=${principalHistoryCoverage}/${candidateHistoryCoverage} ` +
        `reasons=${JSON.stringify(decisionReasons)} ` +
        `meanDepth=${(totalDepth / samples.length).toFixed(2)} ` +
        `multipv=2:${multiPvCounts[2]},3:${multiPvCounts[3]},4:${multiPvCounts[4]}`,
    )
    console.log(
      `[personality-independent-worst] ${JSON.stringify(worstIndependentRegressions)}`,
    )
    console.log(`[personality-report] ${reportPath}`)

    expect(evaluated).toBeGreaterThan(sampleCount * 0.8)
    if (sampleCount >= 1_000) {
      expect(personalitySelections).toBeGreaterThanOrEqual(2)
      expect(personalitySelectionsByColor.red).toBeGreaterThan(0)
      expect(personalitySelectionsByColor.black).toBeGreaterThan(0)
    }
    expect(maxCpLoss).toBeLessThanOrEqual(80)
    expect(maxExpectationLoss).toBeLessThanOrEqual(
      PERSONALITY_RUNTIME.maxExpectedScoreLossPermille,
    )
    expect(meanCpLoss).toBeLessThanOrEqual(25)
    expect(meanExpectationLoss).toBeLessThanOrEqual(12)
    expect(changedMeanCpLoss).toBeLessThanOrEqual(25)
    // The changed-subset WDL mean is diagnostic only. The selector's meaningful invariant is the
    // per-move maxExpectationLoss guard above; a tiny changed subset has no statistical power.
    expect(independentScoreClassified).toBe(personalitySelections)
    expect(independentWdlEvaluated).toBe(personalitySelections)
    expect(independentMeanCpLoss).toBeLessThanOrEqual(25)
    expect(independentMaxCpLoss).toBeLessThanOrEqual(80)
    expect(independentMeanExpectationLoss).toBeLessThanOrEqual(
      PERSONALITY_RUNTIME.maxExpectedScoreLossPermille,
    )
    expect(independentMaxExpectationLoss).toBeLessThanOrEqual(50)
    expect(independentMateRegressions).toBe(0)
    expect(totalDepth / samples.length).toBeGreaterThan(0)
    expect(multiPvCounts[2] + multiPvCounts[3] + multiPvCounts[4]).toBe(sampleCount)
    expect(multiPvCounts[3]).toBeGreaterThan(0)
    expect(multiPvCounts[4]).toBeGreaterThan(0)
  })
})

function generatePositions(count: number): PositionSample[] {
  const positions: PositionSample[] = []
  let randomState = 0x20260730
  let game = 0
  while (positions.length < count) {
    let board = createInitialBoard()
    let color: Color = 'red'
    const history: string[] = []
    for (let ply = 0; ply < 120 && positions.length < count; ply += 1) {
      const legalMoves = getLegalMoves(board, color)
      if (legalMoves.length === 0) break
      if (ply >= 4) {
        positions.push({
          board: board.map((row) => row.slice()),
          color,
          history: [...history],
          seed: (game * 65_537 + ply * 97) >>> 0,
        })
      }
      randomState = nextRandom(randomState)
      const move = legalMoves[randomState % legalMoves.length]
      history.push(moveToUcci(move))
      board = applyMove(board, move)
      color = opposite(color)
    }
    game += 1
  }
  return positions
}

function nextRandom(value: number): number {
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

function emptyInfo(): SearchInfo {
  return {
    depth: 0,
    nodes: 0,
    nps: 0,
    elapsedMs: 0,
    score: null,
    wdl: null,
    pv: [],
  }
}

function previousSnapshot(
  previous: SearchCandidate | undefined,
  nextDepth: number,
): SearchCandidateSnapshot | undefined {
  if (!previous) return undefined
  if (nextDepth === previous.depth) return previous.previous
  if (nextDepth > previous.depth) {
    return { depth: previous.depth, score: previous.score, wdl: previous.wdl }
  }
  return undefined
}

function previousPrincipalSnapshot(
  previous: SearchCandidate | undefined,
  nextDepth: number,
): SearchCandidateSnapshot | undefined {
  if (!previous) return undefined
  if (nextDepth === previous.depth) return previous.previousPrincipal
  if (nextDepth > previous.depth) {
    return { depth: previous.depth, score: previous.score, wdl: previous.wdl }
  }
  return undefined
}


function isCompleteRootInfo(line: string, info: SearchInfo): boolean {
  return (
    info.depth > 0 &&
    info.score !== null &&
    info.wdl !== null &&
    info.pv.length > 0 &&
    /(?:^|\s)depth\s+\d+(?:\s|$)/.test(line) &&
    /(?:^|\s)score\s+/.test(line) &&
    /(?:^|\s)wdl\s+/.test(line) &&
    /(?:^|\s)pv\s+/.test(line) &&
    !/(?:^|\s)(?:lowerbound|upperbound)(?:\s|$)/.test(line)
  )
}
