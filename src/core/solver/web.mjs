/**
 * 网页版 DeepSeek 求解：复用同一个 CDP 浏览器，并且**复用同一个对话**。
 *
 * 旧行为每次求解都新开标签页、回首页发问 = 每次一个新对话，批量答题时极易触发风控。
 * 现在改为：常驻一个求解页 + 记录会话地址 + 提问间隔限速（见 thread.mjs）。
 *
 * 登录态留在浏览器 profile（.profiles/）里；未登录时抛出 login-required，
 * 页面保持打开，让人工在那个窗口里登录一次即可。
 */
import { buildPrompt, buildRepairPrompt } from './prompt.mjs';
import { SolverError } from './errors.mjs';
import { ensureThreadPage, waitForSlot, noteSend, isChatUrl } from './thread.mjs';

async function lastReplyText(page, selector) {
  const texts = await page.locator(selector).allInnerTexts().catch(() => []);
  const nonEmpty = texts.map((t) => String(t || '').trim()).filter(Boolean);
  return nonEmpty.length ? nonEmpty[nonEmpty.length - 1] : '';
}

export async function openSolverPage(session, cfg) {
  if (!session.context) await session.ensure();
  return ensureThreadPage(session, cfg);
}

async function assertLoggedIn(page, cfg) {
  const sel = cfg.solver.web.selectors;
  const input = page.locator(sel.input).first();
  if (await input.count().catch(() => 0)) return input;

  const body = await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
  if (new RegExp(sel.loginHint, 'i').test(body)) {
    throw new SolverError('login-required', '网页版 DeepSeek 未登录：请在打开的浏览器窗口里登录后重试');
  }
  throw new SolverError('web-ui-changed', '找不到输入框：网页版可能改版，请更新 solver.web.selectors');
}

async function waitForReply(page, sel, timeoutMs, before) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let stableSince = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(800);
    const now = await lastReplyText(page, sel.reply);
    if (!now || now === before) continue;
    if (now === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 2000) return now;
    } else {
      last = now;
      stableSince = 0;
    }
  }
  return last;
}

/** 发送后等地址变成会话地址（/a/chat/s/...）；老会话本来就在会话页，直接通过。 */
async function waitForChatUrl(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isChatUrl(page.url())) return true;
    await page.waitForTimeout(250);
  }
  return isChatUrl(page.url());
}

export async function solveViaWeb(session, page, questions, cfg, opts = {}) {
  const sel = cfg.solver.web.selectors;
  const input = await assertLoggedIn(page, cfg);

  // 限速：两次提问之间至少间隔 solver.web.minIntervalMs
  await waitForSlot(session, cfg);

  const before = await lastReplyText(page, sel.reply);
  await input.click();
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Backspace');

  // 中文用 insertText 最稳（逐字符 press 会丢字，见 docs/pitfalls.md）
  const cdp = await page.context().newCDPSession(page);
  const prompt = opts.repair ? buildRepairPrompt(questions) : buildPrompt(questions);
  await cdp.send('Input.insertText', { text: prompt });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');

  const text = await waitForReply(page, sel, cfg.solver.timeoutMs, before);
  if (!text) throw new SolverError('web-empty-reply', '网页版没有返回内容（可能被风控或未登录）');

  if (!(await waitForChatUrl(page))) {
    throw new SolverError('web-send-failed', '发送后页面没有进入会话，可能被限流；请稍后重试或改用 api 模式');
  }
  noteSend(session, page, cfg);
  return text;
}
