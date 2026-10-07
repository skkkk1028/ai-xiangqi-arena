import { useEffect, useState } from 'react'
import { downloadGoFile, goLibrary, parseGoLibraryFile, type GoLibraryGame } from './library'
import { exportGoSgf, restoreGoArchive } from './sgf'
import './study.css'

export function GoLibraryPanel({ current, onOpen, onClose }: { current: GoLibraryGame; onOpen: (game: GoLibraryGame) => void; onClose: () => void }) {
  const [games, setGames] = useState<GoLibraryGame[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const refresh = async () => setGames(await goLibrary.list())
  const perform = async (job: () => Promise<void>) => {
    setPending(true); setError(null)
    try { await job(); await refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : '棋谱库操作失败。') }
    finally { setPending(false) }
  }
  useEffect(() => {
    let active = true
    void (async () => {
      try { await goLibrary.migrateLatest() } catch (caught) { if (active) setError(`旧棋谱迁移未完成：${caught instanceof Error ? caught.message : String(caught)}`) }
      try { const list = await goLibrary.list(); if (active) setGames(list) } catch (caught) { if (active) setError(`棋谱库无法读取：${caught instanceof Error ? caught.message : String(caught)}`) }
    })()
    return () => { active = false }
  }, [])
  return <main className="go-study">
    <header><div><p>本机棋谱库</p><h1>每一局，都可以再走一次</h1></div><button onClick={onClose}>返回当前对局</button></header>
    <p>仅保存在当前浏览器和站点地址；清除站点数据会删除记录，请导出文件备份。旧对局已经暂停。</p>
    <div className="go-study-actions">
      <button disabled={!current.archive.moves.length || pending} onClick={() => void perform(() => goLibrary.save(current))}>保存当前棋局</button>
      <button disabled={!current.archive.moves.length} onClick={() => onOpen(current)}>复盘当前棋局</button>
      <button disabled={!current.archive.moves.length} onClick={() => downloadGoFile('go-current.json', JSON.stringify(current.archive, null, 2))}>下载当前棋局备份</button>
      <label>导入 JSON / SGF<input aria-label="导入棋谱文件" type="file" accept=".json,.sgf" disabled={pending} onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void perform(async () => { await goLibrary.import(parseGoLibraryFile(await file.text())) })
      }} /></label>
    </div>
    {error && <p role="alert">{error} 当前对局仍保留，可以下载备份。</p>}
    {pending && <p role="status">正在保存棋谱库…</p>}
    {!games.length && <p>还没有已保存棋局。完成第一手后会自动保存。</p>}
    <div className="go-library-list">{games.map((game) => <section key={game.id}>
      {editing === game.id ? <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) void perform(async () => { await goLibrary.update(game.id, { title: title.trim(), favorite: game.favorite }); setEditing(null) }) }}><input aria-label="棋局名称" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /><button disabled={pending}>保存名称</button><button type="button" onClick={() => setEditing(null)}>取消</button></form> : <h2>{game.favorite ? '★ ' : ''}{game.title}</h2>}
      <p>{game.archive.players.map((player) => player.name).join(' vs ')} · {game.mode} · {game.archive.moves.length} 手</p>
      <p>{new Date(game.archive.createdAt).toLocaleString()} · {game.archive.status === 'finished' ? `已结束 · ${game.archive.result?.winner === 'black' ? '黑胜' : game.archive.result?.winner === 'white' ? '白胜' : '和棋'} ${game.archive.result?.margin ?? ''}` : game.archive.status === 'review' ? '计分待确认' : '未结束'}</p>
      {game.source && <p>练习来源：{games.find((entry) => entry.id === game.source!.gameId)?.title ?? game.source.gameId} · 已走 {game.source.moveNumber} 手的局面</p>}
      <div className="go-study-actions">
        <button onClick={() => onOpen(game)}>打开复盘</button>
        <button disabled={pending} onClick={() => { setEditing(game.id); setTitle(game.title) }}>重命名</button>
        <button disabled={pending} onClick={() => void perform(() => goLibrary.update(game.id, { title: game.title, favorite: !game.favorite }))}>{game.favorite ? '取消收藏' : '收藏'}</button>
        <button disabled={pending} onClick={() => void perform(async () => downloadGoFile('go-study.json', JSON.stringify({ format: 'project10-go-library', version: 1, game, analyses: await goLibrary.analyses(game.id) }, null, 2)))}>导出 JSON（含分析）</button>
        <button onClick={() => downloadGoFile('go-game.sgf', exportGoSgf(restoreGoArchive(game.archive)), 'application/x-go-sgf')}>导出 SGF</button>
        <button disabled={pending || game.id === current.id} title={game.id === current.id ? '当前对局仍在自动保存，请新开一局后删除' : undefined} onClick={() => setDeleteId(game.id)}>删除</button>
      </div>
      {deleteId === game.id && <div role="alert">删除此局及其分析？已另存的练习局保留。<button disabled={pending} onClick={() => void perform(async () => { await goLibrary.remove(game.id); setDeleteId(null) })}>确认删除</button><button onClick={() => setDeleteId(null)}>保留</button></div>}
    </section>)}</div>
  </main>
}
