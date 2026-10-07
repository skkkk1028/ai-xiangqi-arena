import { useState } from 'react'
import type { MatchArchivePlayer } from '../core'
import { GAME_ROUTES } from '../routes'
import { createChessArchive } from './archive'
import { downloadChessFile } from './ChessLibraryPage'
import { chessLibrary } from './library'
import type { ChessLibraryGameV1 } from './library'
import type { ChessGameState } from './types'
import { writeChessLiveReturn, type ChessLiveMode } from './live-return'

export function ChessLibraryActions({ id, mode, state, players, status, pause, saveNow, clock }: {
  id: string
  mode: ChessLiveMode
  state: ChessGameState
  players?: readonly MatchArchivePlayer[]
  status: 'idle' | 'saving' | 'saved' | 'failed'
  pause: () => void | Promise<unknown>
  saveNow: () => Promise<boolean>
  clock?: ChessLibraryGameV1['clock']
}) {
  const [error, setError] = useState<string | null>(null)
  const review = async () => {
    try {
      await pause()
      if (!await saveNow()) throw new Error('当前棋局未能保存，请先导出 JSON 备份。')
      const saved = await chessLibrary.get(id)
      if (!saved) throw new Error('当前棋局未能保存，请先导出 JSON 备份。')
      writeChessLiveReturn({ id, mode, phase: 'study' })
      window.location.hash = `${GAME_ROUTES.chessStudy}/${encodeURIComponent(id)}`
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const openLibrary = async () => {
    try {
      await pause()
      if (!await saveNow()) throw new Error('当前棋局未能保存，请先导出 JSON 备份。')
      if (mode === 'theatre') writeChessLiveReturn({ id, mode, phase: 'resume' })
      window.location.hash = GAME_ROUTES.chessLibrary
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const archive = createChessArchive({ state, players: players?.length === 2 ? players : [
    { seat: 'w', kind: 'human', name: '白方' }, { seat: 'b', kind: 'human', name: '黑方' },
  ] })
  const exportNow = () => downloadChessFile(`国际象棋-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(clock ? {
    format: 'project10-chess-library', version: 1,
    game: { id, title: `双人对战 ${new Date().toLocaleString()}`, favorite: false, mode: 'local', configuration: { timeControl: clock.controlId }, archive, clock }, analyses: [],
  } : archive, null, 2), 'application/json')
  return <div className="chess-library-actions"><a href={GAME_ROUTES.chessLibrary} onClick={(event) => { event.preventDefault(); void openLibrary() }}>棋谱库</a><button onClick={() => void saveNow()}>手动保存</button><button onClick={() => void review()}>复盘当前对局</button><button onClick={exportNow}>导出 JSON</button><small aria-live="polite">{({ idle: '尚未保存', saving: '保存中', saved: '已保存', failed: '保存失败' } as const)[status]}</small>{error && <small role="alert">{error}</small>}</div>
}
