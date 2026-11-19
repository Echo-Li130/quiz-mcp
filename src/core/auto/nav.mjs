/**
 * 知识点树导航（适配 el-collapse 结构）。
 *
 * - 当前知识点由页面标题 `.point-title-text` 识别；
 * - 同级叶子节点是 `.title-text`，按 DOM 顺序取下一个；
 * - 当前单元/模块跑完就展开下一个折叠项，再取它的第一个叶子；
 * - 找不到下一个就返回 null（整门课跑完）。
 */

const ADVANCE_SCRIPT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const leaves = [...document.querySelectorAll('.section-item-collapse-title .title-text')].filter(vis);
  const curTitle = (document.querySelector('.point-title-text') || {}).innerText || '';
  const idx = leaves.findIndex((e) => e.innerText.trim() === curTitle.trim());
  const click = (el) => { if (!el) return false; el.click(); return true; };
  if (idx >= 0 && leaves[idx + 1]) {
    const title = leaves[idx + 1].innerText.trim();
    click(leaves[idx + 1]);
    return { action: 'leaf', title };
  }
  const curLeaf = idx >= 0 ? leaves[idx] : null;
  if (!curLeaf) return { action: 'none' };

  const unit = curLeaf.closest('.el-collapse-item.collapse-item-sub');
  let sibling = unit && unit.nextElementSibling;
  while (sibling) {
    if (sibling.classList && sibling.classList.contains('el-collapse-item')) {
      const header = sibling.querySelector('.el-collapse-item__header');
      if (header && !sibling.classList.contains('is-active')) {
        header.click();
        return { action: 'expand-unit', title: (sibling.innerText || '').slice(0, 30) };
      }
      const first = [...sibling.querySelectorAll('.section-item-collapse-title .title-text')].find(vis);
      if (first) { const t = first.innerText.trim(); click(first); return { action: 'leaf', title: t }; }
    }
    sibling = sibling.nextElementSibling;
  }

  const module = curLeaf.closest('.el-collapse-item:not(.collapse-item-sub)');
  let nextModule = module && module.nextElementSibling;
  while (nextModule) {
    if (nextModule.classList && nextModule.classList.contains('el-collapse-item')) {
      const header = nextModule.querySelector('.el-collapse-item__header');
      if (header && !nextModule.classList.contains('is-active')) {
        header.click();
        return { action: 'expand-module', title: (nextModule.innerText || '').slice(0, 30) };
      }
      const firstUnit = nextModule.querySelector('.el-collapse-item.collapse-item-sub');
      if (firstUnit && !firstUnit.classList.contains('is-active')) {
        const uh = firstUnit.querySelector('.el-collapse-item__header');
        if (uh) { uh.click(); return { action: 'expand-unit', title: '' }; }
      }
      const first = [...nextModule.querySelectorAll('.section-item-collapse-title .title-text')].find(vis);
      if (first) { const t = first.innerText.trim(); click(first); return { action: 'leaf', title: t }; }
    }
    nextModule = nextModule.nextElementSibling;
  }
  return { action: 'end' };
})()`;

/** 切到下一个知识点；返回 { title } 或 null（没有下一个）。 */
export async function advanceToNextPoint(page) {
  for (let i = 0; i < 4; i += 1) {
    const result = await page.evaluate(ADVANCE_SCRIPT);
    if (!result || result.action === 'end' || result.action === 'none') return null;
    if (result.action === 'leaf') {
      await page.waitForTimeout(2500);
      return { title: result.title };
    }
    // 展开动作：等动画后重试，直到真的点到一个叶子节点
    await page.waitForTimeout(1200);
  }
  return null;
}

/** 从知识点页进入它的测试卷；失败会重试，最多 3 轮。 */
export async function enterTest(page) {
  const onTest = () => /studentReviewTestOrExam/.test(page.url());
  if (onTest()) return true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('*')].filter(
        (node) => (node.innerText || '').trim() === '去提升',
      );
      const target = nodes.find((node) => node.children.length === 0) || nodes[0];
      if (target) target.click();
    });
    await page.waitForTimeout(3000);
    if (onTest()) return true;

    await page.evaluate(() => {
      const btn = document.querySelector('.improve-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(3500);
    if (onTest()) return true;

    // 没进测试页：可能是弹层/报告页，回退一页后重试
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);
    if (onTest()) return true;
  }
  return onTest();
}
