# quiz-mcp

[![CI](https://github.com/Echo-Li130/quiz-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Echo-Li130/quiz-mcp/actions/workflows/ci.yml)

**中文** | [English](README.en.md)

A **Model Context Protocol (MCP) server** for browser-based quiz/practice automation: it drives a real browser to collect questions, fill answers, submit, read the mastery score, and redo the paper when the score is too low.

任何支持 MCP 的 AI agent（DeepSeek Harness、Claude Desktop、Cursor 等）都能把它当工具调用；也提供等价的 CLI，供不支持 MCP 的 agent 使用。

> ⚠️ **说明**
> 本项目用于**浏览器自动化学习与实践**。
> 使用前请自行确认目标平台的使用条款。
> 仓库不包含任何题库、答案、账号或平台数据；作者不对使用后果负责。

---

## 隐私设计

- 代码里**不含任何站点域名、平台 ID、姓名或学号**
- 登录态只存在本地 `.profiles/`（已在 `.gitignore` 中排除），不会进入仓库
- 不读取、不导出、不打印任何 Cookie
- 题目、答案、结果文件都在 `.gitignore` 里，不会被提交

---

## 教程（中文）

从「粘贴链接 + 一句话」到交卷看掌握度的完整流程：见 [docs/tutorial-continue-practice.md](docs/tutorial-continue-practice.md)。

---

## 安装

```bash
git clone <this-repo> quiz-mcp
cd quiz-mcp
pnpm add playwright-core @modelcontextprotocol/sdk zod    # 或 npm i
cp adapter/config.example.json adapter/config.json        # 然后填你自己的站点
```

要求：Node.js ≥ 20，本机装有 Chrome 或 Edge。

## 第一次跑：五步

```bash
# 1) 验证引擎（内置 fixture，不需要网络）
node test/selftest.mjs          # 期望输出 SELFTEST PASS 4/4

# 2) 启动浏览器并打开你的练习页
node bin/quiz-cli.mjs open --url "https://your-site.example/paper/123"
#    弹出的窗口里手动登录一次；登录态会留在 .profiles/

# 3) 采集题目（只读）
node bin/quiz-cli.mjs collect --out questions.json

# 4) 写答案文件 answers.json
#    [{ "index": 1, "labels": ["A"] }, { "index": 2, "text": "答案" }]
node bin/quiz-cli.mjs answer answers.json            # 默认演练，不点击
node bin/quiz-cli.mjs answer answers.json --commit   # 真正填写

# 5) 提交并看掌握度；不达标就重做
node bin/quiz-cli.mjs submit --confirm
node bin/quiz-cli.mjs redo
```

---

## 接入 AI agent（MCP）

### DeepSeek Harness（mcp-manager）

```json
{
  "transport": "stdio",
  "command": "node",
  "args": ["<绝对路径>/quiz-mcp/bin/quiz-mcp.mjs"],
  "startupTimeoutMs": 30000
}
```

### Claude Desktop（`claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "quiz": {
      "command": "node",
      "args": ["<绝对路径>/quiz-mcp/bin/quiz-mcp.mjs"]
    }
  }
}
```

### Cursor（`~/.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "quiz": {
      "command": "node",
      "args": ["<绝对路径>/quiz-mcp/bin/quiz-mcp.mjs"]
    }
  }
}
```

> 若某个 agent 不支持 MCP，直接用同目录的 `bin/quiz-cli.mjs`，功能一一对应。

---

## 工具一览

| 工具 | 作用 |
|---|---|
| `quiz_open` | 启动/复用浏览器并打开目标页（需要在窗口里手动登录一次） |
| `quiz_status` | 当前地址、试卷标题、答题进度、是否在登录页 |
| `quiz_probe` | 输出页面结构摘要，帮你写 adapter 选择器 |
| `quiz_collect` | 采集当前试卷全部题目 |
| `quiz_solve` | **低 token**：内部采集+求解，只回紧凑答案键；`apply:true` 才回填 |
| `quiz_answer` | 按题号作答，**默认 dryRun，不点击页面** |
| `quiz_submit` | 提交并返回掌握度，**必须 confirm:true** |
| `quiz_analysis` | 打开解析页，返回错题与参考答案（默认只回错题，`detail:true` 回全文） |
| `quiz_redo` | 点「重新答题」开新一轮 |
| `quiz_close` | 关闭浏览器、释放 profile |

一次典型编排：

```
quiz_open → quiz_collect → quiz_answer(dryRun) → quiz_answer → quiz_submit
  ├─ 掌握度 ≥ 阈值 → 结束
  └─ 否则 → quiz_analysis → quiz_redo → 再 collect
