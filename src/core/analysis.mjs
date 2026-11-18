const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

/**
 * 打开「查看作答记录与解析」页，返回原文与逐题解析。
 * 解析页可能在新标签打开，这里按“最后出现的新页面”处理。
 */
export async function openAnalysis(page, sel, behavior) {
  const before = new Set(page.context().pages().map((p) => p.url()));

  const link = page.locator('span, div, a, button').filter({ hasText: new RegExp(`^\\s*${sel.analysisText}\\s*$`) }).first();
  if (!(await link.count())) {
    return { ok: false, error: `找不到「${sel.analysisText}」入口` };
  }
  await link.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const pages = page.context().pages().filter((p) => !p.isClosed());
  let target = pages.find((p) => !before.has(p.url()) && /examPreview|analysis|解析/i.test(p.url()));
  if (!target) target = pages[pages.length - 1];

  const text = clean(await target.evaluate(() => (document.body && document.body.innerText) || ''));
  const frags = text.split(/收藏为薄弱题|AI答题辅导/);
  const items = [];
  for (const frag of frags) {
    if (!/参考答案/.test(frag)) continue;
    const stem = clean((frag.match(/\d+、\s*([^。？?]+[。？?])/) || [])[1] || '');
    const correct = clean((frag.match(/参考答案：\s*([^\s答][^]{0,80}?)(?:\s*答案解析|$)/) || [])[1] || '');
    const wrong = /回答错误/.test(frag);
    items.push({ stem: stem.slice(0, 160), correctAnswer: correct.slice(0, 120), wrong });
  }

  return { ok: true, url: target.url(), text: text.slice(0, 4000), items };
}
