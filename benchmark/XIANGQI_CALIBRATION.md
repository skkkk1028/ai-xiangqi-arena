# 中国象棋三引擎校准运行手册

本工具只测量项目内中国象棋引擎的相对棋力，不输出或推断人类等级分。仓库中的强度矩阵默认保持 `provisional`；只有新的正式报告完整通过 ±30 Elo、运行稳定性和延迟门槛后，才能把对应格子改成 `validated`。

## 六小时快速工程校准

快速流程只运行桌面画像（2 线程、128 MB），使用 200–300 ms/步代理 AI 引擎大战的 12–18 秒/步。它适合在数小时内筛选参考引擎和资源乘数，但不能证明高深度生产对局保持相同排名，也不能写入 `validated`。

准备最新构建、Vite preview 和独立 Chromium 后运行：

```powershell
npm run benchmark:xiangqi:calibration:quick
```

该命令会在六小时硬上限内串行执行：生成并冻结 220 个快速开局、三组 20→50 对自适应基线、明显弱引擎的 MultiPV/时间与节点探测、独立复测和 L1–L4 固定局面延迟门槛。每个换色对后保存 IndexedDB 检查点。完整复测通过时，命令使用 `--apply` 更新 `src/games/xiangqi/quick-calibration.generated.json`；否则保留现有生产参数。

一对棋全流程烟雾命令：

```powershell
npm run benchmark:xiangqi:calibration:quick:smoke
```

快速报告包含 `evidenceTier: quick`、实际耗时、停止原因、暂定参考或共同领先者、调参前后得分和发布结果。进入 ±50 Elo 点估计且区间包含 0 的候选仍只能标记为 `provisional`；只改善但未拉齐的候选标记为 `unmatched`。若没有单一参考或独立复测未完成，不修改强度矩阵。

### 当前短样本证据（截至 2026-09-13）

本轮本地快速 smoke 在约 11.4 分钟内完成，但每个基线、调参和复测任务都只有 1 个换色对。报告中的 95% Elo 区间均为无界值，结论字段为 `smoke-reference`，并明确说明固定参考席位只验证流程。另一次矩阵 smoke 也只覆盖 `human-l1` 的 constrained/desktop 两个画像，每个对阵 1 个换色对；两个画像均为 `insufficient-evidence`。

因此这些结果只确认开局语料、三引擎换色、检查点、延迟探针和报告链路可以运行。`quick-calibration.generated.json` 保持空覆盖，生产难度档位和 12–18 秒引擎大战预算均保留暂定值；不能据此宣称 Pikafish 2026 已验证领先、任意两引擎等强，或给出可迁移 Elo。

2026-09-12/13 又运行了每项 8 对的 L1 基线和每项 8/16 对的节点探测，但它们使用
`standard` 证据层和内置 12 个非正式开局前缀，不符合本节 quick 协议的冻结 220 局面及
独立分区要求。所有换色对置信区间仍无界，且有一项延迟门槛失败；完整边界、参数和复现入口见
[`XIANGQI_CALIBRATION_20260912.md`](./XIANGQI_CALIBRATION_20260912.md)。这些结果同样不产生 quick 覆盖。

## 运行前提

1. 构建并启动最新 Vite preview，地址默认为 `http://127.0.0.1:4173`。
2. 使用固定版本 Chromium，以独立用户目录、`--remote-debugging-port=9222`、`--remote-allow-origins=*` 启动。
3. 校准期间不要在同一设备并行运行其他校准任务；矩阵 CLI 固定串行执行。

## 冻结正式开局语料

```powershell
node scripts/calibrate-xiangqi-strength.mjs `
  --generate-corpus public/calibration/xiangqi-openings-v1.json `
  --opening-count 800 `
  --generation-nodes 10000
```

语料生成器在每个局面的扩展过程中轮换使用 Fairy-Stockfish、Pikafish 2026 和 Pikafish 2025，从 MultiPV 候选中按确定性种子选着，并由三个引擎共同执行末端平衡筛选。生成后会验证 8–20 半回合、合法性、非终局、非将军、position key、序列及镜像唯一性，并冻结 SHA-256。

800 个默认位置分为：前 200 个供调参、从偏移 200 开始的 500 个供正式认证，其余为整对失效后的替补。

## 当前配置基线

以下命令依次运行三个对阵、六个场景、两个资源画像。每个换色对完成后写入浏览器 IndexedDB 检查点；同一参数重新运行会从已完成对局对恢复。

```powershell
node scripts/calibrate-xiangqi-strength.mjs `
  --matrix `
  --scenario all `
  --profiles all `
  --run-stage baseline `
  --pairs 500 `
  --corpus-url /calibration/xiangqi-openings-v1.json `
  --keep-going
```

报告目录包含 `manifest.json`、每个对阵的完整 JSON 和逐局 `games.jsonl`。`manifest.json` 按场景和画像给出唯一领先者或统计共同领先者；不得从未完成任务或点估计强行指定冠军。

## 只增强调参

等级 1–4 先使用 25–50 对进行节点倍增探测，再在包围目标的两个预算间使用几何中点二分。CLI 的 `--engine-nodes` / `--opponent-nodes` 会拒绝低于现有档位的预算，节点硬上限为 5,000,000。

```powershell
node scripts/calibrate-xiangqi-strength.mjs `
  --engine fairy-stockfish-nnue `
  --opponent pikafish-2026-nnue `
  --scenario human-l2 `
  --profiles constrained `
  --run-stage tuning `
  --pairs 50 `
  --corpus-url /calibration/xiangqi-openings-v1.json `
  --engine-nodes 200000
```

大师级和引擎大战先用 `--force-multipv 1`，再只提高较弱引擎的 `--engine-budget-ms`。大师级最多 60 秒；引擎大战最多 55 秒且不得超过原基础预算三倍。调参阶段最多 200 对，不能作为正式认证证据。

## 正式认证

冻结候选参数后使用独立开局子集和新种子：

```powershell
node scripts/calibrate-xiangqi-strength.mjs `
  --engine fairy-stockfish-nnue `
  --opponent pikafish-2026-nnue `
  --scenario human-l2 `
  --profiles constrained `
  --run-stage formal `
  --pairs 500 `
  --opening-offset 200 `
  --seed 2981215073 `
  --corpus-url /calibration/xiangqi-openings-v1.json `
  --engine-nodes 200000
```

只有换色对置信序列的完整 95% Elo 区间位于 `[-30,+30]`、没有未恢复技术失败/非法着法/搜索超时、没有 600 半回合未终局对局，并通过该档 P95 延迟门槛时，才能发布 `validated`。否则应写入 `unmatched`，继续显示“当前设备下未与最强引擎完全拉齐”。

仓库中的 `xiangqi-calibration-v2-smoke.json` 只证明校准页、两个协议 Worker、遥测和换色流程可以运行；一对棋不构成棋力结论。
