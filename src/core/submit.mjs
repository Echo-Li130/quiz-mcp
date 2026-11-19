const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

async function safeText(page) {
  try {
    return (await page.evaluate(() => (document.body && document.body.innerText) || '')).toString();
  } catch {
    return '';
  }
}

async function visiblePrompts(page, sel) {
  try {
    return await page.evaluate((s) => {
      const clean = (x) => (x || '').replace(/\s+/g, ' ').trim();
      const out = [];
      document.querySelectorAll(s.promptRoot).forEach((box) => {
        if (getComputedStyle(box).display === 'none') return;
        out.push({
          text: clean(box.innerText).slice(0, 200),
          buttons: [...box.querySelectorAll('button')].map((b) => clean(b.innerText)).filter(Boolean),
        });
      });
      return out;
    }, sel);
  } catch {
    return [];
  }
}

export function parseMastery(text) {
  const t = clean(text);
  const num = (...res) => {
    for (const re of res) {
      const m = t.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  };
  return {
    // 真实站点多为「97% 掌握度」；少数站点写作「掌握度：97%」，作为兜底
    mastery: num(/(\d+)\s*%\s*掌握度/, /掌握度\s*[:：]?\s*(\d+)\s*%/),
    best: num(/最好成绩\s*(\d+)%/, /最好成绩\s*[:：]?\s*(\d+)%/),
    total: num(/总题数\s*(\d+)/),
    correct: num(/已答对\s*(\d+)/),
    answered: num(/已作答\s*[:：]\s*(\d+)/),
  };
}

async function findResultPage(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cands = page.context().pages().filter((p) => !p.isClosed());
    for (const p of cands.slice().reverse()) {
      const txt = await p.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
      if (/掌握度/.test(txt)) return p;
    }
    await page.waitForTimeout(600);
  }
  return null;
}

/**
 * 提交试卷。必须显式 confirm=true，避免 agent 误操作。
 * 返回掌握度、答对数、总题数以及错题页提示。
 */
export async function submitPaper(page, sel, behavior, { confirm = false } = {}) {
  if (!confirm) {
    return { ok: false, error: '拒绝提交：需要显式传入 confirm=true' };
  }
  const btn = page.locator(sel.submit).first();
  if (!(await btn.count())) return { ok: false, error: '当前页面找不到提交按钮' };

  await btn.click({ timeout: 8000 }).catch(() => {});
  // 提交常伴随页面跳转：先等导航落定，再去读弹窗/结果，避免上下文被销毁。
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500);

  const prompts = await visiblePrompts(page, sel);
  if (prompts.length) {
    const target = prompts[prompts.length - 1];
    const idx = target.buttons.findIndex((b) => /确定|确认|提交|是/.test(b));
    if (idx >= 0) {
      await page
        .locator(`${sel.promptRoot} button`)
        .filter({ hasText: new RegExp(`^\\s*${target.buttons[idx]}\\s*$`) })
        .first()
        .click()
        .catch(() => {});
    }
  }

  await page.waitForTimeout(5000);
  const resultPage = await findResultPage(page);
  const text = resultPage ? await safeText(resultPage) : await safeText(page);

  return {
    ok: true,
    url: resultPage ? resultPage.url() : page.url(),
    prompts,
    ...parseMastery(text),
    textHead: clean(text).slice(0, 400),
  };
}
