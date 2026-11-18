const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

/** 读取当前屏幕上这一题 */
export async function readQuestion(page, sel) {
  return page.evaluate((s) => {
    const clean = (x) => (x || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
    const root = document.querySelector(s.questionRoot);
    if (!root) return null;
    const stems = [...new Set(
      [...root.querySelectorAll(s.stem)].map((n) => clean(n.innerText)).filter(Boolean),
    )];
    const pick = (parent, labelSel) =>
      [...root.querySelectorAll(parent)].map((n) => ({
        label: clean(n.querySelector(labelSel)?.innerText).replace(/\W/g, ''),
        text: clean(n.querySelector('.stem')?.innerText || n.querySelector('.preStyle')?.innerText || n.innerText),
      }));
    const radio = pick(s.radioItem, s.radioLabel);
    const multi = pick(s.multiItem, s.multiLabel);

    const hint = new RegExp(s.selectedHint, 'i');
    const checkedLabels = [...new Set(
      [...root.querySelectorAll(`${s.radioItem}, ${s.multiItem}`)]
        .filter((n) => hint.test(String(n.className)) || !!n.querySelector(s.radioChecked))
        .map((n) => clean(n.querySelector(s.radioLabel)?.innerText || n.querySelector(s.multiLabel)?.innerText).replace(/\W/g, ''))
        .filter(Boolean),
    )];

    const typeText = clean(root.querySelector(s.type)?.innerText);
    const kind = /多选/.test(typeText)
      ? 'multi'
      : /单选|判断/.test(typeText)
        ? 'radio'
        : radio.length
          ? 'radio'
          : multi.length
            ? 'multi'
            : 'blank';

    return {
      type: typeText,
      section: clean(root.querySelector(s.section)?.innerText),
      stem: stems.join(' '),
      options: kind === 'multi' ? multi : radio,
      kind,
      blanks: [...root.querySelectorAll(s.blankInput)].length,
      checkedLabels,
      blankValues: [...root.querySelectorAll(s.blankInput)].map((n) => n.value),
    };
  }, sel);
}

/** 读取顶部状态：标题、答题进度、是否在登录页 */
export async function readStatus(page, sel) {
  const info = await page.evaluate((s) => {
    const clean = (x) => (x || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
    const body = clean(document.body?.innerText);
    return {
      url: location.href,
      title: clean(document.title),
      paperTitle: clean(document.querySelector(s.title)?.innerText),
      progress: clean(document.querySelector(s.progress)?.innerText),
      hasQuestion: !!document.querySelector(s.questionRoot),
      bodyHead: body.slice(0, 300),
    };
  }, sel);

  const loginRequired = !info.hasQuestion && /登录|扫码|密码/.test(info.bodyHead);
  return { ...info, loginRequired };
}

const prevBtn = (page, sel) =>
  page.locator('button, .btn, span, div').filter({ hasText: new RegExp(`^\\s*${sel.prevText}\\s*$`) }).first();

const nextBtn = (page, sel) =>
  page.locator('button, .btn, span, div').filter({ hasText: new RegExp(`^\\s*${sel.nextText}\\s*$`) }).first();

const typeOf = async (page, sel) => {
  const el = page.locator(sel.type).first();
  if (!(await el.count().catch(() => 0))) return '';
  return clean(await el.innerText({ timeout: 2000 }).catch(() => ''));
};

/** 翻到第 n 题（1 起） */
export async function gotoQuestion(page, n, sel) {
  for (let i = 0; i < 20; i++) {
    const t = await typeOf(page, sel);
    if (!t) return false;
    if (new RegExp(`^${n}[.\\s]`).test(t)) return true;
    const cur = Number((t.match(/^(\d+)/) || [])[1] || 0);
    const btn = cur > n ? prevBtn(page, sel) : nextBtn(page, sel);
    if (!(await btn.count())) return false;
    await btn.click().catch(() => {});
    await page.waitForTimeout(450);
  }
  return false;
}

/** 从当前题开始翻页采集，直到题干重复或按钮耗尽 */
export async function collectQuestions(page, sel, { max = 15, startAtFirst = true } = {}) {
  if (startAtFirst) {
    for (let i = 0; i < 20; i++) {
      const t = await typeOf(page, sel);
      if (!t) break;
      if (/^1[.\s]/.test(t)) break;
      const btn = prevBtn(page, sel);
      if (!(await btn.count())) break;
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  const questions = [];
  const seen = new Set();
  for (let i = 0; i < max; i++) {
    const q = await readQuestion(page, sel);
    if (!q) break;
    const key = `${q.stem}|${q.options.map((o) => o.text).join('|')}`.slice(0, 200);
    if (seen.has(key)) break;
    seen.add(key);
    questions.push({ index: questions.length, ...q });
    const nb = nextBtn(page, sel);
    if (!(await nb.count())) break;
    await nb.click().catch(() => {});
    await page.waitForTimeout(550);
  }
  return questions;
}
