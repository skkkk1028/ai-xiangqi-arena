# Project10-AI象棋

## 项目目标

构建一个纯浏览器运行的中国象棋 AI 对 AI 观战网页。双方 AI 自动思考和走子，页面提供棋钟、着法记录、暂停、新局与终局裁定。

## 项目范围

- 完整基础走棋规则、将军、将死和困毙判定
- Web Worker 中运行的迭代加深 Alpha-Beta 搜索
- 每方 10 分钟总时与单步 60 秒上限
- 自动认输、三次重复及 120 半回合无吃子和棋
- 响应式桌面与移动端观战界面
- 不包含人类走棋、联网房间、账号、排行榜或第三方高强度引擎

## 本地运行

```bash
pnpm install
pnpm dev
```

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm build
```

公共生产构建位于 `.vite-output/`，也是 GitHub Pages 使用的纯静态发布目录；推送到 `main` 后会自动测试、构建并发布。

如需部署到 Codex Sites，先在当前账号下创建 `.openai/hosting.json`，再执行 `pnpm build:sites`。站点绑定文件只保留在本机，不进入公共仓库，避免其他账号克隆后错误绑定到无权限的旧站点。

## 架构

- `src/game/`：棋盘模型、合法着法、将军检测和记谱
- `src/ai/`：局面评估、迭代加深搜索及 Web Worker
- `src/hooks/useAiMatch.ts`：棋钟、对局状态与终局裁定
- `src/components/`：棋盘、选手、记录与终局界面
- `src/test/`：规则、AI 和界面测试

## 规则说明

详细规则和产品简化边界参见 [RULES.md](./RULES.md)。

## 关键里程碑

- [x] 项目初始化
- [x] 规则引擎与 AI 搜索
- [x] 观战界面与棋钟
- [x] 自动裁定与测试
- [x] 生产构建与 Sites 部署准备

## 变更记录

| 日期 | 变更内容 | 操作人 |
| --- | --- | --- |
| 2026-07-29 | 项目创建并完成首版实现 | Codex |
