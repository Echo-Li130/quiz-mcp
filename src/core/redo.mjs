/**
 * 点击「重新答题」，返回新一轮的答题页与初始进度。
 * 每轮抽题可能不同，因此调用方应重新 collect 再作答。
 */
export async function clickRedo(page, sel, behavior) {
  const before = new Set(page.context().pages().map((p) => p.url()));
  const btn = page.locator('span, div, a, button').filter({ hasText: new RegExp(`^\\s*${sel.redoText}\\s*$`) }).first();
  if (!(await btn.count())) return { ok: false, error: `找不到「${sel.redoText}」按钮` };

  await btn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(4500);

  const pages = page.context().pages().filter((p) => !p.isClosed());
  let target = pages.find((p) => !before.has(p.url()) && p.url().includes('/studentReviewTestOrExam'));
  if (!target) target = pages.find((p) => p.url().includes('/studentReviewTestOrExam')) || page;

  await target.waitForTimeout(800).catch(() => {});
  const progress = await target
    .locator(sel.progress)
    .innerText()
    .catch(() => '');
  return { ok: true, url: target.url(), progress: String(progress).trim() };
}
