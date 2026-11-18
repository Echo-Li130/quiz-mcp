# 写一个自己的适配器

`quiz-mcp` 的代码里**不含任何站点域名或题目内容**，站点差异全部通过 `adapter/config.json` 描述。
换一个网站，只需要改这份配置。

## 三步

1. 复制模板：`cp adapter/config.example.json adapter/config.json`
2. 填 `site.host`（你的练习网站地址）
3. 用探测工具找选择器：

```bash
node engine/probe.mjs --url "https://example.edu/paper/123"
```

输出里的 `counts`（radio/checkbox/textInput 数量）和 `blocks`（候选区块 + 文本片段）能帮你判断：

- 选项是 `li` 还是 `label`
- 题干在哪个容器里
- 是否需要额外处理 iframe / canvas

## 选择器字段

| 字段 | 含义 |
|---|---|
| `questionRoot` | 单题容器，翻页时会整体替换 |
| `type` | 题型文字（如“3. 多选题”），用于判断单选/多选/填空 |
| `stem` | 题干文本 |
| `radioItem` / `radioLabel` / `radioChecked` | 单选与判断：选项容器、字母、选中标记 |
| `multiItem` / `multiLabel` / `multiChecked` | 多选：同上（`multiChecked` 是选中时 class 里出现的片段） |
| `blankInput` | 填空输入框 |
| `progress` | 答题进度文字 |
| `nextText` / `prevText` | 翻页按钮的可访问文本 |
| `submit` | 提交按钮选择器 |
| `analysisText` / `redoText` | 解析页与重做入口的文本 |

## 自检

```bash
node test/selftest.mjs        # 用内置 fixture 验证引擎（应输出 3/3）
node bin/quiz-cli.mjs probe   # 用你自己的 config 探测真实页面
```
