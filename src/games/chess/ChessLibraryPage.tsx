import { Chess } from 'chess.js'
import { useEffect, useState, type ChangeEvent } from 'react'
import { GAME_ROUTES } from '../routes'
import { readChessLiveReturn } from './live-return'
import { exportChessPgn, restoreChessArchive } from './archive'
import { chessLibrary, importChessPgn, parseChessLibraryJson, type ChessLibraryGameV1 } from './library'

export function downloadChessFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function exportLibraryPgn(game: ChessLibraryGameV1): string {
  const chess = new Chess()
  chess.loadPgn(exportChessPgn(restoreChessArchive(game.archive)))
  chess.setHeader('White', game.archive.players.find((player) => player.seat === 'w')?.name ?? 'White')
  chess.setHeader('Black', game.archive.players.find((player) => player.seat === 'b')?.name ?? 'Black')
  chess.setHeader('Event', game.title)
  const clock = game.clock?.result
  if (clock) {
    chess.setHeader('Result', clock.winner === 'w' ? '1-0' : '0-1')
    chess.setHeader('Termination', clock.reason === 'total-timeout' ? 'time forfeit' : 'move time forfeit')
  } else if (game.declaredResult) {
    chess.setHeader('Result', game.declaredResult.token)
    chess.setHeader('Termination', game.declaredResult.termination)
  }
  return chess.pgn({ newline: '\n' })
}

function gameResultLabel(game: ChessLibraryGameV1): string {
  if (game.clock?.result) return `${game.clock.result.winner === 'w' ? '白方' : '黑方'}胜 · ${game.clock.result.reason === 'total-timeout' ? '总时超时' : '单步超时'}`
  if (game.archive.result) {
    const winner = game.archive.result.winner
    return `${winner === 'w' ? '白方胜' : winner === 'b' ? '黑方胜' : '和棋或技术停止'} · ${String(game.archive.result.reason)}`
  }
  if (game.declaredResult) return `PGN 声明 ${game.declaredResult.token}`
  return '进行中'
}

const MODE_LABEL: Record<ChessLibraryGameV1['mode'], string> = { theatre: '观战剧场', arena: '竞技场', human: '人机对战', local: '本地双人', practice: '练习', import: '导入' }

export function ChessLibraryPage() {
  const liveReturn = readChessLiveReturn()
  const [games, setGames] = useState<ChessLibraryGameV1[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = () => chessLibrary.list().then(setGames, (reason) => setError(String(reason))).finally(() => setLoading(false))
  useEffect(() => { void chessLibrary.migrateLatest().then(refresh, (reason) => { setError(String(reason)); setLoading(false) }) }, [])
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      if (file.name.toLowerCase().endsWith('.pgn')) {
        await chessLibrary.save(importChessPgn(text))
      } else {
        await chessLibrary.import(parseChessLibraryJson(text))
      }
      setError(null)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    event.target.value = ''
  }
  const update = async (game: ChessLibraryGameV1, changes: Partial<Pick<ChessLibraryGameV1, 'title' | 'favorite'>>) => {
    try { await chessLibrary.update(game.id, changes); await refresh() }
    catch (reason) { setError(String(reason)) }
  }
  const remove = async (game: ChessLibraryGameV1) => {
    if (!window.confirm(`删除“${game.title}”及其分析结果？`)) return
    try { await chessLibrary.remove(game.id); await refresh() }
    catch (reason) { setError(String(reason)) }
  }
  const exportJson = async (game: ChessLibraryGameV1) => {
    try {
      const analyses = await chessLibrary.analyses(game.id)
      downloadChessFile(`${game.title}.json`, JSON.stringify({ format: 'project10-chess-library', version: 1, game, analyses }, null, 2), 'application/json')
    } catch (reason) { setError(String(reason)) }
  }
  return <main className="chess-page chess-study-page">
    <header className="chess-header"><a className="chess-back" href={GAME_ROUTES.chess}>← 国际象棋模式</a><div className="chess-brand"><span>♙</span><div><strong>国际象棋棋谱库</strong><small>LOCAL LIBRARY</small></div></div></header>
    <section className="chess-library-content">
      <div className="chess-study-toolbar"><h1>本机棋谱</h1>{liveReturn?.mode === 'theatre' && liveReturn.phase === 'resume' && <a href={GAME_ROUTES.chessTheatre}>返回观战对局</a>}<label className="chess-button">导入 JSON / PGN<input type="file" accept=".json,.pgn,application/json" onChange={importFile} hidden /></label></div>
      <p>棋谱保存在当前浏览器和站点地址。清除站点数据会删除记录；请用 JSON 导出备份。</p>
      {error && <p role="alert">{error}</p>}
      {loading && <p>正在读取棋谱库…</p>}
      {!loading && games.length === 0 && <p>尚无保存的棋局。进入任一模式开始对局，或导入棋谱。</p>}
      <div className="chess-library-list">{games.map((game) => <article className="chess-library-card" key={game.id}>
        <div><a href={`${GAME_ROUTES.chessStudy}/${encodeURIComponent(game.id)}`}>{game.title}</a><p>{new Date(game.archive.updatedAt).toLocaleString()} · {MODE_LABEL[game.mode]} · {game.archive.players.map((player) => player.name).join(' / ')} · {game.archive.moves.length} 手 · {gameResultLabel(game)}{game.source ? ` · 来源第 ${game.source.ply} 手` : ''}</p></div>
        <div className="chess-study-actions"><button onClick={() => void update(game, { favorite: !game.favorite })}>{game.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button onClick={() => { const title = window.prompt('棋谱名称', game.title)?.trim(); if (title) void update(game, { title }) }}>重命名</button><button onClick={() => void exportJson(game)}>JSON</button><button onClick={() => downloadChessFile(`${game.title}.pgn`, exportLibraryPgn(game), 'application/x-chess-pgn')}>PGN</button><button onClick={() => void remove(game)}>删除</button></div>
      </article>)}</div>
    </section>
  </main>
}
