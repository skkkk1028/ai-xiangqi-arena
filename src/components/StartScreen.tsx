import { PlayIcon } from './Icons'

interface StartScreenProps {
  onStart: () => void
}

export function StartScreen({ onStart }: StartScreenProps) {
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
        <div className="local-badge">
          <i />
          浏览器本地运算
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">
            <span />
            AI · XIANGQI · ARENA
          </p>
          <h1>
            观棋不语
            <br />
            <em>算法落子</em>
          </h1>
          <p className="hero-lead">
            两位均衡棋力的浏览器 AI，于楚河汉界间展开实时博弈。
            <br />
            无需联网，无需等待，只需入席。
          </p>
          <button className="start-button" onClick={onStart}>
            <span>开始对弈</span>
            <PlayIcon />
          </button>
          <p className="start-note">
            <span>双 AI 自动行棋</span>
            <i />
            <span>每方 10 分钟</span>
            <i />
            <span>单步 60 秒</span>
          </p>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit--outer" />
          <div className="orbit orbit--inner" />
          <div className="mini-board">
            <div className="mini-grid" />
            <span className="mini-river">楚 河</span>
            <span className="mini-river mini-river--right">汉 界</span>
            <div className="hero-piece hero-piece--black">
              <span>将</span>
            </div>
            <div className="hero-piece hero-piece--red">
              <span>帅</span>
            </div>
            <span className="move-path" />
          </div>
          <div className="visual-caption visual-caption--top">
            <span>01</span>
            <p>
              独立搜索线程
              <small>界面全程流畅</small>
            </p>
          </div>
          <div className="visual-caption visual-caption--bottom">
            <span>02</span>
            <p>
              完整基础棋规
              <small>合法走子判定</small>
            </p>
          </div>
        </div>
      </section>

      <section className="feature-strip" aria-label="项目特性">
        <article>
          <span>壹</span>
          <div>
            <strong>实时推演</strong>
            <p>迭代加深与剪枝搜索，每一步都看得见思考。</p>
          </div>
        </article>
        <article>
          <span>贰</span>
          <div>
            <strong>公平棋钟</strong>
            <p>总时与单步双重计时，暂停时双方同时停钟。</p>
          </div>
        </article>
        <article>
          <span>叁</span>
          <div>
            <strong>赛事裁定</strong>
            <p>将死、困毙、超时、认输与简化和棋完整收官。</p>
          </div>
        </article>
      </section>
    </main>
  )
}
