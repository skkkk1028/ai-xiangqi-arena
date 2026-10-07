import { moveToUcci } from '../engine/ucci'
import { formatMove, pieceLabel } from '../game/notation'
import type { GuessState } from '../games/xiangqi/guess'
import { MoveComparison } from '../games/xiangqi/MoveComparison'
import { NotebookSave } from '../games/xiangqi/NotebookSave'
import './guess-next-move.css'

export function GuessSummary({ guess }: { guess: GuessState }) {
  const { stats, round } = guess
  return <div className="guess-summary">
    {round?.actual && <p>你的猜招：{round.selected ? formatMove(round.selected) : '跳过'} · AI 实战着：{round.actual.notation} · {round.selected && moveToUcci(round.selected) === round.actual.ucci ? '猜中了' : round.selected ? '未猜中' : '本题跳过'}（{round.source === 'opening' ? '开局库' : '引擎选招'}）</p>}
    {guess.phase === 'void' && <p>本题作废：AI 未完成落子，不计入成绩。</p>}
    <p>作答 {stats.answered} · 命中 {stats.hits} · 命中率 {stats.answered ? `${Math.round(stats.hits / stats.answered * 100)}%` : '—'} · 连续命中 {stats.streak} · 最长 {stats.longest}</p>
  </div>
}

export function GuessNextMove({ guess, finished, onSubmit, onNext, onPractice, practiceDisabled }: {
  guess: GuessState; finished: boolean; onSubmit: (skip?: boolean) => void; onNext: () => void
  onPractice?: () => void; practiceDisabled?: boolean
}) {
  if (guess.phase === 'off') return null
  const round = guess.round
  return <section className="guess-panel" aria-label="猜下一手">
    <div className="guess-panel-heading"><h2>猜下一手</h2><span>本局互动</span></div>
    {guess.phase === 'armed' && <p>下一手开始竞猜；当前回合继续正常观战。</p>}
    {guess.phase === 'choosing' && <>
      <p>请猜{round?.before.turn === 'red' ? '红' : '黑'}方下一手。选择棋子和目标格，提交前可以修改。</p>
      <p>已选：{round?.selected ? formatMove(round.selected) : '尚未选择'}</p>
      <button disabled={!round?.selected} onClick={() => onSubmit()}>提交猜招</button><button onClick={() => onSubmit(true)}>跳过并揭晓</button>
    </>}
    {guess.phase === 'searching' && <p>答案已锁定，AI 正在思考，棋钟正常计时。</p>}
    <GuessSummary guess={guess} />
    {guess.phase === 'revealed' && round?.actual && <>
      <p>命中表示猜中了 AI 实际落子；未猜中不代表走法不好。</p>
      {round.actual.captured && <p>棋谱事实：实战吃掉{pieceLabel(round.actual.captured)}。</p>}
      {onPractice && <button disabled={practiceDisabled} onClick={onPractice}>从本题局面练习</button>}
      <NotebookSave label="收藏本题局面" draft={{ moves: round.before.history.map((move) => move.ucci), source: { kind: 'guess', label: '猜下一手 · 出题局面' }, reference: { ...(round.selected ? { guessed: moveToUcci(round.selected) } : {}), actual: round.actual.ucci, source: round.source } }} />
      {round.selected && !practiceDisabled && <MoveComparison before={round.before} userUcci={moveToUcci(round.selected)} referenceUcci={round.actual.ucci} label="分析我的走法" />}
      {!finished && <button onClick={onNext}>下一题</button>}
    </>}
    {guess.phase === 'void' && !finished && <button onClick={onNext}>继续</button>}
  </section>
}
