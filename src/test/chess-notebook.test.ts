import { describe, expect, it } from 'vitest'
import { createNotebookEntry, exportNotebook, parseNotebook, notebookKey, chessNotebook, chessNotebookDraft } from '../games/chess/notebook'
import { restoreChessArchive } from '../games/chess/archive'
import { replayChessState, ChessGameEngine } from '../games/chess/rules'
const state = replayChessState(['e2e4', 'e7e5'])
const draft = chessNotebookDraft(state, {kind: 'guess', label: '竞猜'}, {guessed: 'g1f3', actual: 'b1c3'})
describe('国际象棋个人练习本', () => {
  it('独立档案 JSON 往返保留完整历史和参考，不依赖原谱', () => {
    const entry = createNotebookEntry(draft, '标题', '备注', '值得重试')
    const restored = parseNotebook(exportNotebook([entry]))[0]
    expect(restored).toEqual(entry)
    expect(restoreChessArchive(restored.archive)).toEqual(state)
    expect(notebookKey({...entry, reference: {actual: 'b1c3'}})).not.toBe(notebookKey(entry))
    expect(notebookKey({...entry, title: '改名'} as typeof entry)).toBe(notebookKey(entry))
  })
  it('逐手校验及非法参考使整个导入批次在写库前失败', () => {
    const entry = createNotebookEntry(draft)
    for (const bad of [{...entry, archive: {...entry.archive, moves: ['e2e5']}}, {...entry, reference: {actual: 'e1e8'}}, {...entry, archive: {...entry.archive, ruleset: 'other'}}, {...entry, category: '自动掌握'}]) {
      expect(() => chessNotebook.import(JSON.stringify({format:'project10-chess-notebook', version:1, entries:[entry,bad]}))).toThrow()
    }
  })
  it('和棋声明与预定着法往返，不额外执行一步', () => {
    const base = replayChessState(['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1'])
    const rules = new ChessGameEngine()
    const claim = rules.getLegalActions(base).find(a => a.kind === 'claim-draw' && a.intendedMove?.from === 'f6')!
    const claimed = rules.executeAction(base, claim)
    const entry = createNotebookEntry(chessNotebookDraft(claimed, {kind:'review',label:'声明'}))
    const restored = restoreChessArchive(parseNotebook(exportNotebook([entry]))[0].archive)
    expect(restored.result?.termination).toBe('claim')
    expect(restored.history).toHaveLength(7)
    expect(notebookKey(entry)).not.toBe(notebookKey(chessNotebookDraft(base,{kind:'review',label:'声明'})))
  })
})
