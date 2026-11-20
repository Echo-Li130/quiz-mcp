# 实战踩坑记录

这些是实际跑通「一题一页」型练习网站时踩到的坑，换了站点大概率还会遇到。

## 1. 填空题：普通 `fill()` 写不进去

症状：`inputValue()` 看着有值，一翻页就变回空。

原因：这类页面多用 Vue 的 `el-input`，只认真实的输入事件链；直接设 `value` 或 `fill()` 不会更新组件状态。

可用写法（本仓库 `src/core/fill.mjs` 采用）：

```js
await box.click();
await page.keyboard.press('Control+A');
await page.keyboard.press('Backspace');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.insertText', { text: '答案' });
await page.keyboard.press('ArrowRight');   // 关键：一次真实按键触发提交
```

逐字符模拟按键（`pressSequentially`）对中文会丢字，不要用。

## 2. 填空题只认"短标准答案"

平台按字符串精确比对，长句、近义词一律判错。例如：

- 问"体系包括人民政协、政党协商和____"，标准答案是短词，不是一整句解释
- 问"…的主要区别在于____"，答案可能是"决策过程是否广泛协商"，而不是把区别描述一遍

**策略**：先用最简短的词组作答；判错后去解析页抄标准答案，再重做。

## 3. 元素引用只在一次快照内有效

选项顺序经常打乱，缓存上一次的元素引用会点错。**每次翻页都重新读取 DOM**，不要复用旧引用。

## 4. 有倒计时的页面要调超时

默认"点击后等 220ms、翻页后等 600ms"适合普通练习页；如果页面有倒计时、自动跳转，把 `behavior.waitAfterNextMs` 调小到 300 左右，避免被计时器打断。

## 5. `canvas` / 跨域 `iframe` 里的题目抓不到

无障碍树里没有内容，只能走截图 + 坐标点击，稳定性下降一个档。先用 `quiz_probe` 看 `counts.canvas` 和 `counts.iframe`，非 0 就要有心理准备。

## 6. 提交后结果可能在另一个标签页

提交往往跳到结果页或新开标签，读结果时要遍历 `context.pages()` 找含"掌握度"的那一页，而不是只读当前页。

## 7. 登录态只存在于本地 profile

`.profiles/` 里是真实 Cookie。**不要提交、不要打包分享**；换机器要重新登录一次，这是设计如此。

## 8. 遇到验证码/滑块就停

自动化无法可靠通过，检测到相关文案应停止并把控制权交回人类；强行重试只会触发风控。

## 9. 网页版 DeepSeek 需要单独登录一次

`solver.mode = "web"` 时，插件会在同一个浏览器里新开 `chat.deepseek.com` 标签页。
这个 profile 和你日常浏览器不共享登录态：

- 首次会返回 `login-required`，去那个窗口手动登录即可，登录态留在 `.profiles/`；
- 页面改版时更新 `solver.web.selectors`（输入框/回复区/登录提示文案）；
- 回复要等「连续 2 秒不再变化」才算完成，流式输出中途取值会拿到半截答案。

## 10. 题目多时要分批

一次把几十道题塞给网页版，容易被截断或触发限流。默认 `solver.batchSize = 8`，
十几题以上建议保持或调小；求解结果会进 `adapter/answer-cache.json`，重做同一套卷子不会重复请求。

## 11. 网页版求解：每次调用都新建对话会触发风控

症状：批量答题时 `chat.deepseek.com` 里短时间内冒出大量新对话，随后被限流或提示异常。

原因：旧版每次求解结束就关掉求解标签页，下一次再新开标签页、回首页发问——每次都是新对话。

**现在的做法**（`src/core/solver/thread.mjs`）：

- 求解页常驻，发送后记录会话地址（`/a/chat/s/...`），下次优先续用；
- 两次提问之间至少间隔 `solver.web.minIntervalMs`（默认 15 秒）；
- 单个对话提问数到 `maxPromptsPerThread`（默认 40）或超龄（默认 12 小时）才轮换，轮换前冷却；
- 大批量刷题建议把 `solver.mode` 设为 `api`，完全不经过网页版。

发送后页面若没有进入会话，会抛 `web-send-failed`：此时不要连续重试，先停一会儿或改用 api 模式。

