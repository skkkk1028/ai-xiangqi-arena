# Project10 · AI 象棋竞技场

纯浏览器运行的中国象棋 AI 对战与人机对弈网页。保留同配置满强度
**Fairy-Stockfish NNUE** 风格对战和独立 Worker 运行的多引擎对战，并提供可选择
真人颜色、注册引擎与五档统一难度的**真人 vs AI** 模式；计算在访问者设备内完成，
不依赖后端、付费服务器或第三方推理 API。

## 当前能力

- 完整基础走棋、将军、将死、困毙与将帅照面规则
- `fairy-stockfish-nnue.wasm@1.1.11`，固定中国象棋 NNUE 网络
- 官方 Pikafish `Pikafish-2026-01-02`，固定发行版源码、匹配 NNUE 与可重建浏览器桥接补丁
- 可选 Pikafish `Pikafish-2025-06-23` 固定核心与匹配 NNUE；保持满强度、相同 Threads/Hash/时间控制，不以降低 Skill 制造差距
- 首页提供“AI 人格对战”“AI 引擎大战”和“真人 vs AI”三个独立入口
- 原模式使用一个持久化 Worker 轮流搜索；引擎对战模式为双方创建独立 Worker 与独立配置
- 人机模式直接复用 Engine Registry 与 EngineAdapter；支持真人红方、黑方或随机，真人不限时
- 统一难度等级 1–5 综合映射搜索时间、Hash、Threads、深度上限、MultiPV 与候选着扰动；不以降低 Skill 作为唯一降级手段
- 人机模式实时显示 AI 名称、难度、计算状态、深度、红方视角评价与本步时间，并在 Worker 异常后自动重建当前引擎
- 正常局面真实搜索约 12–18 秒；每方 20 分钟、单步最多 60 秒
- 实时显示深度、节点、NPS、普通/将杀分值、WDL 和前 6 步 PV；总评统一换算为红黑视角
- 红方按中炮 50%、仙人指路 20%、飞相 20%、其他 10% 选择开局；黑方按红方开局条件应手
- 第三阶段动态使用 `MultiPV 4/3/2`：桌面开局 4、中局 3，残局、战术重负、低时间或低资源时 2
- 人格只在同深度、动态 25/40/60/80 厘兵阈值与 20‰ WDL 安全线内生效；已识别的将军、终局、评分/WDL 急迫与一步强制应将局面始终使用第一选择
- NNUE 下载进度与 SHA-256 校验；经典评估回退时禁止开局
- 暂停、继续、新局、音效、走棋记录及终局弹窗
- 三次重复与 120 半回合无吃子的产品简化和棋
- 响应式桌面与移动端布局

> `Pikafish 2025 NNUE` 是同一引擎系列的独立固定核心配置，不是第三个引擎家族。官方 2026
> 发布测试相对 2025-06-23 在三档时间控制下提升约 22–28 Elo，因此将 2025 版作为棋力接近、
> 可审计且可在浏览器运行的新增选项；双方都保持满强度和相同资源/时间控制。

> UCCI 是通信协议，不是棋力来源。棋力来自 Fairy-Stockfish 及其 NNUE 网络。
> 浏览器设备性能不同，无法保证每台手机都达到相同搜索深度。

## 本地运行

需要支持 `SharedArrayBuffer` 的现代浏览器。开发服务器已配置 COOP/COEP：

```bash
pnpm install
pnpm dev
```

`postinstall` 会把固定 npm 包内的 Fairy WASM 运行文件同步到 `public/engine/`，并在本地
缺失时从官方网络仓库下载 Fairy NNUE。两个 Pikafish 固定版本的匹配 NNUE 随仓库分发，因为固定发行包
没有把它们作为独立下载发布。同步脚本会把 50.7 MiB（2026）和 42.8 MiB（2025）网络分别确定性拆成三个小于
Cloudflare Pages 25 MiB 单文件限制的同源分片；Worker 重组后校验原文件 SHA-256。所有网络
都会在浏览器加载时再次校验。