```

低 token 编排（推荐，题目不进上下文）：

```
quiz_open → quiz_solve(apply) → quiz_submit
  └─ 需要复盘 → quiz_analysis → quiz_redo → quiz_solve
```

---

## 低 token 模式（quiz_solve）

原来的流程要把整卷题目读进 agent 上下文、再逐题推理；`quiz_solve` 把「求解」留在 MCP 里，
只返回一行答案键，**题目内容不进入对话**。

开启方式（`adapter/config.json`）：

```json
"solver": {
  "mode": "web",              // off（默认）| web | api
  "batchSize": 8,
  "cacheFile": "adapter/answer-cache.json"
}
```

- **web**：复用同一个浏览器，新开一个 `chat.deepseek.com` 标签页；首次需要在那窗口里登录一次，
  登录态留在 `.profiles/`。选择器可在 `solver.web.selectors` 里改。
- **api**：走 DeepSeek 兼容接口，key 取 `solver.api.keyEnv` 指向的环境变量（默认 `DEEPSEEK_API_KEY`）。
- **缓存**：答案按「题干+选项」哈希存 `adapter/answer-cache.json`，重做同一套卷子不再重复求解；
  `refresh: true` 强制重算。
- **从解析页学习**：`quiz-cli analysis --learn` 只学错题；`quiz-cli learn --all` 会把解析页上
  **全部题目**的标准答案写回缓存（整卷入库，下一轮重做可 100% 命中）。
- **达标后清缓存**：`quiz-cli submit --confirm --clear-on-pass --threshold 90` 在掌握度达标后
  自动清掉本轮题目的缓存；也可单独执行 `quiz-cli cache clear --paper`。
- **安全默认**：`apply` 默认 false，只回答案键；确认后再 `apply: true` 回填；提交仍需 `confirm`。

实测（6 题卷）：`quiz_collect` 全量 4091 字节 → `quiz_solve` 答案键 60 字符。

> 隐私提示：web 模式会把题干发送到 `chat.deepseek.com`（你自己的账号）。默认 `off`，
> 只在你明确开启后才会发送。

---

## 适配自己的站点

站点差异全部在 `adapter/config.json`。用 `quiz_probe` 找到选择器后填进去即可，详见 [adapter/README.md](adapter/README.md)，踩坑见 [docs/pitfalls.md](docs/pitfalls.md)。

---

## 测试与 CI

两个测试都完全离线，使用内置 `test/fixture.html`，不访问任何外部网站、不需要登录：

```bash
node test/selftest.mjs          # 引擎：采集 4 题 → 作答 → 提交，期望 SELFTEST PASS 4/4
node test/mcp-client-test.mjs   # MCP 协议：真客户端连真 server，期望 MCP TEST PASS
node test/solver-parse.test.mjs # 求解器：提示词/解析/校验
node test/solver-cache.test.mjs # 求解器：答案缓存
node test/solve-fixture.test.mjs# 求解器：编排（假 provider，不联网）
```

每次 push 到 `main` 或提交 PR，GitHub Actions 都会在 Linux 上自动跑这两项（见
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。托管 runner 里 Chrome 需要关闭沙箱，
CI 通过环境变量 `QUIZ_NO_SANDBOX=1` 传递，本地一般不需要设置。

## License

MIT
