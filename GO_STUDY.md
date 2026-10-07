# 围棋保存、复盘与重试

围棋页面顶部的“棋谱库 / 复盘”进入本机棋谱库。已有 AI 对局先暂停并释放引擎；返回后手动继续。

- 落子后自动保存，同一局使用稳定 ID。棋谱库支持重命名、收藏、删除、JSON/SGF 导入导出。保存失败会显示错误，内存棋局仍可导出。
- IndexedDB 分开保存棋局和分析。旧 localStorage 最近一局首次打开棋谱库时校验并迁移一次，保留旧数据。数据仅属于当前浏览器与站点地址，清除站点数据前应导出 JSON 备份。
- 保存棋局默认以复盘方式打开。使用初始/前后/末尾按钮、进度条、完整棋谱或胜率图定位；第 N 手指走完第 N 手后的局面。
- 分析由用户触发。快速分析 256 visits / 12 秒；加深 2000 visits / 30 秒。全局逐手排队，完成的局面逐项保存，停止后可继续。
- 点评只使用棋谱事实和搜索证据。胜率和目差换算到本手行棋方，优先采用同一次搜索的候选；否则补搜落子后局面。模型、后端、档位不一致时不比较。预计损失至少 2 目或 10 个百分点标记“待复查”，不生成段位或准确率。
- 重试回到该手之前，合法落子或虚着后单独保存。继续练习可选择执子，由 KataGo 使用 2000 visits / 30 秒应手。完整原谱前缀保留超级劫历史，原局不会被覆盖。双虚着进入人工死子确认；计分或终局必须显式恢复行棋才能继续。
- SGF 只导入十九路、中国规则、7.5 贴目、无让子布局的单一主线。分支及不支持的布局/规则明确拒绝；SGF 的 RE 不作为人工死子确认。完整终局和分析备份请使用 JSON。

## 实现入口

- `src/games/go/library.ts`：IndexedDB、顺序写入、迁移和完整导入校验。
- `src/games/go/study-analysis.ts`：完整前缀缓存、合法候选/变化、评价比较。
- `src/games/go/GoStudyPage.tsx`：复盘、取消、独立练习和人工计分。
- `src/games/go/ai/configured-transport.ts`：浏览器或原生 KataGo 入口。

## 验证方式

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers 2
node node_modules/typescript/bin/tsc -b --pretty false
node --test services/katago-bridge/test/protocol.test.mjs services/katago-bridge/test/server.test.mjs
node node_modules/vite/bin/vite.js build
```

开发服务器下访问 `/scripts/go-library-validation.html`，点击运行，验证真实 IndexedDB 的顺序更新、元数据保留、JSON 含分析往返、损坏导入原子拒绝和关联删除。只清理该次验证自己创建的临时记录，不清理已有棋谱。

2026-09-21 实测：浏览器 WebGPU 路径完成自动保存、改名收藏、刷新、两手棋全局分析、第二手重试、2000 visits AI 应手、练习另存及再次复盘。强模型获取失败时使用 `g170-b6c96-s175395328-d26788732`，界面显示模型回退；快速分析实际完成 256 visits，练习应手实际完成 2000 visits。原局保持两手，独立练习局三手，刷新后名称、收藏、分析和来源仍在。

原生路径实测使用 KataGo 1.17.1 / b28c512 模型，通过 SGF 导入含双虚着后续弈的四手棋谱；第四手前后分析成功，实际访问量分别 265 和 263（请求 256）。不支持的日本规则 / 6.5 贴目 SGF 在导入页面明确拒绝，已有棋谱保持完整。内置浏览器未报告下载完成事件；已验证导出 Blob、下载调用及 JSON 内容往返，未据此声称文件已在下载目录落盘。
