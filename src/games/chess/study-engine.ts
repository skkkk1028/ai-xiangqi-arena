import { Chess } from 'chess.js'
import { engineRegistry } from '../../engine/default-registry'
import { CHESS_STOCKFISH_18_ENGINE_ID, CHESS_STOCKFISH_18_NATIVE_ENGINE_ID, CHESS_STOCKFISH_18_SINGLE_ENGINE_ID } from '../../engine/config'
import type { EngineAdapter } from '../../engine/adapter'
import type { EngineProfile, EngineSearchResponse, SearchCandidate } from '../../game/types'
import { parseChessUci } from './rules'
import type { ChessSavedAnalysis } from './library'
import { CHESS_RULESET } from './types'

export type StudyTier = 'quick' | 'deep'
export const STUDY_BUDGET_MS: Record<StudyTier, number> = { quick: 3_000, deep: 10_000 }

export function studyEngineIdentity(profile: EngineProfile): ChessSavedAnalysis['engine'] {
  return {
    name: profile.name, version: profile.version, backend: profile.id ?? profile.engineType ?? 'unknown',
    threads: profile.threads, hashMb: profile.hashMb, ...(profile.networkSha256 ? { network: profile.networkSha256 } : {}),
    fallback: import.meta.env.VITE_CHESS_NATIVE_BRIDGE === '1' && !profile.name.includes('Native'),
  }
}

export function studyAnalysisKey(gameId: string, initialFen: string, prefix: readonly string[], tier: StudyTier, engine: ChessSavedAnalysis['engine']): string {
  return JSON.stringify([gameId, CHESS_RULESET, initialFen, prefix, tier, engine])
}

function legalPv(fen: string, pv: readonly string[]): boolean {
  const chess = new Chess(fen)
  for (const uci of pv) {
    const move = parseChessUci(uci)
    if (!move) return false
    try { chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) }) }
    catch { return false }
  }
  return true
}

export function validateStudyResponse(fen: string, response: EngineSearchResponse): EngineSearchResponse {
  const candidates = response.candidates.filter((candidate): candidate is SearchCandidate => candidate.pv.length > 0 && legalPv(fen, candidate.pv))
  const bestmove = response.bestmove
  if (bestmove && !legalPv(fen, [bestmove])) throw new Error(`Stockfish 返回非法着法：${bestmove}`)
  return { ...response, candidates, info: legalPv(fen, response.info.pv) ? response.info : { ...response.info, pv: [] } }
}

export class ChessStudyEngine {
  private adapter: EngineAdapter | null = null
  private profile: EngineProfile | null = null
  private initializing: Promise<EngineProfile> | null = null
  private closed = false

  constructor(private readonly fixedResources = false) {}

  async init(): Promise<EngineProfile> {
    if (this.closed) throw new DOMException('引擎会话已结束。', 'AbortError')
    if (this.profile) return this.profile
    if (this.initializing) return this.initializing
    const native = import.meta.env.VITE_CHESS_NATIVE_BRIDGE === '1'
    const multithread = typeof SharedArrayBuffer === 'function' && window.crossOriginIsolated === true
    const id = native ? CHESS_STOCKFISH_18_NATIVE_ENGINE_ID : multithread ? CHESS_STOCKFISH_18_ENGINE_ID : CHESS_STOCKFISH_18_SINGLE_ENGINE_ID
    const adapter = engineRegistry.createEngine('chess', id, { assetBase: new URL('./', window.location.origin).href, onProgress: () => undefined }, { threads: multithread ? 2 : 1, hash: 64 })
    this.adapter = adapter
    this.initializing = adapter.init().then(async (profile) => {
      if (!this.closed && this.fixedResources && native && (profile.threads !== (multithread ? 2 : 1) || profile.hashMb !== 64)) {
        adapter.dispose()
        const browser = engineRegistry.createEngine('chess', multithread ? CHESS_STOCKFISH_18_ENGINE_ID : CHESS_STOCKFISH_18_SINGLE_ENGINE_ID,
          {assetBase: new URL('./', window.location.origin).href, onProgress: () => undefined}, {threads: multithread ? 2 : 1, hash: 64})
        this.adapter = browser
        profile = await browser.init()
        if (this.closed) { browser.dispose(); throw new DOMException('引擎会话已结束。', 'AbortError') }
      }
      if (this.closed) { adapter.dispose(); throw new DOMException('引擎会话已结束。', 'AbortError') }
      this.profile = profile
      return profile
    }).catch((error) => { adapter.dispose(); this.adapter?.dispose(); this.adapter = null; throw error })
    try { return await this.initializing } finally { this.initializing = null }
  }

  async search(initialFen: string, prefix: readonly string[], tier: StudyTier, multiPv: 1 | 4, signal?: AbortSignal): Promise<{ response: EngineSearchResponse; elapsedMs: number; timedOut: boolean; engine: ChessSavedAnalysis['engine'] }> {
    const profile = await this.init()
    if (signal?.aborted) throw new DOMException('分析已取消。', 'AbortError')
    const adapter = this.adapter!
    const stop = () => adapter.stop('分析已取消。')
    signal?.addEventListener('abort', stop, { once: true })
    const state = new Chess(initialFen)
    for (const uci of prefix) {
      const action = parseChessUci(uci)
      if (!action) throw new Error('棋谱包含无效着法。')
      state.move({ from: action.from, to: action.to, ...(action.promotion ? { promotion: action.promotion } : {}) })
    }
    const started = performance.now()
    try {
      const response = validateStudyResponse(state.fen(), await adapter.search([...prefix], STUDY_BUDGET_MS[tier], { multiPv, initialFen }))
      if (signal?.aborted) throw new DOMException('分析已取消。', 'AbortError')
      const elapsedMs = Math.round(performance.now() - started)
      return { response, elapsedMs, timedOut: elapsedMs > STUDY_BUDGET_MS[tier] + 1_000, engine: studyEngineIdentity(profile) }
    } finally { signal?.removeEventListener('abort', stop) }
  }

  stop(): void { this.adapter?.stop('分析已停止。') }
  dispose(): void { this.closed = true; this.adapter?.dispose(); this.adapter = null; this.profile = null }
}
