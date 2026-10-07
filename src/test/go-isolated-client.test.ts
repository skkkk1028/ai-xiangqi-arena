import { afterEach, expect, it, vi } from 'vitest'
import { IsolatedKataGoClient } from '../games/go/ai/IsolatedKataGoClient'
class WorkerStub {
  static all:WorkerStub[]=[]
  onmessage: ((event:MessageEvent)=>void)|null=null
  onerror: (()=>void)|null=null
  onmessageerror: (()=>void)|null=null
  postMessage=vi.fn()
  terminate=vi.fn()
  constructor(){WorkerStub.all.push(this)}
  emit(data:unknown){this.onmessage?.({data} as MessageEvent)}
}
afterEach(()=>{vi.unstubAllGlobals();WorkerStub.all=[]})
it('临时客户端分别持有 Worker，取消与销毁不会影响其他实例',async()=>{
  vi.stubGlobal('Worker',WorkerStub)
  const first=new IsolatedKataGoClient(), second=new IsolatedKataGoClient()
  const initial=first.init('/model','webgpu'),other=second.init('/model','webgpu')
  WorkerStub.all[0].emit({type:'katago:init_result',ok:true,backend:'webgpu',modelName:'one'})
  WorkerStub.all[1].emit({type:'katago:init_result',ok:true,backend:'wasm',modelName:'two'})
  await Promise.all([initial,other])
  expect(second.getEngineInfo()).toEqual({backend:'wasm',modelName:'two'})
  const request={modelUrl:'/model',board:[],currentPlayer:'black' as const,moveHistory:[],komi:7.5,analysisGroup:'background' as const}
  const pending=first.analyze(request),rejected=expect(pending).rejects.toThrow('已取消')
  first.cancelAnalysis('background');await rejected
  first.dispose()
  expect(WorkerStub.all[0].terminate).toHaveBeenCalledOnce()
  expect(WorkerStub.all[1].terminate).not.toHaveBeenCalled()
  const response=second.analyze(request)
  WorkerStub.all[1].emit({type:'katago:analyze_result',id:1,ok:true,analysis:{rootVisits:256}})
  expect(await response).toMatchObject({rootVisits:256})
  second.dispose()
})
it('初始化卸载或 Worker 报错时拒绝等待任务',async()=>{
  vi.stubGlobal('Worker',WorkerStub)
  const client=new IsolatedKataGoClient()
  const initial=client.init('/model'),rejected=expect(initial).rejects.toThrow('已释放')
  client.dispose();await rejected
})