Windows 日常测试可直接双击 `start-local-preview.cmd`。它每次都会重新构建最新源码，再打开
`http://127.0.0.1:4173/`；如果该端口已被旧预览占用，脚本会停止并显示 PID，避免浏览器误开
旧版本。预览服务只在本机可访问，重启 Windows 后再次双击即可。

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
pnpm verify:engine
pnpm benchmark:personality
pnpm benchmark:personality-selfplay
pnpm build
pnpm build:sites
```

## Personality candidate-selection self-play A/B

`benchmark:personality-selfplay` is a whole-game, fixed-opening, color-swapped
candidate-selection A/B harness. It writes
`benchmark/personality-selfplay-result.json`. Its default is deliberately a
small smoke run; use the environment variables below for a planned longer run.
The report is explicit that the four-ply opening is a joint red/black prefix,
so it does **not** claim to measure opening-policy Elo.

```powershell
# Fast smoke check: one color-swapped pair for each of the two controls.
$env:PERSONALITY_SELFPLAY_PAIRS='1'
$env:PERSONALITY_SELFPLAY_MOVE_MS='250'
$env:PERSONALITY_SELFPLAY_MOVE_JITTER_MS='1'
pnpm benchmark:personality-selfplay

# Production-like timing, 18 fixed joint openings per control; this is long-running.
$env:PERSONALITY_SELFPLAY_PAIRS='18'
$env:PERSONALITY_SELFPLAY_MOVE_MS='12000'
$env:PERSONALITY_SELFPLAY_MOVE_JITTER_MS='6001'
$env:PERSONALITY_SELFPLAY_THREADS='2'
$env:PERSONALITY_SELFPLAY_HASH_MB='128'
$env:PERSONALITY_SELFPLAY_TEST_TIMEOUT_MS='187200000'
pnpm benchmark:personality-selfplay
```

The run keeps `Skill_Level 20`, `Use_NNUE true`, `UCI_LimitStrength false`,
Threads, Hash, and the move-budget rule equal within every game. It reports a
product reference (`MultiPV 1` + engine bestmove) and an attribution control
(the same dynamic MultiPV policy + engine bestmove). A non-inferiority claim
requires a predeclared margin (`PERSONALITY_SELFPLAY_NONINFERIORITY_MARGIN`),
a predeclared minimum pair count (`PERSONALITY_SELFPLAY_MIN_PAIRS_FOR_INFERENCE`),
and a sufficiently diverse paired sample; the smoke output is not evidence for it.
There are only 18 distinct joint-opening prefixes in this first harness (some
are mirrored). Repeating them is useful for regression but does not create
independent opening samples or an Elo/non-inferiority claim. The report keeps
`inconclusive` status for incomplete pairs and for runs with no actual
personality change; it is not allowed to turn those cases into a favourable
score. A checkpoint is written after every pair, so a long run can be inspected
or stopped without treating a partial report as a completed experiment.

`benchmark:personality` 是固定语料的候选安全回归，不是长期等级分非劣证明；真实浏览器
验收结果与人格开关 A/B harness 的限制见下方基准文档。

### Browser Worker endurance validation

`browser-validation.html` is a real Chromium/WASM Worker harness. It records
the profile, NNUE fingerprint, requested MultiPV, returned ranks, depth, wall
time, `newgame` sequencing, and main-thread frame/timer gaps. It is not a
replacement for a formal multi-device release qualification. Example:

```powershell
pnpm build:sites
pnpm preview -- --host 127.0.0.1 --port 4173
# Start Chrome with an isolated remote-debugging profile, then:
node scripts/run-browser-validation.mjs --page-url 'http://127.0.0.1:4173/browser-validation.html?long-searches=48&long-game-searches=24&probe-ms=5000' --timeout-ms 1200000 --output benchmark/browser-validation-result.json
```

Pikafish 的短冒烟验证可使用 `engine` 与 `smoke` 参数：

```powershell
node scripts/run-browser-validation.mjs --page-url 'http://127.0.0.1:4173/browser-validation.html?engine=pikafish-2026-nnue&smoke=1&probe-ms=1000&long-searches=1&long-game-searches=1' --timeout-ms 60000 --output benchmark/pikafish-browser-smoke.json
```

The checked-in result is a 48-search, approximately 13-minute desktop
2-thread/128 MB run. A formal 1,000-search or multi-device release gate still
requires the target devices and their separately recorded baselines.

## 架构

- `src/game/`：棋盘、合法着法、将军检测、记谱与裁定
- `src/engine/`：统一 `EngineAdapter`/`AIEngineConfig`、引擎注册表、DifficultyProfile、独立 UCCI 解析、人格评分、动态 MultiPV 策略与开局谱
- `public/engine/ucci.worker.js`：不绑定具体实现的 Worker 适配器宿主
- `public/engine/fairy-stockfish.adapter.js`：Fairy-Stockfish WASM/NNUE 加载、动态 MultiPV、超时保护和 UCCI 会话
- `public/engine/pikafish.adapter.js`：Pikafish WASM/NNUE 加载、标准 UCI、超时保护和新局屏障
- `src/hooks/useAiMatch.ts`：只依赖统一引擎接口的双实例生命周期、棋钟、对局状态与异常恢复协调层
- `src/hooks/useHumanVsEngine.ts`：人机回合、点击落子、难度搜索、终局裁定与单引擎 Worker 恢复协调层
- `src/components/`：棋盘、引擎面板、记录与终局界面
- `worker/static-site-worker.mjs`：生产环境 COOP/COEP/CORP 与缓存响应头

旧的自研搜索器只保留在 `src/ai/search.ts` 与相关文件中用于对比测试，
生产对局不再引用它。

## 规则、许可与公开访问

- [对局规则与裁定](./RULES.md)
- [第三方许可说明](./THIRD_PARTY_NOTICES.md)
- [Fairy-Stockfish GPLv3 全文](./FAIRY_STOCKFISH_GPL-3.0.txt)
- [Pikafish GPLv3 全文](./PIKAFISH_GPL-3.0.txt)
- [Pikafish NNUE 权重许可](./PIKAFISH_NNUE_LICENSE.md)（未经许可不得商用）
- [Pikafish 浏览器构建记录与补丁](./third_party/pikafish/README.md)
- [Pikafish 2025 浏览器构建记录与补丁](./third_party/pikafish-2025/README.md)
- [新旧引擎基准与人格候选安全回归](./benchmark/README.md)

站点公开访问仅代表其他账号可以打开并使用网页，不自动授予源码仓库或 Codex
Sites 项目的编辑权限。

## 变更记录

| 日期 | 变更内容 | 操作人 |
| --- | --- | --- |
| 2026-08-02 | 新增真人 vs AI 独立入口、配置与对局；加入五档统一难度、点击合法着法、AI 实时信息、限时搜索和 Worker 恢复回归 | Codex |
| 2026-08-02 | 通过现有注册表新增满强度 Pikafish 2025 NNUE 固定核心；复用 Worker/UCI 层并完成真实浏览器搜索回归 | Codex |
| 2026-08-01 | 编译并接入官方 Pikafish 2026 NNUE；新增双引擎选择/对战模式、独立 Worker 生命周期、红黑视角实时评价与真实浏览器冒烟验证 | Codex |
| 2026-08-01 | 增加统一引擎接口、配置、注册机制与独立 UCCI 解析器；拆分通用 Worker 宿主和 Fairy-Stockfish 适配器，保持现有 NNUE 对局行为 | Codex |
| 2026-08-01 | 补齐第三阶段候选级 A/B 安全验收：红黑均发生一次人格改选、结构化保存 1000 局面复评结果；新增一步强制应将回退保护 | Codex |
| 2026-07-30 | 完成人格化第三阶段代码：动态 MultiPV 4/3/2、细化攻守评分、连续深度候选快照、强制与超时保护；加入确定性深搜安全回归代理 | Codex |
| 2026-07-30 | 完成人格化第二阶段：MultiPV 3 候选解析、动态 25/40/60/80 厘兵阈值、WDL 与强制局面保护、1000 局面安全基准 | Codex |
| 2026-07-30 | 完成人格化第一阶段：红方加权进攻开局、黑方条件稳健应手、人格与开局展示；保持 MultiPV 1 和满强度引擎第一选择 | Codex |
| 2026-07-29 | 完成100盘新旧引擎基准；2026-07-30 复测为99胜1和0负、非法着法0 | Codex |
| 2026-07-29 | 改用 Cloudflare Pages 公开部署配置，保留 NNUE 所需 COOP/COEP 响应头；GitHub Actions 改为构建验证 | Codex |
| 2026-07-29 | 用 Fairy-Stockfish NNUE + UCCI 替换生产对局 AI，加入真实搜索信息、资源校验、跨源隔离与公开部署配置 | Codex |
| 2026-07-29 | 提亮首页；增强旧自研搜索并延长思考时间 | Codex |
| 2026-07-29 | 项目创建并完成首版实现 | Codex |
