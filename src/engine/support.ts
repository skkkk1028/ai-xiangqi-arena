export interface EngineSupport {
  supported: boolean
  reason: string | null
  threads: number
  hashMb: number
  mobile: boolean
}

export function detectEngineSupport(): EngineSupport {
  const mobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    Math.min(window.innerWidth, window.innerHeight) < 700
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const wasm = typeof WebAssembly === 'object'
  const shared = typeof SharedArrayBuffer === 'function'
  const isolated = window.crossOriginIsolated === true

  let reason: string | null = null
  if (!wasm) reason = '浏览器不支持 WebAssembly。'
  else if (!shared) reason = '浏览器不支持 SharedArrayBuffer。'
  else if (!isolated) reason = '页面未启用专业引擎所需的跨源隔离。'

  const constrained = mobile || memory === undefined || memory < 4
  return {
    supported: reason === null,
    reason,
    threads: constrained ? 1 : 2,
    hashMb: constrained ? 64 : 128,
    mobile,
  }
}
