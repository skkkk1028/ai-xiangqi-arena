# 中国象棋 L1 短样本证据（2026-09-12/13）

## 结论边界

这批本地浏览器结果只支持两个可复核结论：校准链路在 13 个任务中产出了 128 个有效换色对，
以及所列单机条件下的描述性胜和负与 P95 延迟。它不验证人类或可迁移 Elo、不证明任意两个
引擎强度匹配，也没有识别出唯一领先者。所有任务的换色对置信序列 95% Elo 区间均为无界
`[null,null]`，任务摘要的停止原因均为 `insufficient-evidence`；基线矩阵结论也是
`insufficient-evidence`，节点探测 manifest 的汇总结论为 `incomplete`。正式门槛是独立冻结
语料上的 500 个有效换色对、完整区间位于 `[-30,+30]`、通过运行与延迟门槛。

文件名中的 `verify` 只是当时的输出标签。报告实际记录为 `runStage=tuning`，而且全部结果均为
`evidenceTier=standard`、`human-l1`、`openingOffset=0`，使用
`built-in-12-prefixes-nonformal`。因此它们既不是 formal 认证，也不是当前六小时 quick 协议的
独立复测，不能写入 `quick-calibration.generated.json`；该文件保持空覆盖与 `provisional` 档位是
一致且必要的。

与 `calibration-quick.ts` 的当前快速配置对照如下：quick 只允许 desktop，使用冻结的 220 个
局面并把基线、调参、两组复测和替补开局分区隔离；基线为 20 对起、最多 50 对，调参 10 对，
复测 20 对（必要时 25 对），总时限 360 分钟，代理思考时间 200–300 ms。这里的 standard
8/16 对结果没有采用这些样本量、证据层或开局隔离约束，不能替代 quick 结果，也不能触发
`--apply`。

## 固定输入

- 仓库 commit：`401ef5c83992ed4cf472530202c63edb720e20d9`（2026-09-11 22:02:41 +08:00）。
- Pikafish 2026：`Pikafish-2026-01-02`，commit `ce0679e00ee196f7ba17f6ec18941b9a5036f8cf`，
  WASM SHA-256 `1233b07cbc741faac3e8251f91b8c74b048938a62bd3a01535bfd1d8b3907e12`，
  NNUE SHA-256 `c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77`。
- Pikafish 2025：`Pikafish-2025-06-23`，commit `2b6cf79d55d9d168604cf42ce61b517653d6f2fc`，
  WASM SHA-256 `f69321101d5dc8f8228f1ddc51abee0838f5f59d632fe4672623cc41538d282c`，
  NNUE SHA-256 `9b2ce59b760c26f284b9fcadd091fa789d9fd4e8c1dd71ffbd42212503a13e95`。
- Fairy-Stockfish：`fairy-stockfish-nnue.wasm@1.1.11`，commit `5589ea54`，
  WASM SHA-256 `91f78f226169ae0e08be3854e0b4de8f5461844d38f08eaae8e3f8ee0833831d`，
  NNUE SHA-256 `c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11`。
- 两组均为 600 半回合上限、相同开局换色、串行任务；constrained 为 1 线程/64 MB，desktop
  为 2 线程/128 MB。L1 基线双方均为 30k 节点；节点探测只提高候选方，Fairy-Stockfish
  对手仍使用 L1 的 30k 节点。报告未记录浏览器版本、CPU、系统负载或机器标识，因此延迟只能
  解释为该次运行的单机观测，不能外推到其他设备。

## 基线矩阵

`xiangqi-calibration-minimal-20260912` 从 2026-09-12 02:46:25Z 至 03:17:26Z 运行。每行均为
8 对/16 盘、seed `1831565813`、双方 30k 节点；胜/和/负按表中左侧引擎计。六项均为 0 个
无效对、0 个未恢复技术失败、0 超时、0 半回合上限，P95 门槛为 3000 ms。

| 画像 | 对阵 | 胜/和/负 | P95 延迟 | 延迟门槛 |
| --- | --- | ---: | ---: | --- |
| constrained | Pikafish 2026 vs Pikafish 2025 | 10/1/5 | 279 ms | 通过 |
| constrained | Pikafish 2026 vs Fairy-Stockfish | 3/2/11 | 269 ms | 通过 |
| constrained | Pikafish 2025 vs Fairy-Stockfish | 2/0/14 | 254 ms | 通过 |
| desktop | Pikafish 2026 vs Pikafish 2025 | 8/3/5 | 119 ms | 通过 |
| desktop | Pikafish 2026 vs Fairy-Stockfish | 2/1/13 | 122 ms | 通过 |
| desktop | Pikafish 2025 vs Fairy-Stockfish | 1/1/14 | 114 ms | 通过 |

