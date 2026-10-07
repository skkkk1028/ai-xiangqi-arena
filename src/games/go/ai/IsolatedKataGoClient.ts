import type { KataGoWorkerRequest, KataGoWorkerResponse, KataGoAnalysisPayload, KataGoAnalyzeRequest } from '../../../vendor/web-katago/engine/katago/types'
import type { KataGoBackendPreference } from '../../../vendor/web-katago/types'

/** Dedicated worker for temporary practice; never resets the live game's singleton. */
export class IsolatedKataGoClient {
  private readonly worker = new Worker(new URL('../../../vendor/web-katago/engine/katago/worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private info: {backend:string|null;modelName:string|null} = {backend:null,modelName:null}
  private initialization: {resolve:()=>void;reject:(error:Error)=>void}|null = null
  private pending = new Map<number,{resolve:(value:KataGoAnalysisPayload)=>void;reject:(error:Error)=>void;onProgress?: (value:KataGoAnalysisPayload)=>void;group:string}>()
  constructor() {
    this.worker.onmessage = (event:MessageEvent<KataGoWorkerResponse>) => {
      const message=event.data
      if ('backend' in message && message.backend) this.info.backend=message.backend
      if ('modelName' in message && message.modelName) this.info.modelName=message.modelName
      if(message.type==='katago:init_result'){
        const pending=this.initialization;this.initialization=null
        if(message.ok)pending?.resolve();else pending?.reject(new Error(message.error ?? '模型初始化失败。'))
      } else if(message.type==='katago:analyze_update' || message.type==='katago:analyze_result') {
        const pending=this.pending.get(message.id)
        if(!pending)return
        if(message.type==='katago:analyze_update') {if(message.ok && message.analysis)pending.onProgress?.(message.analysis);return}
        this.pending.delete(message.id)
        if(message.canceled)pending.reject(new DOMException('搜索已取消。','AbortError'))
        else if(message.ok && message.analysis)pending.resolve(message.analysis)
        else pending.reject(new Error(message.error ?? '搜索失败。'))
      }
    }
    this.worker.onerror=()=>this.rejectAll(new Error('KataGo Worker 运行失败。'))
    this.worker.onmessageerror=()=>this.rejectAll(new Error('KataGo Worker 消息无效。'))
  }
  private rejectAll(error:Error) {
    this.initialization?.reject(error);this.initialization=null
    for(const pending of this.pending.values())pending.reject(error)
    this.pending.clear()
  }
  private post(message:KataGoWorkerRequest) { this.worker.postMessage(message) }
  getEngineInfo(){return {...this.info}}
  init(modelUrl:string,backend?:KataGoBackendPreference):Promise<void>{
    return new Promise((resolve,reject)=>{
      this.initialization={resolve,reject}
      try{this.post({type:'katago:init',modelUrl,backend})}catch(error){this.initialization=null;reject(error)}
    })
  }
  analyze(args:Omit<KataGoAnalyzeRequest,'type'|'id'> & {onProgress?:(value:KataGoAnalysisPayload)=>void}):Promise<KataGoAnalysisPayload>{
    const id=this.nextId++,{onProgress,...request}=args
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject,onProgress,group:request.analysisGroup ?? 'background'})
      try{this.post({...request,moveHistory:request.moveHistory.slice(-5),type:'katago:analyze',id})}catch(error){this.pending.delete(id);reject(error)}
    })
  }
  cancelAnalysis(group:'interactive'|'background'){
    this.post({type:'katago:cancel',analysisGroup:group})
    for(const [id,pending] of this.pending){if(pending.group===group){this.pending.delete(id);pending.reject(new DOMException('搜索已取消。','AbortError'))}}
  }
  dispose(){this.worker.terminate();this.rejectAll(new DOMException('分析实例已释放。','AbortError'))}
}
