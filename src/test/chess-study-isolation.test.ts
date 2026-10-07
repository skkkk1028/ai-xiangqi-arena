import { afterEach, expect, it, vi } from 'vitest'
import { ChessNativeStockfishAdapter } from '../games/chess/native-adapter'
import { ChessArenaNativeAdapter } from '../games/chess/arena-native-adapter'
import { CHESS_STOCKFISH_18_NATIVE_CONFIG, CHESS_STOCKFISH_18_ARENA_CONFIG } from '../engine/config'
const context={assetBase:'http://localhost/',onProgress:vi.fn()}
afterEach(()=>vi.unstubAllGlobals())
it('原生研习初始化迟到后不能复活或启动回退 Worker',async()=>{
 let resolve!:(value:Response)=>void
 const fetcher=vi.fn(()=>new Promise<Response>(r=>{resolve=r}));vi.stubGlobal('fetch',fetcher)
 const adapter=new ChessNativeStockfishAdapter(CHESS_STOCKFISH_18_NATIVE_CONFIG,context)
 const pending=adapter.init();adapter.dispose()
 resolve(new Response(JSON.stringify({ready:true,runtimeBackend:'native-stockfish-18',engineVersion:'18',threads:2,hashMb:64})))
 await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(fetcher).toHaveBeenCalledTimes(1)
})
it('竞技场取消初始化会释放迟到的独立会话',async()=>{
 let resolve!:(value:Response)=>void
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r})).mockResolvedValue(new Response('{}'))
 vi.stubGlobal('fetch',fetcher)
 const adapter=new ChessArenaNativeAdapter(CHESS_STOCKFISH_18_ARENA_CONFIG,context,'stockfish-18')
 const pending=adapter.init();adapter.dispose()
 resolve(new Response(JSON.stringify({token:'late-session',engineVersion:'18',threads:2,hashMb:64})))
 await expect(pending).rejects.toMatchObject({name:'AbortError'})
 expect(fetcher).toHaveBeenLastCalledWith('/api/chess/arena/sessions/late-session',expect.objectContaining({method:'DELETE'}))
})
it('取消一个原生请求不会取消另一适配器的请求',async()=>{
 const signals:AbortSignal[]=[]
 vi.stubGlobal('fetch',vi.fn((url:string,options?:RequestInit)=>{
  if(url.endsWith('capabilities'))return Promise.resolve(new Response(JSON.stringify({ready:true,runtimeBackend:'native-stockfish-18',engineVersion:'18',threads:2,hashMb:64})))
  signals.push(options!.signal as AbortSignal)
  return new Promise<Response>((_,reject)=>options!.signal!.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError'))))
 }))
 const a=new ChessNativeStockfishAdapter(CHESS_STOCKFISH_18_NATIVE_CONFIG,context), b=new ChessNativeStockfishAdapter(CHESS_STOCKFISH_18_NATIVE_CONFIG,context)
 await Promise.all([a.init(),b.init()])
 const first=a.search([],3000,{multiPv:1}),second=b.search([],3000,{multiPv:1})
 a.dispose();expect(signals[0].aborted).toBe(true);expect(signals[1].aborted).toBe(false)
 b.dispose();await Promise.all([expect(first).rejects.toMatchObject({name:'AbortError'}),expect(second).rejects.toMatchObject({name:'AbortError'})])
})
