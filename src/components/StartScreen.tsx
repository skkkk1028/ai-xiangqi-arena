import type { EngineState } from '../hooks/useAiMatch'
import { PlayIcon } from './Icons'

interface StartScreenProps {
  onStart: () => void
  onEngineBattle: () => void
  onHumanBattle: () => void
  onRetry: () => void
  engine: EngineState
}

function progressPercent(engine: EngineState): number {
  const progress = engine.progress
  if (!progress) return 0
  if (progress.total > 0) return Math.min(100, Math.round((progress.loaded / progress.total) * 100))
  return progress.phase === 'downloading' ? 15 : 55
}

export function StartScreen({ onStart, onEngineBattle, onHumanBattle, onRetry, engine }: StartScreenProps) {
  const ready = engine.phase === 'ready'
  const failed = engine.phase === 'error' || engine.phase === 'unsupported'
  const percent = progressPercent(engine)

  return (
    <main className="landing">
      <div className="landing-grain" aria-hidden="true" />
      <header className="landing-nav">
        <a className="brand" href="#top" aria-label="AI象棋首页">
          <span className="brand-mark">弈</span>
          <span>
            <strong>AI 象棋</strong>
            <small>楚河汉界 · 智见胜负</small>
          </span>
        </a>
        <div className={`local-badge ${ready ? 'is-ready' : ''}`}>
          <i />
          {ready ? '专业 NNUE 已就绪' : '浏览器本地运算'}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">
            <span />
            MULTI-ENGINE · NNUE · UCCI / UCI
          </p>
          <h1>
            观棋不语
            <br />
            <em>强者落子</em>
          </h1>
          <p className="hero-lead">
            可观看同一满强度 Fairy-Stockfish 的风格对决，也可让两个独立 AI 引擎正面对战。
            <br />
            无服务器算力、无弱引擎回退，搜索过程真实可见。
          </p>

          <div className={`engine-loader ${failed ? 'has-error' : ''}`} aria-live="polite">
            <div className="engine-loader__top">
              <strong>
                {ready
                  ? '引擎及神经网络校验通过'
                  : failed
                    ? '专业引擎无法启动'
                    : engine.progress?.message ?? '正在检测运行环境'}
              </strong>
              {!failed && <span>{ready ? '100%' : `${percent}%`}</span>}
            </div>
            {!failed && (
              <div className="engine-loader__track">
                <span style={{ width: `${ready ? 100 : percent}%` }} />
              </div>
            )}
            <p>
              {failed
                ? engine.error
                : ready
                  ? `${engine.profile?.threads} 线程 · ${engine.profile?.hashMb} MB Hash · ${engine.profile?.network}`
                  : '首次访问会下载约 10.7 MB 的 NNUE 参数，后续由浏览器缓存。'}
            </p>
          </div>

          {failed ? (
            <button className="start-button start-button--retry" onClick={onRetry}>
              <span>重新检测</span>
            </button>
          ) : (
            <div className="mode-actions">
              <button
                className="mode-button mode-button--primary"
                aria-label="开始对弈"
                onClick={onStart}
                disabled={!ready}
              >
                <span>
                  <strong>{ready ? 'AI 人格对战' : '引擎初始化中'}</strong>
                  <small>同引擎不同风格 AI 对决</small>
                </span>
                {ready && <PlayIcon />}
              </button>
              <button className="mode-button" aria-label="AI 引擎对战 / AI 引擎大战" onClick={onEngineBattle} disabled={!ready}>
                <span>
                  <strong>AI 引擎大战</strong>
                  <small>不同 AI 引擎之间的棋力较量</small>
                </span>
                <PlayIcon />
              </button>
              <button className="mode-button mode-button--human" aria-label="真人 vs AI" onClick={onHumanBattle} disabled={!ready}>
                <span>
                  <strong>真人 vs AI</strong>
                  <small>选择颜色、引擎与难度，亲自挑战 AI</small>
                </span>
                <PlayIcon />
              </button>
            </div>
          )}
          <p className="start-note">
            <span>同配置 · 不同风格</span>
            <i />
            <span>每方 20 分钟</span>
            <i />
            <span>正常思考 12–18 秒</span>
          </p>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit--outer" />
          <div className="orbit orbit--inner" />
          <div className="mini-board">
            <div className="mini-grid" />
            <span className="mini-river">楚 河</span>
            <span className="mini-river mini-river--right">汉 界</span>
            <div className="hero-piece hero-piece--black"><span>将</span></div>
            <div className="hero-piece hero-piece--red"><span>帅</span></div>
            <span className="move-path" />
          </div>
          <div className="visual-caption visual-caption--top">
            <span>01</span>
            <p>专业 NNUE<small>固定网络与校验值</small></p>
          </div>
          <div className="visual-caption visual-caption--bottom">
            <span>02</span>
            <p>UCCI 协议<small>合法着法二次核验</small></p>
          </div>
        </div>
      </section>

      <section className="feature-strip" aria-label="项目特性">
        <article><span>壹</span><div><strong>真实深度搜索</strong><p>深度、节点、NPS、WDL 与主变化实时可见。</p></div></article>
        <article><span>贰</span><div><strong>公平棋钟</strong><p>每方 20 分钟，单步 60 秒，搜索时间计入棋钟。</p></div></article>
        <article><span>叁</span><div><strong>本机专业引擎</strong><p>同源 WASM 与 NNUE，无需购买域名或服务器。</p></div></article>
      </section>
    </main>
  )
}
