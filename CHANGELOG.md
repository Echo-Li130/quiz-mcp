# 更新日志

## 0.2.0

### 新增

- **`quiz_solve`**：低 token 求解。MCP 内部采集题目并交给求解器，只返回紧凑答案键
  （如 `1:A 2:A,C 3:增强民族认同和团结`），题目内容不进入对话上下文；`apply:true` 才回填。
- **求解器**：`web`（网页版 DeepSeek，复用同一个浏览器）与 `api`（DeepSeek 兼容接口）两种 provider，
  支持分批、答案缓存、解析失败自动重试一次。
- **`quiz-cli` 新命令**：`solve`、`learn`、`tabs`、`focus`、`shot`。
- **`quiz-cli analysis --learn`**：把解析页里的标准答案写回缓存，重做时直接命中。

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
