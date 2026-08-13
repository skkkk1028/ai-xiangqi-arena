# 第三方许可说明

## Obsidian 16.0

- 项目：https://github.com/gab8192/Obsidian
- 固定发布：v16.0，源码提交 `2838ce5`
- 许可证：GNU General Public License v3.0
- 可选本地竞技场安装脚本下载官方 AVX2 发布文件，并将 SHA-256 写入本地服务配置。
- 官方 `Obsidian160-avx2.exe` 固定 SHA-256：`00f9f5566e815275e29fec85f1e4d1dff0b8301ceb23f6bb79de68dcdce98743`。
- 对应源码和完整许可证可从上述官方项目及固定发布取得；仓库同时保留 `OBSIDIAN_GPL-3.0.txt` 分发说明。

## Fairy-Stockfish

- 项目：[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)
- 作者与贡献者：Fairy-Stockfish / Stockfish contributors
- 引擎报告源码提交：`5589ea54`
- 许可证：GNU General Public License v3.0
- 本项目使用方式：未修改的 WebAssembly 二进制，通过 UCCI 协议调用
- 对应源码：[Fairy-Stockfish 提交 5589ea54](https://github.com/fairy-stockfish/Fairy-Stockfish/tree/5589ea54)
- WASM 上游：[fairy-stockfish.wasm](https://github.com/fairy-stockfish/fairy-stockfish.wasm)
- 许可证全文：[FAIRY_STOCKFISH_GPL-3.0.txt](./FAIRY_STOCKFISH_GPL-3.0.txt)

运行文件来自固定 npm 包 `fairy-stockfish-nnue.wasm@1.1.11`：`stockfish.js`、
`stockfish.wasm`、`stockfish.worker.js`。`scripts/sync-engine-assets.mjs` 从固定依赖复制这些文件。

中国象棋网络 `xiangqi-c07e94a5c7cb.nnue` 为 11,261,932 字节，SHA-256 为
`c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11`。

### 标准国际象棋 NNUE

- 固定网络：`nn-3475407dc199.nnue`，47,721,371 字节（约 45.5 MiB）。
- 来源：[Stockfish NNUE 测试网络](https://tests.stockfishchess.org/api/nn/nn-3475407dc199.nnue)。
- SHA-256：`3475407dc19973ea44467678634cce023d620e419770c111cc8937fe6689ec87`。
- 该网络用于标准国际象棋 Fairy‑Stockfish UCI 会话，不与中国象棋 NNUE 混用。
- `scripts/sync-engine-assets.mjs` 将其切成三个不超过 20 MiB 的内容寻址分片；Worker 合并后再次校验完整哈希。
- 网络由 Stockfish 测试网络页面标注为可再分发；引擎代码仍受 GPLv3 约束。本项目不宣称双人格具有相等 Elo。

## chess.js

- 版本：`chess.js@1.4.0`
- 许可证：BSD-2-Clause
- 用途：标准国际象棋合法着、将军/将死、易位、吃过路兵、升变、PGN 与终局规则裁判。

## Stockfish 18 / Stockfish.js

- 浏览器包：`stockfish@18.0.8`，Nathan Rugg / Chess.com。
- 上游引擎：Stockfish 18，提交 `cb3d4ee`。
- 许可证：GNU General Public License v3.0。
- 源码：[nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) 与 [Stockfish sf_18](https://github.com/official-stockfish/Stockfish/tree/sf_18)。
- 浏览器发行物未经修改；`scripts/sync-engine-assets.mjs` 和 `scripts/verify-stockfish18.mjs` 校验固定 SHA-256。
- 生产构建在 `public/engine/STOCKFISH-18-GPL-3.0.txt` 分发完整 GPLv3 文本。

可选原生桥接使用官方 `sf_18` AVX2 发行物。安装脚本执行 UCI 版本验证，将本机二进制
SHA-256 写入 Git 忽略的 `services/stockfish-bridge/.env`，桥接每次启动前重新校验。

## Pikafish

- 项目：[official-pikafish/Pikafish](https://github.com/official-pikafish/Pikafish)
- 固定版本：`Pikafish-2026-01-02`
- 固定提交：`ce0679e00ee196f7ba17f6ec18941b9a5036f8cf`
- 许可证：GNU General Public License v3.0
- 作者名单：[PIKAFISH_AUTHORS.txt](./PIKAFISH_AUTHORS.txt)
- 许可证全文：[PIKAFISH_GPL-3.0.txt](./PIKAFISH_GPL-3.0.txt)
- NNUE 权重许可：[PIKAFISH_NNUE_LICENSE.md](./PIKAFISH_NNUE_LICENSE.md)（未经许可不得商用）
- 对应源码：[固定提交源码](https://github.com/official-pikafish/Pikafish/tree/ce0679e00ee196f7ba17f6ec18941b9a5036f8cf)
- 浏览器桥接修改与可重建参数：[third_party/pikafish](./third_party/pikafish/README.md)

本项目对上游源码增加了浏览器命令入口，使 UCI 命令能从 Web Worker 传入；没有修改搜索、
评价、棋力或着法选择逻辑。分发文件：`pikafish.js`、`pikafish.wasm`。桥接补丁以 GPLv3
随本项目公开。

随固定发行包提供的 `pikafish.nnue` 为 53,212,941 字节，SHA-256 为
`c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77`。官方发行包
`Pikafish.2026-01-02.7z` 的 SHA-256 为
`84257063905615919fb4ee6a70273a94843bb6ec04c45e3ac706098838bc1a49`。同步脚本与浏览器
初始化都会再次校验网络文件。静态站点分发时仅做字节分片以满足托管平台单文件限制，Worker
按原顺序重组，未修改权重内容。

### Pikafish 2025 固定核心

- 固定版本：`Pikafish-2025-06-23`
- 固定提交：`2b6cf79d55d9d168604cf42ce61b517653d6f2fc`
- 对应源码：[固定提交源码](https://github.com/official-pikafish/Pikafish/tree/2b6cf79d55d9d168604cf42ce61b517653d6f2fc)
- 浏览器桥接修改与可重建参数：[third_party/pikafish-2025](./third_party/pikafish-2025/README.md)

分发文件为 `pikafish-2025.js`、`pikafish-2025.wasm`，使用同一 GPLv3 与作者名单。
匹配网络 `pikafish-2025.nnue` 为 44,880,002 字节，SHA-256 为
`9b2ce59b760c26f284b9fcadd091fa789d9fd4e8c1dd71ffbd42212503a13e95`；官方发行包
`Pikafish.2025-06-23.7z` 的 SHA-256 为
`0bcca441327c547772475665fe3763fda826064411f23ad042511785c11a36b5`。浏览器桥接同样不修改
搜索、评价、棋力或着法选择逻辑。

## 源码与修改义务

上述 GPLv3 引擎的对应上游源码、项目内修改补丁、构建参数与许可证均在本说明中链接或随仓库
分发。以后若继续修改任一 GPL 引擎本身，必须同步公开对应修改源码并保留 GPLv3 权利与义务。

## Leela Zero

- 项目：[leela-zero/leela-zero](https://github.com/leela-zero/leela-zero)
- 固定发行版：`v0.17`，提交 `3f29788`
- 许可证：GNU General Public License v3.0
- 对应源码：[v0.17 source](https://github.com/leela-zero/leela-zero/tree/v0.17)
- 许可证全文：[upstream COPYING](https://github.com/leela-zero/leela-zero/blob/v0.17/COPYING)
- 最终网络来源：[Leela Zero training server](https://zero.sjeng.org/)

仓库不提交 Leela Zero 二进制或网络。`scripts/setup-leela-zero.ps1` 直接从上游下载固定文件到
Git 忽略的本地运行目录并执行 SHA-256 校验；本项目未修改 Leela Zero 搜索或网络文件，只通过
标准 GTP 命令调用。桥接服务本身为本项目代码，不把降低 KataGo 等级伪装成另一个引擎。

## Sayuri

- 项目：[CGLemon/Sayuri](https://github.com/CGLemon/Sayuri)
- 固定发行版：`v0.10.0` CUDA 12 Windows x64
- 许可证：引擎代码 GNU General Public License v3.0
- 对应源码：[v0.10.0 source](https://github.com/CGLemon/Sayuri/tree/v0.10.0)
- 许可证全文：[upstream COPYING](https://github.com/CGLemon/Sayuri/blob/v0.10.0/COPYING)

仓库不提交或打包 Sayuri 二进制、CUDA DLL 或模型。`scripts/setup-sayuri.ps1` 仅从官方发布页
和官方模型下载站获取固定文件并校验 SHA-256，保存到 Git 忽略的本地运行目录。模型没有找到
明确、独立的再分发许可，因此本项目不对其进行再分发。桥接只使用标准 GTP 命令，不修改
Sayuri 搜索或模型。
