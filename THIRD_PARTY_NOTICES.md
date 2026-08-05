# 第三方许可说明

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
