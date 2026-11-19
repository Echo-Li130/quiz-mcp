# quiz-mcp

[![CI](https://github.com/Echo-Li130/quiz-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Echo-Li130/quiz-mcp/actions/workflows/ci.yml)

[中文](README.md) | **English**

A **Model Context Protocol (MCP) server** for browser-based quiz and practice automation. It drives a real browser (via the Chrome DevTools Protocol) to collect questions, fill in answers, submit the paper, read the mastery score, and start a new attempt when the score is too low.

Any MCP-capable agent (DeepSeek Harness, Claude Desktop, Cursor, …) can call it as a tool. An equivalent CLI is included for agents that don't speak MCP.

> ⚠️ **Note**
> This project is for **browser-automation learning and practice**.
> You are responsible for checking the target platform's terms of service.
> The repository contains no question banks, answers, accounts, or platform data. The authors take no responsibility for misuse.

---

## Privacy by design

- No site domain, platform ID, name, or student number anywhere in the code
- Login state lives only in a local `.profiles/` directory (listed in `.gitignore`) and is never committed
- Cookies are never read, exported, or printed
- Question, answer, and result files are all git-ignored

---

## Tutorial (Chinese)

A walkthrough from a one-line prompt to a submitted paper and its mastery score: [docs/tutorial-continue-practice.md](docs/tutorial-continue-practice.md).

---

## Install

```bash
git clone https://github.com/Echo-Li130/quiz-mcp.git
cd quiz-mcp
npm install                 # or: pnpm add playwright-core @modelcontextprotocol/sdk zod
cp adapter/config.example.json adapter/config.json   # then fill in your own site
```

Requirements: Node.js ≥ 20, and Chrome or Edge installed locally.

## Five steps to run it

```bash
# 1) Verify the engine offline (uses the bundled fixture)
node test/selftest.mjs          # expect: SELFTEST PASS 4/4

# 2) Launch a browser on your practice page
node bin/quiz-cli.mjs open --url "https://your-site.example/paper/123"
#    Log in manually in the window that opens; the session is kept in .profiles/

# 3) Collect the questions (read-only)
node bin/quiz-cli.mjs collect --out questions.json

# 4) Write answers.json
#    [{ "index": 1, "labels": ["A"] }, { "index": 2, "text": "your answer" }]
node bin/quiz-cli.mjs answer answers.json            # dry run by default
node bin/quiz-cli.mjs answer answers.json --commit   # actually fill it in

# 5) Submit and read the score; redo if it is below your threshold
node bin/quiz-cli.mjs submit --confirm
node bin/quiz-cli.mjs redo
```

---

## Use it from an AI agent (MCP)

### DeepSeek Harness (mcp-manager)

```json
{
  "transport": "stdio",
  "command": "node",
  "args": ["<absolute-path>/quiz-mcp/bin/quiz-mcp.mjs"],
  "startupTimeoutMs": 30000
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "quiz": {
      "command": "node",
      "args": ["<absolute-path>/quiz-mcp/bin/quiz-mcp.mjs"]
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "quiz": {
      "command": "node",
      "args": ["<absolute-path>/quiz-mcp/bin/quiz-mcp.mjs"]
    }
  }
}
```

> If an agent doesn't support MCP, use `bin/quiz-cli.mjs` instead — same features, one-to-one.

---

## Tools

| Tool | What it does |
|---|---|
| `quiz_open` | Start or reuse the browser and open the target page (log in manually once) |
| `quiz_status` | Current URL, paper title, progress, whether a login is required |
| `quiz_probe` | Dump the page structure summary to help you author selectors |
| `quiz_collect` | Collect all questions from the current paper |
| `quiz_answer` | Answer by question index — **dry run by default** |
| `quiz_submit` | Submit and return the mastery score — **requires `confirm: true`** |
| `quiz_analysis` | Open the answer-analysis page and return wrong answers + correct answers |
| `quiz_redo` | Click “redo” to start a new attempt |
| `quiz_close` | Close the browser and release the profile |

Typical loop:

```
quiz_open → quiz_collect → quiz_answer(dryRun) → quiz_answer → quiz_submit
  ├─ mastery ≥ threshold → done
  └─ otherwise → quiz_analysis → quiz_redo → collect again
```

---

## Bring your own site

Every site difference lives in `adapter/config.json`. Use `quiz_probe` to discover the selectors and fill them in — see [adapter/README.md](adapter/README.md), and [docs/pitfalls.md](docs/pitfalls.md) for the traps that are easy to hit.

---

## Tests and CI

Both tests are fully offline and use the bundled `test/fixture.html`:

```bash
node test/selftest.mjs        # engine: collect → answer → submit, expect SELFTEST PASS 4/4
node test/mcp-client-test.mjs # MCP protocol: a real client against a real server
```

Every push to `main` and every pull request runs both on GitHub Actions (Linux), see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). Hosted runners need Chrome's sandbox disabled,
which the workflow passes through `QUIZ_NO_SANDBOX=1`; you normally don't need it locally.

## License

MIT
