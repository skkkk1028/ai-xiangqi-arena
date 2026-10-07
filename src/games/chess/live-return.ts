export type ChessLiveMode = 'theatre' | 'arena' | 'human' | 'local'
export interface ChessLiveReturn { id: string; mode: ChessLiveMode; phase: 'study' | 'resume' }

const key = 'project10-chess-live-return'

export function readChessLiveReturn(): ChessLiveReturn | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as ChessLiveReturn | null
    return value && typeof value.id === 'string' && ['theatre', 'arena', 'human', 'local'].includes(value.mode)
      && ['study', 'resume'].includes(value.phase) ? value : null
  } catch { return null }
}

export function writeChessLiveReturn(value: ChessLiveReturn | null): void {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value))
    else sessionStorage.removeItem(key)
  } catch { /* The saved library game remains available if session storage is disabled. */ }
}
