/**
 * 自动刷知识点：切下一个 → 进测试 → 求解回填 → 提交 → 不达标就学错题重做。
 *
 * 停止条件（任一）：
 *   - 出现 stop 文件（用户喊停）；
 *   - 到达 maxPoints；
 *   - 知识点树走到底；
 *   - 求解器要求登录（无法继续答题）。
 */
import fs from 'node:fs';
import { collectQuestions } from '../extract.mjs';
import { applyAnswers } from '../fill.mjs';
import { submitPaper } from '../submit.mjs';
import { openAnalysis } from '../analysis.mjs';
import { clickRedo } from '../redo.mjs';
import { solveQuestions } from '../solver/index.mjs';
import { learnCorrections } from '../solver/learn.mjs';
import { clearQuestions } from '../solver/cache.mjs';
import { advanceToNextPoint, enterTest } from './nav.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitWithStop(ms, stopFile) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stopFile && fs.existsSync(stopFile)) return false;
    await sleep(Math.min(1000, Math.max(0, end - Date.now())));
  }
  return true;
}

export async function runAuto({
  cfg,
  session,
  intervalSec = 30,
  threshold = 90,
  attempts = 3,
  maxPoints = 0,
  stopFile,
  lastQuestionsFile,
  log = () => {},
}) {
  const page = await session.ensure();
  let done = 0;

  while (true) {
    if (stopFile && fs.existsSync(stopFile)) {
      log({ event: 'stopped', reason: 'stop-file', done });
      break;
    }
    if (maxPoints > 0 && done >= maxPoints) {
      log({ event: 'stopped', reason: 'max-points', done });
      break;
    }

    const next = await advanceToNextPoint(page);
    if (!next) {
      log({ event: 'stopped', reason: 'end-of-course', done });
      break;
    }
    log({ event: 'point-start', title: next.title, index: done + 1 });

    // 记下知识点学习页：跑完/失败后要回到这里，才能继续往后切换。
    const learnUrl = page.url();
    const entered = await enterTest(page);
    if (!entered) {
      log({ event: 'point-skipped', title: next.title, reason: 'enter-test-failed' });
      done += 1;
      if (!(await waitWithStop(intervalSec * 1000, stopFile))) break;
      continue;
    }

    let passed = false;
    let mastery = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (stopFile && fs.existsSync(stopFile)) break;

      const questions = (await collectQuestions(page, cfg.selectors, { max: 20 })).map((q, i) => ({ ...q, index: i + 1 }));
      if (!questions.length) {
        log({ event: 'point-skipped', title: next.title, reason: 'no-questions' });
        break;
      }
      try {
        fs.writeFileSync(lastQuestionsFile, JSON.stringify({ at: Date.now(), questions }), 'utf8');
      } catch {
        /* 落盘失败不影响作答 */
      }

      let solved;
      try {
        solved = await solveQuestions({ session, cfg, questions, mode: 'web' });
      } catch (error) {
        log({ event: 'stopped', reason: error?.code || 'solver-error', message: error?.message });
        return done;
      }
      if (solved.answers.length !== questions.length) {
        // 先整卷重算一次（refresh 忽略缓存）；还缺才放弃，避免交白卷。
        log({ event: 'solve-retry', title: next.title, resolved: solved.answers.length, total: questions.length });
        try {
          solved = await solveQuestions({ session, cfg, questions, mode: 'web', refresh: true });
        } catch (error) {
          log({ event: 'stopped', reason: error?.code || 'solver-error', message: error?.message });
          return done;
        }
      }
      if (solved.answers.length !== questions.length) {
        log({ event: 'point-skipped', title: next.title, reason: 'incomplete', resolved: solved.answers.length, total: questions.length });
        break;
      }

      const applied = await applyAnswers(page, solved.answers, cfg.selectors, cfg.behavior, { dryRun: false });
      const sub = await submitPaper(page, cfg.selectors, cfg.behavior, { confirm: true });
      mastery = sub.mastery;
      log({
        event: 'attempt',
        title: next.title,
        attempt,
        mastery,
        verified: applied.filter((item) => item.verified).length,
      });

      if (typeof mastery === 'number' && mastery >= threshold) {
        const cleared = clearQuestions(cfg, questions);
        passed = true;
        log({ event: 'point-passed', title: next.title, mastery, cleared });
        break;
      }

      try {
        const analysis = await openAnalysis(page, cfg.selectors, cfg.behavior, { detail: false });
        if (analysis && analysis.ok) learnCorrections(cfg, analysis.items, questions);
      } catch {
        /* 学不到就继续重做 */
      }
      const redone = await clickRedo(page, cfg.selectors, cfg.behavior);
      if (!redone || redone.ok === false) break;
      await page.waitForTimeout(2500);
    }

    done += 1;
    if (!passed) log({ event: 'point-finished', title: next.title, mastery, passed: false });

    // 提交后页面停在成绩页，先回到学习页，下一轮才能在知识点树上继续往后走。
    try {
      if (/learnPage/.test(learnUrl)) {
        await page.goto(learnUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);
      }
    } catch {
      /* 回不去就让下一轮自己判断 */
    }

    if (!(await waitWithStop(intervalSec * 1000, stopFile))) {
      log({ event: 'stopped', reason: 'stop-file', done });
      break;
    }
  }

  return done;
}
