# 更新日志

## 0.3.0

### 修复

- **网页版求解不再每次都新开对话**：旧版每次 `quiz_solve` 结束都会关掉求解标签页，
  下一次新开标签页并回首页发问，批量答题时短时间内会产生大量新对话，容易触发平台风控。
  现在求解页常驻，发送后记录会话地址（`/a/chat/s/...`），后续优先续用同一对话；
  进程重启或标签被关掉时也按记录的地址重新打开，而不是回首页。

### 新增

- **会话复用与限速配置**（`solver.web`）：`keepThread`、`minIntervalMs`、`maxPromptsPerThread`、
  `threadMaxAgeMs`、`rotateCooldownMs`、`threadFile`。默认沿用同一对话、两次提问至少间隔 15 秒；
  单会话提问数到 40 或超龄 12 小时才轮换，轮换前冷却 5 分钟。
- **`quiz_solve` 新增 `newThread`**：临时强制开一个新对话；CLI 对应 `quiz-cli solve --new-thread`。
- **`quiz_solve` 返回 `thread: { reused, prompts }`**：可确认这次是续用还是新会话。
- **新错误码 `web-send-failed`**：发送后页面没有进入会话时抛出，不再把失败计入提问次数。
- 重试改为复用 `buildRepairPrompt`（只补失败题），减少单卷的提问条数。

### 测试

- 新增 `test/solver-thread.test.mjs`（8 项）与 `test/solver-pacing.test.mjs`（3 项），
  覆盖复用/续用/轮换/间隔/串行；CI 增加 Solver 单测步骤。

## 0.2.0

### 新增

- **`quiz_solve`**：低 token 求解。MCP 内部采集题目并交给求解器，只返回紧凑答案键
  （如 `1:A 2:A,C 3:增强民族认同和团结`），题目内容不进入对话上下文；`apply:true` 才回填。
- **求解器**：`web`（网页版 DeepSeek，复用同一个浏览器）与 `api`（DeepSeek 兼容接口）两种 provider，
  支持分批、答案缓存、解析失败自动重试一次。
- **`quiz-cli` 新命令**：`solve`、`learn`、`tabs`、`focus`、`shot`。
- **`quiz-cli analysis --learn`**：把解析页里的标准答案写回缓存，重做时直接命中。
- **`quiz-cli learn --all`**：解析页整卷入库（含答对的题），重做同一套卷子可全量命中。
- **达标清缓存**：`quiz-cli submit --clear-on-pass --threshold 90` 在掌握度达标后清掉本轮题目缓存；
  也可 `quiz-cli cache clear --paper` 单独清理。

### 变更

- `quiz_collect` 的 `index` 改为 **1 起**（与 `quiz_answer` 的题号一致），并省略空字段。
- 工具结果改为紧凑 JSON（去掉美化缩进），降低 token 占用。
- `quiz_analysis` 默认只回错题条目，`detail:true` 才回整页原文。
- `quiz_submit` 提交后先等待页面导航，再读取结果，修复
  `Execution context was destroyed, most likely because of a navigation`。
- 填空题答案超过 12 字判为无效并触发重试；缓存命中同样过一遍规则校验。

### 修复

- 单选题解析保留原始顺序（「B、A」正确取 B，而不是排序后取 A）。

### 验证

- 真实 6 题卷：求解 6/6、回填 6/6、提交后掌握度 97%；
- 单卷进入上下文的字符数从 4091 字节降到 60 字符；
- 离线测试：`selftest` 4/4、`mcp-client-test` 通过、求解器单测 26 项全绿。
