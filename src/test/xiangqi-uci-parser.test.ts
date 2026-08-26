import { describe, expect, it } from 'vitest'
import { UciParser } from '../engine/parsers/uci-parser'

describe('中国象棋 UCI 坐标解析', () => {
  it('解析 Pikafish 的九列、零到九路坐标', () => {
    const parser = new UciParser(/^[a-i][0-9][a-i][0-9]$/)
    expect(parser.parseBestmove('bestmove h2e2')).toBe('h2e2')
    expect(parser.parseInfo('info depth 12 score cp 18 wdl 400 400 200 nodes 123 pv h2e2 h9g7')?.pv).toEqual([
      'h2e2',
      'h9g7',
    ])
  })

  it('标准国际象棋解析器仍拒绝中国象棋坐标', () => {
    const parser = new UciParser()
    expect(parser.parseBestmove('bestmove i0a0')).toBeNull()
  })
})
