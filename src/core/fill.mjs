import { gotoQuestion, readQuestion } from './extract.mjs';

/**
 * 逐题作答。
 * answers: [{ index, labels?: string[], text?: string }]
 * dryRun=true 时只回显将要点什么，不产生副作用（默认）。
 */
export async function applyAnswers(page, answers, sel, behavior, { dryRun = true } = {}) {
  const applied = [];

  for (const item of answers) {
    const n = Number(item.index);
    const ok = await gotoQuestion(page, n, sel);
    if (!ok) {
      applied.push({ index: n, verified: false, error: '翻页失败，找不到该题' });
      continue;
    }

    const q = await readQuestion(page, sel);
    if (!q) {
      applied.push({ index: n, verified: false, error: '读不到题目' });
      continue;
    }

    if (q.kind === 'blank' || item.text !== undefined) {
      const box = page.locator(sel.blankInput).first();
      if (!(await box.count())) {
        applied.push({ index: n, verified: false, error: '该题没有填空输入框' });
        continue;
      }
      if (!dryRun) {
        await box.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        // 关键：Vue 组件只认 insertText + 一次真实按键，直接 fill 会被回滚
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.insertText', { text: String(item.text) });
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(behavior.waitAfterClickMs);
      }
      const value = dryRun ? String(item.text) : await box.inputValue();
      applied.push({
        index: n,
        kind: 'blank',
        value,
        verified: dryRun ? true : value.trim() === String(item.text).trim(),
      });
    } else {
      const labels = (item.labels || []).map((l) => String(l).toUpperCase());
      const itemSel = q.kind === 'multi' ? sel.multiItem : sel.radioItem;
      const labelSel = q.kind === 'multi' ? sel.multiLabel : sel.radioLabel;
      const boxes = page.locator(itemSel);
      const available = (await boxes.locator(labelSel).allInnerTexts()).map((t) =>
        t.replace(/\W/g, '').toUpperCase(),
      );

      for (const label of labels) {
        const idx = available.indexOf(label);
        if (idx < 0) continue;
        if (dryRun) continue;
        if (q.kind === 'multi') {
          const cls = (await boxes.nth(idx).getAttribute('class')) || '';
          if (!cls.includes(sel.multiChecked)) {
            await boxes.nth(idx).click();
            await page.waitForTimeout(behavior.waitAfterClickMs);
          }
        } else {
          const already = new RegExp(sel.selectedHint, 'i').test(
            (await boxes.nth(idx).getAttribute('class')) || '',
          );
          if (!already) {
            await boxes.nth(idx).click();
            await page.waitForTimeout(behavior.waitAfterClickMs);
          }
        }
      }

      const after = await readQuestion(page, sel);
      const verified = dryRun
        ? true
        : labels.length > 0 && labels.every((l) => after.checkedLabels.includes(l));

      applied.push({
        index: n,
        kind: q.kind,
        labels: labels.length ? labels : available,
        checked: after.checkedLabels,
        verified,
      });
    }
  }

  return applied;
}
