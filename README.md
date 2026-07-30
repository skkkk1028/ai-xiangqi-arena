# Project10 · AI 象棋竞技场

纯浏览器运行的中国象棋 AI 对 AI 观战网页。双方均使用同配置的
**Fairy-Stockfish NNUE**，通过 **UCCI** 文本协议行棋；计算在访问者设备内完成，
不依赖后端、付费服务器或第三方推理 API。

## 当前能力

- 完整基础走棋、将军、将死、困毙与将帅照面规则
- `fairy-stockfish-nnue.wasm@1.1.11`，固定中国象棋 NNUE 网络
- 一个持久化 Web Worker 轮流为红黑双方搜索
- 正常局面真实搜索约 12–18 秒；每方 20 分钟、单步最多 60 秒
- 实时显示深度、节点、NPS、普通/将杀分值、WDL 和前 6 步 PV
- NNUE 下载进度与 SHA-256 校验；经典评估回退时禁止开局
- 暂停、继续、新局、音效、走棋记录及终局弹窗
- 三次重复与 120 半回合无吃子的产品简化和棋
- 响应式桌面与移动端布局

> UCCI 是通信协议，不是棋力来源。棋力来自 Fairy-Stockfish 及其 NNUE 网络。
> 浏览器设备性能不同，无法保证每台手机都达到相同搜索深度。

## 本地运行

需要支持 `SharedArrayBuffer` 的现代浏览器。开发服务器已配置 COOP/COEP：

```bash
pnpm install
pnpm dev
```

`postinstall` 会把固定 npm 包内的 WASM 运行文件同步到 `public/engine/`，并在本地
缺失时从官方网络仓库下载 NNUE。下载结果必须通过固定 SHA-256，生产构建会把验证
后的 NNUE 作为同源静态资源分发。

Windows 日常测试可直接双击 `start-local-preview.cmd`。它会在首次缺少生产构建时
自动构建，再打开 `http://127.0.0.1:4173/`；预览服务只在本机可访问，重启 Windows 后
再次双击即可。

## 公开部署（Cloudflare Pages）

本项目不能使用 GitHub Pages 作为专业引擎的生产托管：该平台不能为静态响应配置
COOP/COEP，而 `SharedArrayBuffer` 与跨源隔离是 Fairy-Stockfish 多线程 WASM 的必需
条件。仓库内的 GitHub Actions 只负责验证构建，不再部署 Pages。

推荐使用免费的 Cloudflare Pages Direct Upload。项目已提供 `public/_headers`，Vite 构建时
会将它复制到 `.vite-output/_headers`，以同源设置 COOP、COEP 和 CORP。

最简单的首次发布方式是在已经登录 Cloudflare 的浏览器中打开 **Workers & Pages**，选择
**Create application > Get started > Drag and drop your files**，项目名填
`ai-xiangqi-arena-public`，并上传整个 `.vite-output` 文件夹。该文件夹已经是完整生产
构建，不需要再次压缩或修改。

若在普通本机终端中已成功完成 Wrangler 登录，也可使用命令行首次部署：

```text
pnpm dlx wrangler login --use-keyring
pnpm dlx wrangler pages project create ai-xiangqi-arena-public --production-branch main
pnpm build
pnpm dlx wrangler pages deploy .vite-output --project-name ai-xiangqi-arena-public --branch main
```

之后可直接双击 `deploy-cloudflare.cmd` 重新发布，或在 Cloudflare 控制台中创建新的拖拽
部署。首次发布后，访问 Cloudflare 输出的
`https://<你的项目>.pages.dev`，确认响应头包含
`Cross-Origin-Opener-Policy: same-origin` 与
`Cross-Origin-Embedder-Policy: require-corp`，再开始对局。

Direct Upload 项目不能切换为 Git 自动部署；若未来需要“推送 GitHub 后自动发布”，请新建
一个 Cloudflare Pages Git Integration 项目，而不要转换当前项目。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:sites
```

## 架构

- `src/game/`：棋盘、合法着法、将军检测、记谱与裁定
- `src/engine/`：UCCI 解析、浏览器兼容检测、引擎客户端与开局前缀
- `public/engine/ucci.worker.js`：WASM/NNUE 加载、校验和 UCCI 会话
- `src/hooks/useAiMatch.ts`：棋钟、持久化引擎、对局状态与异常恢复
- `src/components/`：棋盘、引擎面板、记录与终局界面
- `worker/static-site-worker.mjs`：生产环境 COOP/COEP/CORP 与缓存响应头

旧的自研搜索器只保留在 `src/ai/search.ts` 与相关文件中用于对比测试，
生产对局不再引用它。

## 规则、许可与公开访问

- [对局规则与裁定](./RULES.md)
- [第三方许可说明](./THIRD_PARTY_NOTICES.md)
- [Fairy-Stockfish GPLv3 全文](./FAIRY_STOCKFISH_GPL-3.0.txt)
- [100盘新旧引擎回归基准](./benchmark/README.md)

站点公开访问仅代表其他账号可以打开并使用网页，不自动授予源码仓库或 Codex
Sites 项目的编辑权限。

## 变更记录

| 日期 | 变更内容 | 操作人 |
| --- | --- | --- |
| 2026-07-29 | 完成100盘新旧引擎基准：98胜2和0负、非法着法0 | Codex |
| 2026-07-29 | 改用 Cloudflare Pages 公开部署配置，保留 NNUE 所需 COOP/COEP 响应头；GitHub Actions 改为构建验证 | Codex |
| 2026-07-29 | 用 Fairy-Stockfish NNUE + UCCI 替换生产对局 AI，加入真实搜索信息、资源校验、跨源隔离与公开部署配置 | Codex |
| 2026-07-29 | 提亮首页；增强旧自研搜索并延长思考时间 | Codex |
| 2026-07-29 | 项目创建并完成首版实现 | Codex |
