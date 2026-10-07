import { describe, expect, it } from 'vitest'
import { createNotebookEntry, exportNotebook, parseNotebook, notebookKey, xiangqiNotebook } from '../games/xiangqi/notebook'
import { replayXiangqiUcci } from '../games/xiangqi/archive'
const draft = { moves: ['a3a4', 'a6a5'], source: { kind: 'guess' as const, label: '出题局面' }, reference: { guessed: 'b0c2', actual: 'a4a5', source: 'engine' as const } }
describe('象棋练习本文件', () => {
  it('独立完整历史往返保留局面、备注、参考与规则计数', () => {
    const entry = createNotebookEntry(draft, '收藏标题', '测试备注', '值得重试')
    const [restored] = parseNotebook(exportNotebook([entry]))
    expect(restored).toEqual(entry)
    expect(replayXiangqiUcci(restored.moves)).toEqual(replayXiangqiUcci(draft.moves))
    expect(replayXiangqiUcci(restored.moves).noCapturePlies).toBe(2)
  })
  it('同快照去重不受备注影响，不同猜招保留', () => {
    const entry = createNotebookEntry(draft)
    expect(notebookKey({ ...entry, title: '更改标题' } as typeof entry)).toBe(notebookKey(entry))
    expect(notebookKey({ ...entry, reference: { ...entry.reference, guessed: 'c3c4' } })).not.toBe(notebookKey(entry))
  })
  it('非法历史、参考、规则集与任意损坏条目拒绝整个导入', () => {
    const entry = createNotebookEntry(draft)
    for (const bad of [{ ...entry, moves: ['a0a9'] }, { ...entry, reference: { actual: 'a0a9' } }, { ...entry, ruleset: 'other' }, { ...entry, category: '错题' }]) {
      const raw = JSON.stringify({ format: 'project10-xiangqi-notebook', version: 1, entries: [entry, bad] })
      expect(() => parseNotebook(raw)).toThrow()
      expect(() => xiangqiNotebook.import(raw)).toThrow()
    }
  })
})
