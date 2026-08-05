# 多棋类平台架构

## 当前运行边界

- `src/games/GameRegistry.ts` 提供棋类模块注册、查询和列表能力；大厅与路由只依赖注册表。
- `src/game` 保存已经稳定运行的中国象棋棋盘、规则、记谱和裁定函数。
- `src/engine` 保存 UCCI/UCI、Worker、WASM、NNUE 与 Engine Registry。
- `src/games/core` 提供不依赖具体棋类和引擎协议的平台契约与 `GameController`。
- `src/games/xiangqi` 将现有象棋规则和引擎策略适配到平台契约。
- `useAiMatch` 和 `useHumanVsEngine` 已经通过 `GameController` 执行合法着判断、落子、终局判断和 AI 回合。
- 两个 React Hook 继续负责用户界面状态、交互、棋钟、页面生命周期与 Worker 故障恢复。
- `src/games/go` 已具备十九路棋盘、落子、气、提子、自杀禁入、简单劫提示、位置超级劫、棋谱、双虚着后的计分阶段，以及中国规则面积计分（人工确认死子、7.5 贴目）；尚未接入可交互页面、自动死活识别或 AI。

## 生产调用方向

```text
React 页面
  -> useAiMatch / useHumanVsEngine
     -> GameController
        -> XiangqiGameEngine
           -> src/game 纯象棋规则
        -> AIMatchControllerAI / HumanMatchControllerAI
           -> EngineAdapter
              -> UCCI / UCI Worker
                 -> WASM + NNUE
```

通用层不知道“红黑方”“棋盘坐标”“UCCI”“NNUE”或“围棋十九路”。这些信息只属于具体棋类及其 AI 适配层。

## 本次渐进迁移的兼容边界

`XiangqiGameEngine` 现在是 React 运行路径进入象棋规则的唯一入口，负责：

- 初始局面；
- 合法动作；
- 动作执行；
- 将军、将死与困毙；
- 三次重复与 120 半回合无吃子；
- 规则棋谱。

`controller-ai.ts` 保留原有模式特有策略，不改变搜索参数或 Worker 协议：

- AI 人格对战的开局策略、MultiPV、候选着和认输判断；
- 不同引擎对战直接采用引擎最佳着；
- 人机模式的统一难度映射、思考时间和候选随机；
- EngineAdapter 的 `search`、`stop` 与 `newGame` 调用。

棋钟、暂停/恢复、页面切换与 Worker 崩溃恢复仍放在 Hook。这些是产品会话策略，不属于纯棋类规则；本次不为追求“彻底重构”而改变已经验证的生命周期。

## 旧路径保留策略

`legacy-transition.ts` 保存迁移前 Hook 的纯落子状态转换副本，只用于规则奇偶测试和短期回滚，不进入生产包的运行路径。待线上观察期结束、规则覆盖足够后可以删除。

`src/game` 当前不能删除：`XiangqiGameEngine` 仍以适配方式复用这些稳定规则函数。未来如需移动目录，应只做物理迁移并保持 API 与测试不变。

围棋开发时应实现自己的状态、动作、规则引擎和 AI 适配器，不引用象棋目录。
