import { ChessMoveComparison } from './ChessMoveComparison'
import { NotebookSave } from './NotebookSave'
import { chessNotebookDraft } from './notebook'
import type { ChessStudyEntry } from './ChessTemporaryStudy'
import { actionToUci } from './rules'
import { chessGuessSan } from './guess'
import type { useChessMatch } from './useChessMatch'
import './guess.css'

export function ChessGuessPanel({ match, onStudy }: { match: ReturnType<typeof useChessMatch>; onStudy?: (entry: ChessStudyEntry) => void }) {
  const { guess, guessBusy, state } = match
  const { phase, round, stats } = guess
  const selected = round?.selected
  return <section className="chess-guess" aria-label="国际象棋猜下一手">
    <label><input type="checkbox" checked={phase !== 'off'}
      disabled={phase === 'searching' || match.runState === 'loading' || Boolean(state.result)}
      onChange={(event) => match.toggleGuess(event.target.checked)} />猜下一手（每手暂停作答）</label>
    {phase === 'off' && <p>预测 AI 实际落子；命中率不代表棋力。</p>}
    {phase === 'armed' && <p role="status">当前回合结束后开始竞猜，本手不计分。</p>}
    {phase === 'choosing' && <>
      <p>请猜{state.turn === 'w' ? '白' : '黑'}方下一手。选择棋子和目标格，升变时请选择棋子类型。</p>
      <p>已选：{selected && round ? `${chessGuessSan(round.before, selected)} · ${actionToUci(selected)}` : '尚未选择'}</p>
      <button type="button" disabled={!selected || guessBusy} onClick={() => match.submitGuess()}>提交猜招</button>
      <button type="button" disabled={guessBusy} onClick={() => match.submitGuess(true)}>跳过本题</button>
    </>}
    {phase === 'searching' && <><p role="status">答案已锁定，正在准备引擎或计算着法。</p><button type="button" onClick={() => void match.pause()}>暂停竞猜</button></>}
    {phase === 'revealed' && round?.actual && <div role="status">
      <p>你的猜招：{selected ? chessGuessSan(round.before, selected) : '跳过'} · AI 实际落子：{round.actual.san} · {selected ? actionToUci(selected) === round.actual.uci ? '猜中' : '未猜中' : '本题跳过'}</p>
      <p>答案来源：{round.analysis?.source === 'opening' ? '开局库' : '引擎选招'}</p>
      {round.analysis?.source === 'opening' ? <p>开局库着法，本手未搜索。</p> : !round.analysis && <p>本手暂无分析。</p>}
    </div>}
    {phase === 'revealed' && round?.actual && <div key={round.id}>
      {selected && <ChessMoveComparison before={round.before} selected={actionToUci(selected)} reference={round.actual.uci} />}
      {onStudy && <button onClick={async () => { const entry = {state: round.before, source: '竞猜出题局面', reference: {guessed: selected ? actionToUci(selected) : undefined, actual: round.actual!.uci, description: round.analysis?.source === 'opening' ? '开局库' : '引擎选招'}}; try { await match.suspendForStudy(); onStudy(entry) } catch { /* A new game invalidates this entry. */ } }}>从本题局面练习</button>}
      <NotebookSave label="收藏本题局面" draft={chessNotebookDraft(round.before, {kind: 'guess', label: '竞猜出题局面'}, {guessed: selected ? actionToUci(selected) : undefined, actual: round.actual.uci, description: round.analysis?.source === 'opening' ? '开局库' : '引擎选招'})} />
    </div>}
    {phase === 'void' && <p role="status">{guess.reason}</p>}
    {(phase === 'revealed' || phase === 'void') && !state.result && <button type="button" disabled={guessBusy} onClick={match.nextGuess}>{phase === 'void' ? '重新出题' : '下一题'}</button>}
    {guessBusy && phase === 'void' && <p>正在等待旧搜索结束或引擎恢复…</p>}
    {(phase !== 'off' || stats.answered > 0) && <p className="chess-guess__stats">本局命中 {stats.hits} / {stats.answered} · 命中率 {stats.answered ? `${Math.round(stats.hits / stats.answered * 100)}%` : '—'} · 当前连续 {stats.streak} · 最长连续 {stats.longest}</p>}
  </section>
}
