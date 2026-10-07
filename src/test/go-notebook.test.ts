import { describe, expect, it } from 'vitest'
import { createNotebookEntry, exportNotebook, parseNotebook, notebookKey, goNotebook } from '../games/go/notebook'
import { createGoArchive, restoreGoArchive } from '../games/go/sgf'
import { studyGame, playableStudyState } from '../games/go/study-analysis'
const base = studyGame.applyMove(studyGame.init(), {row:3,col:3})
const draft = {archive:createGoArchive(base), source:{kind:'guess' as const,label:'竞猜'}, reference:{guessed:{row:3,col:15},actual:{kind:'pass' as const}}}
describe('围棋个人练习本数据', () => {
  it('JSON 重放保留落子、提子和超级劫历史，参考独立于棋盘', () => {
    const entry = createNotebookEntry(draft, '标题', '备注', '值得重试')
    const restored = parseNotebook(exportNotebook([entry]))[0]
    expect(restored).toEqual(entry)
    expect(restoreGoArchive(restored.archive)).toEqual(base)
    expect(restored.archive.moves).toEqual(['B:D16'])
    expect(notebookKey({...restored,source:{...restored.source,label:'别名'}})).toBe(notebookKey(entry))
    expect(notebookKey({...restored,reference:{actual:{kind:'pass'}}})).not.toBe(notebookKey(entry))
  })
  it('相同两次虚着历史的计分、恢复及结束状态分别重建', () => {
    const scoring = studyGame.applyMove(studyGame.applyMove(base,{kind:'pass'}),{kind:'pass'})
    const resumed = playableStudyState(scoring)
    const finished = studyGame.finalizeScoring(scoring,{deadStoneRepresentatives:[]})
    const entries = [scoring,resumed,finished].map(state=>createNotebookEntry({archive:createGoArchive(state),source:{kind:'practice',label:'测试'}}))
    expect(new Set(entries.map(notebookKey)).size).toBe(3)
    parseNotebook(exportNotebook(entries)).forEach((entry,index)=>expect(restoreGoArchive(entry.archive)).toEqual([scoring,resumed,finished][index]))
    expect(resumed.positionHistory).toEqual(scoring.positionHistory)
  })
  it('非法历史、规则、超级劫、自杀、参考和混合批次在写库前拒绝', () => {
    const entry = createNotebookEntry(draft)
    const raw=(bad:unknown)=>JSON.stringify({format:'project10-go-notebook',version:1,entries:[entry,bad]})
    for (const bad of [
      {...entry,archive:{...entry.archive,moves:['B:D16','W:D16']}},
      {...entry,archive:{...entry.archive,ruleset:'other'}},
      {...entry,reference:{actual:{row:3,col:3}}},
      {...entry,archive:{...entry.archive,moves:['B:B19','W:T1','B:A18','W:A19']}},
      {...entry,category:'auto-mastered'},
    ]) expect(()=>goNotebook.import(raw(bad))).toThrow()
  })
})
