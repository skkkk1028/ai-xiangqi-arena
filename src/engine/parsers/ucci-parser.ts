import type { EngineScore, SearchInfo } from '../../game/types'

export const UCCI_MOVE_PATTERN = /^[a-i][0-9][a-i][0-9]$/

export class UcciParser {
  parseInfo(line: string, previous?: SearchInfo): SearchInfo | null {
    if (!line.startsWith('info ')) return null
    const next: SearchInfo = previous
      ? { ...previous, pv: [...previous.pv], wdl: previous.wdl && { ...previous.wdl } }
      : { depth: 0, nodes: 0, nps: 0, elapsedMs: 0, score: null, wdl: null, pv: [] }

    const tokens = line.trim().split(/\s+/)
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token === 'depth') next.depth = readNumber(tokens[++index], next.depth)
      else if (token === 'seldepth') next.seldepth = readNumber(tokens[++index], next.seldepth ?? 0)
      else if (token === 'multipv') next.multipv = Math.max(1, readNumber(tokens[++index], next.multipv ?? 1))
      else if (token === 'nodes') next.nodes = readNumber(tokens[++index], next.nodes)
      else if (token === 'nps') next.nps = readNumber(tokens[++index], next.nps)
      else if (token === 'time') next.elapsedMs = readNumber(tokens[++index], next.elapsedMs)
      else if (token === 'score') {
        const kindOrValue = tokens[++index]
        if (kindOrValue === 'cp' || kindOrValue === 'mate') {
          const value = Number(tokens[++index])
          if (Number.isFinite(value)) next.score = { kind: kindOrValue, value } as EngineScore
        } else {
          const value = Number(kindOrValue)
          if (Number.isFinite(value)) next.score = { kind: 'cp', value }
        }
      } else if (token === 'wdl') {
        const win = Number(tokens[++index])
        const draw = Number(tokens[++index])
        const loss = Number(tokens[++index])
        if ([win, draw, loss].every(Number.isFinite)) next.wdl = { win, draw, loss }
      } else if (token === 'pv') {
        next.pv = tokens.slice(index + 1).filter((move) => UCCI_MOVE_PATTERN.test(move))
        break
      }
    }
    return next
  }

  parseBestmove(line: string): string | null | undefined {
    if (line === 'nobestmove') return null
    const match = /^bestmove(?:\s+(\S+))?/.exec(line)
    if (!match) return undefined
    return match[1] && UCCI_MOVE_PATTERN.test(match[1]) ? match[1] : null
  }

  readMultiPvRank(line: string): number {
    const match = /(?:^|\s)multipv\s+(\d+)(?:\s|$)/.exec(line)
    return match ? Math.max(1, Number(match[1])) : 1
  }

  isCompleteRootInfo(line: string, info: SearchInfo): boolean {
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
}

const defaultParser = new UcciParser()

export const parseInfoLine = defaultParser.parseInfo.bind(defaultParser)
export const parseBestmove = defaultParser.parseBestmove.bind(defaultParser)

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