复现入口（需要先按主运行手册启动 Vite preview 和独立 Chromium）：

```powershell
pnpm benchmark:xiangqi:calibration -- --matrix --scenario human-l1 --profiles all `
  --run-stage baseline --pairs 8 --nodes 30000 --max-plies 600 --seed 1831565813 `
  --keep-going --output benchmark/xiangqi-calibration-minimal-20260912
```

## desktop 节点探测

以下每项均为 Pikafish 候选方对 Fairy-Stockfish，L1、2 线程/128 MB、600 半回合上限、
`runStage=tuning`。0 个最终无效对、0 个未恢复失败、0 超时、0 半回合上限；胜/和/负按候选方计。

| 输出 | 候选节点 | seed | 样本 | 胜/和/负 | P95 延迟 | 运行备注 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `tune-pf25-480k-desktop` | 480k | 1831565813 | 8 对/16 盘 | 7/0/9 | 1910 ms | 通过延迟门槛 |
| `tune-pf26-240k-desktop` | 240k | 1831565813 | 8 对/16 盘 | 6/1/9 | 1217 ms | 通过延迟门槛 |
| `tune-pf26-340k-desktop` | 340k | 1831565813 | 8 对/16 盘 | 7/1/8 | 1456 ms | 通过延迟门槛 |
| `tune-pf26-480k-desktop` | 480k | 1831565813 | 8 对/16 盘 | 3/1/12 | 2158 ms | 通过延迟门槛 |
| `verify-pf25-480k-desktop` | 480k | 2981215073 | 16 对/32 盘 | 11/3/18 | 3268 ms | 延迟失败；12 盘技术失败后恢复，22 次配对尝试 |
| `verify-pf26-240k-desktop` | 240k | 2981215073 | 16 对/32 盘 | 12/0/20 | 1083 ms | 通过延迟门槛 |
| `verify-pf26-340k-desktop` | 340k | 2981215073 | 16 对/32 盘 | 9/2/21 | 1595 ms | 通过延迟门槛 |

复现模板；将尖括号参数替换为表中值。`--output` 应使用对应输出名并加 `.json`：

```powershell
pnpm benchmark:xiangqi:calibration -- --engine <pikafish-engine-id> `
  --opponent fairy-stockfish-nnue --scenario human-l1 --profile desktop `
  --run-stage tuning --pairs <8-or-16> --engine-nodes <nodes> --max-plies 600 `
  --seed <seed> --opening-offset 0 --output benchmark/xiangqi-balance-20260912/<output>.json
```

`verify-pf26-240k-constrained.json.games.jsonl` 是 0 字节残留，没有对应报告或 manifest，不构成
任何证据。240k、340k、480k 结果也不呈现稳定单调关系；结合样本少、开局复用和置信区间无界，
不应从点估计挑选“最佳节点数”或声称已经强度匹配。

## 原始文件与复核

两个本地目录共 40.71 MiB；逐局 JSONL 为 12.34 MiB，完整 JSON 又内嵌 28.33 MiB 的逐局数据。
它们由 `.gitignore` 排除，仅提交本摘要。用于提取上表的 manifest SHA-256 为：

```text
380db27ad94ef1bb5101798c8fe67d2e322b5c45ab4f088e0da9cb23e2171197  xiangqi-calibration-minimal-20260912/manifest.json
2d292471bf2261c19aade87a4cbf25307cdce85d39ae5572e61d38fd1e653a8e  xiangqi-balance-20260912/tune-pf25-480k-desktop.json.manifest.json
6725f45c6c3e0bb51213399ff014414c16f100e0ddee99e21fe91123c5e4ed0b  xiangqi-balance-20260912/tune-pf26-240k-desktop.json.manifest.json
94271dd948cfda80aafc6f85c15b45ecda110b01c21f9bedca2b6d77f73c37e3  xiangqi-balance-20260912/tune-pf26-340k-desktop.json.manifest.json
544cada21c83403c4e6ce5faadb396995be60a91160ff3535fddb8ecb9c2f837  xiangqi-balance-20260912/tune-pf26-480k-desktop.json.manifest.json
1ccbe95817a6133f034a1a9eb61a67089285c89deb54a54fe0fcfdf1d06d6620  xiangqi-balance-20260912/verify-pf25-480k-desktop.json.manifest.json
4eb773bf1bb442fa242688f06a720942f58a03bf3f97b6e13927a61c22880add  xiangqi-balance-20260912/verify-pf26-240k-desktop.json.manifest.json
227207ce9abe164db0bd741d3866947cf996c3c9563a6b01e21282cf99df2069  xiangqi-balance-20260912/verify-pf26-340k-desktop.json.manifest.json
```

这些哈希用于核对本地源文件，不表示重新运行会生成字节相同的 manifest（时间戳和绝对输出路径会变化）。
