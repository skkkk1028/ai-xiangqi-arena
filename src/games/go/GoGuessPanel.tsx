import { GoMoveComparison } from './GoMoveComparison'
import { NotebookSave } from './NotebookSave'
import { createGoArchive } from './sgf'
import type { GoStudyEntry } from './GoStudyPage'
import type { GoGameState } from './types'
import type { useGoMatch } from './useGoMatch'
import { goGuessHit } from './guess'
import { formatGoPoint } from './move-history'
import { GO_PASS_MOVE, isGoPassMove } from './types'
import './guess.css'

export function GoGuessPanel({ match, disabled = false, onPractice }: { match: ReturnType<typeof useGoMatch>; disabled?: boolean; onPractice?: (state: GoGameState, reference: GoStudyEntry['reference']) => void }) {
  const { guess, state, runState } = match
  if (match.mode !== 'ai' && match.mode !== 'battle') return null
  const { round, stats, phase } = guess
  const selected = round?.selected
  return <section className="go-guess-panel" aria-label="围棋猜下一手">
    <label><input type="checkbox" checked={phase !== 'off'}
      disabled={phase === 'searching' || runState === 'connecting' || !match.sessionReady || state.phase !== 'playing'}
      onChange={(event) => match.toggleGuess(event.target.checked)} />猜下一手（每手暂停作答）</label>
    {phase === 'off' && <p>猜 AI 的实际落子；命中率不代表棋力。</p>}
    {phase === 'armed' && <p role="status">当前手结束后开始竞猜，本手不计分。</p>}
    {phase === 'choosing' && <>
      <p>请猜{state.turn === 'black' ? '黑' : '白'}方下一手。点击合法空点，提交前可以修改。</p>
      <p>已选：{selected ? isGoPassMove(selected) ? '虚着' : formatGoPoint(selected) : '尚未选择'}</p>
      <button type="button" aria-pressed={Boolean(selected && isGoPassMove(selected))} onClick={() => match.selectGuess(GO_PASS_MOVE)}>猜虚着</button>
      <button type="button" disabled={!selected} onClick={() => void match.submitGuess()}>提交猜招</button>
      <button type="button" onClick={() => void match.submitGuess(true)}>跳过本题</button>
    </>}
    {phase === 'searching' && <><p role="status">答案已锁定，AI 正在计算。</p><button type="button" onClick={() => void match.pauseAI()}>暂停竞猜</button></>}
    {phase === 'revealed' && round?.actual && <div role="status">
      <p>你的猜招：{selected ? isGoPassMove(selected) ? '虚着' : formatGoPoint(selected) : '跳过'} · AI 实际落子：{round.actual.kind === 'pass' ? '虚着' : round.actual.notation} · {selected ? goGuessHit(selected, round.actual) ? '猜中' : '未猜中' : '本题跳过'}</p>
      {onPractice && <button disabled={disabled} onClick={() => onPractice(round.before, { guessed: selected ?? undefined, actual: round.actual!.kind === 'pass' ? GO_PASS_MOVE : round.actual!.point!, description: `${round.analysis?.engineName ?? 'AI 实战着'} · ${match.profile}` })}>从本题局面练习</button>}
      <NotebookSave key={round.id} label="收藏本题局面" draft={{ archive: createGoArchive(round.before), source: {kind:'guess', label:'猜下一手 · 出题局面'}, reference: {guessed: selected ?? undefined, actual: round.actual.kind === 'pass' ? GO_PASS_MOVE : round.actual.point!, description: `${round.analysis?.engineName ?? 'AI 实战着'} · ${match.profile}`} }} />
      {selected && !disabled && <GoMoveComparison key={round.id} before={round.before} selected={selected} reference={round.actual.kind === 'pass' ? GO_PASS_MOVE : round.actual.point!} label="分析我的猜招" />}
      {!round.analysis && <p>本手暂无分析</p>}
    </div>}
    {phase === 'void' && <p role="status">本题作废：AI 未完成落子，不计入成绩。可以重新出题。</p>}
    {(phase === 'revealed' || phase === 'void') && state.phase === 'playing' &&
      <button type="button" onClick={match.nextGuess}>{phase === 'void' ? '重新出题' : '下一题'}</button>}
    {(phase !== 'off' || stats.answered > 0) && <p className="go-guess-stats">本局命中 {stats.hits} / {stats.answered} · 命中率 {stats.answered ? `${Math.round(stats.hits / stats.answered * 100)}%` : '—'} · 当前连续 {stats.streak} · 最长连续 {stats.longest}</p>}
  </section>
}
