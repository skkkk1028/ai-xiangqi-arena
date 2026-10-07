import { useEffect, useRef, useState } from 'react'
import type { GoGameState, GoMove } from './types'
import { encodedPrefix, type GoStudyProfile } from './study-analysis'
import { createConfiguredKataGoTransport } from './ai/configured-transport'
import { compareGoMoves, type GoMoveEvidence, type GoTwoMoveComparison } from './move-comparison'

export function GoMoveComparison({before, selected, reference, label = '分析这一手'}: { before:GoGameState; selected:GoMove; reference?:GoMove; label?:string }) {
  const identity = JSON.stringify([encodedPrefix(before),before.phase,selected,reference])
  const [result,setResult] = useState<{identity:string; profile:GoStudyProfile; value:GoTwoMoveComparison}|null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [profile,setProfile] = useState<GoStudyProfile>('winrate')
  const abort = useRef<AbortController|null>(null)
  const generation = useRef(0)
  const pending = useRef(false)
  const serial = useRef<Promise<void>>(Promise.resolve())
  const cache = useRef(new Map<GoStudyProfile,GoTwoMoveComparison>())
  const cancel = () => { generation.current++; abort.current?.abort(); pending.current=false; setBusy(false) }
  useEffect(()=>{
    cache.current.clear(); setResult(null); setError(''); setProfile('winrate'); setBusy(false)
    return ()=>{ generation.current++; abort.current?.abort(); pending.current=false }
  },[identity])
  const analyze = (requested:GoStudyProfile, refresh=false) => {
    if(pending.current) return
    setProfile(requested); setError('')
    const hit=cache.current.get(requested)
    if(hit && !refresh){setResult({identity,profile:requested,value:hit});return}
    if (refresh) cache.current.delete(requested)
    const token=++generation.current
    const controller=new AbortController(); abort.current=controller; pending.current=true; setBusy(true); setResult(null)
    const assertCurrent=()=>{controller.signal.throwIfAborted(); if(token!==generation.current) throw new DOMException('已取消','AbortError')}
    serial.current=serial.current.catch(()=>undefined).then(async()=>{
      let transport:Awaited<ReturnType<typeof createConfiguredKataGoTransport>>|null=null
      try {
        assertCurrent(); transport=await createConfiguredKataGoTransport({isolated:true}); assertCurrent()
        const value=await compareGoMoves(before,selected,reference,requested,controller.signal,transport)
        assertCurrent(); cache.current.set(requested,value); setResult({identity,profile:requested,value})
      } catch(reason){if(token===generation.current && !controller.signal.aborted)setError(String(reason))}
      finally{try{await transport?.dispose()}finally{if(token===generation.current){pending.current=false;setBusy(false)}}}
    }).catch(reason=>{if(token===generation.current){pending.current=false;setBusy(false);setError(String(reason))}})
  }
  const completed=result?.identity===identity ? result : null
  return <section className="go-move-comparison" aria-label="围棋按需着法比较">
    <div className="go-study-actions"><button disabled={busy || Boolean(completed && completed.profile===profile)} onClick={()=>analyze(profile)}>{label}</button>
      {completed && <button disabled={busy} onClick={()=>analyze(profile,true)}>重新分析</button>}
      <button disabled={busy || completed?.profile==='fast'} onClick={()=>analyze('fast')}>加深分析</button>
      {busy && <button onClick={cancel}>停止分析</button>}</div>
    <p>独立 KataGo：快速 256 visits / 12 秒；加深 2000 visits / 30 秒。最多三次搜索，仅在本页保留，不影响竞猜成绩。</p>
    {busy && <p role="status">正在比较落子，可停止…</p>}{error && <p role="alert">分析失败：{error}。局面和成绩保留，可以重试。</p>}
    {completed && <div><p>推荐候选：{completed.value.best ?? '没有有效候选'}。以下评价统一为出题方视角。</p>
      <Evidence label="你的落子" value={completed.value.selected}/>{completed.value.reference && <Evidence label="参考落子" value={completed.value.reference}/>}
      <p>根搜索：{completed.value.root.modelName} · {completed.value.root.engineVersion} · {completed.value.root.runtimeBackend} · {completed.value.root.root.visits}/{completed.value.root.requestedVisits} visits · {(completed.value.root.elapsedMs/1000).toFixed(1)} 秒。</p>
    </div>}
  </section>
}
function Evidence({label,value}:{label:string;value:GoMoveEvidence}){
  return <div className="go-study-evidence"><h3>{label}：{value.move==='pass'?'虚着':value.move}</h3>
    <p>{value.method==='candidate'?'同一次根搜索的候选比较，各候选 visits 可能不同':'落子后补搜估计，不是严格等量搜索'}；有效 visits：{value.visits}。</p>
    <p>预计目差 {value.scoreLead?.toFixed(1) ?? '未知'}；胜率 {value.winrate===null?'未知':`${(value.winrate*100).toFixed(1)}%`}；相对推荐少 {value.lossPoints?.toFixed(1) ?? '未知'} 目，胜率降低 {value.lossWinrate?.toFixed(1) ?? '未知'} 个百分点。</p>
    <p>{value.event.modelName} · {value.event.engineVersion} · {value.event.runtimeBackend} · {value.event.root.visits}/{value.event.requestedVisits} visits · {(value.event.elapsedMs/1000).toFixed(1)} 秒。</p>
    {value.notes.map(note=><p key={note}>{note}</p>)}<p>合法参考变化：{value.variation.join(' → ') || '未提供'}。合法变化不是强制结论。</p>
  </div>
}
