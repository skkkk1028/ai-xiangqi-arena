# 第三方许可说明

## Fairy-Stockfish

- 项目：[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)
- 作者与贡献者：Fairy-Stockfish / Stockfish contributors
- 引擎报告源码提交：`5589ea54`
- 许可证：GNU General Public License v3.0
- 本项目使用方式：未修改的 WebAssembly 二进制，通过 UCCI 协议调用
- 对应源码：
  - [Fairy-Stockfish 提交 5589ea54](https://github.com/fairy-stockfish/Fairy-Stockfish/tree/5589ea54)
  - [fairy-stockfish.wasm](https://github.com/fairy-stockfish/fairy-stockfish.wasm)
- 许可证全文：[FAIRY_STOCKFISH_GPL-3.0.txt](./FAIRY_STOCKFISH_GPL-3.0.txt)

## fairy-stockfish-nnue.wasm

- npm 包：`fairy-stockfish-nnue.wasm@1.1.11`
- 包来源：[npm](https://www.npmjs.com/package/fairy-stockfish-nnue.wasm)
- 上游源码：[fairy-stockfish.wasm](https://github.com/fairy-stockfish/fairy-stockfish.wasm)
- 许可证：GNU General Public License v3.0
- 随站点分发文件：`stockfish.js`、`stockfish.wasm`、`stockfish.worker.js`

这些运行文件由 `scripts/sync-engine-assets.mjs` 从固定 npm 依赖复制，未作修改。

## 中国象棋 NNUE 网络

- 文件：`xiangqi-c07e94a5c7cb.nnue`
- 大小：`11,261,932` 字节
- SHA-256：`c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11`
- 上游仓库：[Fairy-Stockfish-NNUE](https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE)
- 固定资源名中的前缀 `c07e94a5c7cb` 与完整 SHA-256 一致

浏览器每次初始化都会校验完整 SHA-256；校验失败或未确认 NNUE 启用时，网页会阻止开局。

## 本项目源码与修改义务

本项目没有修改 Fairy-Stockfish 引擎代码。网页集成代码、构建脚本和完整可重建源码
位于本项目公开仓库。若未来修改 GPL 引擎本身，修改后的对应源码也必须按 GPLv3
同步公开。
