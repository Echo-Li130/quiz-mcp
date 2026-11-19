/**
 * 网页版 DeepSeek 求解：复用同一个 CDP 浏览器，新开一个标签页，不碰试卷页。
 *
 * 登录态留在浏览器 profile（.profiles/）里；未登录时抛出 login-required，
 * 页面保持打开，让人工在那个窗口里登录一次即可。
 */
import { buildPrompt } from './prompt.mjs';
import { SolverError } from './errors.mjs';

async function lastReplyText(page, selector) {
  const texts = await page.locator(selector).allInnerTexts().catch(() => []);
  const nonEmpty = texts.map((t) => String(t || '').trim()).filter(Boolean);
  return nonEmpty.length ? nonEmpty[nonEmpty.length - 1] : '';
}

export async function openSolverPage(session, cfg) {
  const target = cfg.solver.web.url;
  const origin = new URL(target).origin;
  const existing = session.context.pages().find(
    (p) => !p.isClosed() && p.url().startsWith(origin),
  );
  if (existing) {
    await existing.bringToFront().catch(() => {});
    return existing;
  }
  const page = await session.context.newPage();
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: cfg.behavior.navigationTimeoutMs });
  await page.waitForTimeout(1500);
  return page;
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

export async function solveViaWeb(page, questions, cfg) {
  const sel = cfg.solver.web.selectors;
  const input = await assertLoggedIn(page, cfg);

  const before = await lastReplyText(page, sel.reply);
  await input.click();
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Backspace');

  // 中文用 insertText 最稳（逐字符 press 会丢字，见 docs/pitfalls.md）
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.insertText', { text: buildPrompt(questions) });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');

  const text = await waitForReply(page, sel, cfg.solver.timeoutMs, before);
  if (!text) throw new SolverError('web-empty-reply', '网页版没有返回内容（可能被风控或未登录）');
  return text;
}
