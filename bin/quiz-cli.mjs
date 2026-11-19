#!/usr/bin/env node
/**
 * CLI 入口：给不支持 MCP 的 agent 或人类直接用。
 * 与 MCP server 共用 src/core，行为一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/core/config.mjs';
import { ROOT } from '../src/core/config.mjs';
import { getSession, closeSession } from '../src/session.mjs';
import { openAnalysis } from '../src/core/analysis.mjs';
import { applyAnswers } from '../src/core/fill.mjs';
import { collectQuestions, readStatus } from '../src/core/extract.mjs';
import { probePage } from '../src/core/probe.mjs';
import { clickRedo } from '../src/core/redo.mjs';
import { submitPaper } from '../src/core/submit.mjs';
import { solveQuestions } from '../src/core/solver/index.mjs';
import { learnCorrections } from '../src/core/solver/learn.mjs';
import { clearQuestions } from '../src/core/solver/cache.mjs';

const LAST_QUESTIONS = path.join(ROOT, 'adapter', 'last-questions.json');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const cfg = loadConfig();
const session = getSession(cfg);

function out(v) {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

async function main() {
  switch (cmd) {
    case 'open': {
      const page = await session.open(value('url', ''));
      await page.waitForTimeout(1500);
      return out({ ok: true, ...(await readStatus(page, cfg.selectors)) });
    }
    case 'status': {
      const page = await session.ensure();
      return out({ ok: true, ...(await readStatus(page, cfg.selectors)) });
    }
    case 'probe': {
      const page = await session.ensure();
      return out({ ok: true, ...(await probePage(page)) });
    }
    case 'focus': {
      await session.ensure();
      const match = value('url', '');
      const target = match ? session.context.pages().find((p) => p.url().includes(match)) : null;
      const page = target || (await session.ensure());
      await page.bringToFront();
      return out({ ok: true, url: page.url() });
    }
    case 'tabs': {
      await session.ensure();
      return out({ ok: true, tabs: session.context.pages().map((p) => p.url()) });
    }
    case 'rects': {
      const page = await session.ensure();
      const data = await page.evaluate(() => ({
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        canvases: [...document.querySelectorAll('canvas')].map((c) => {
          const r = c.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      }));
      return out({ ok: true, ...data });
    }
    case 'click': {
      const page = await session.ensure();
      const x = Number(value('x', '0'));
      const y = Number(value('y', '0'));
      await page.mouse.click(x, y);
      await page.waitForTimeout(1500);
      return out({ ok: true, x, y, url: page.url() });
    }
    case 'clicktext': {
      const page = await session.ensure();
      const text = value('text', '');
      const loc = page.getByText(text, { exact: true }).first();
      if (await loc.count()) {
        await loc.click({ timeout: 8000 }).catch(() => {});
      } else {
        await page.locator('span,div,a,button').filter({ hasText: text }).first().click({ timeout: 8000 }).catch(() => {});
      }
      await page.waitForTimeout(1500);
      return out({ ok: true, text, url: page.url() });
    }
    case 'back': {
      const page = await session.ensure();
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      return out({ ok: true, url: page.url() });
    }
    case 'shot': {
      const page = await session.ensure();
      await page.bringToFront();
      const file = path.resolve(value('out', 'shot.png'));
      await page.screenshot({ path: file });
      return out({ ok: true, file, url: page.url() });
    }
    case 'collect': {
      const page = await session.ensure();
      const max = Number(value('max', '15'));
      const questions = await collectQuestions(page, cfg.selectors, { max });
      const outFile = value('out', '');
      if (outFile) fs.writeFileSync(path.resolve(outFile), JSON.stringify({ questions }, null, 2), 'utf8');
      return out({ ok: true, count: questions.length, questions });
    }
    case 'answer': {
      const file = value('file', argv[1] && !argv[1].startsWith('--') ? argv[1] : 'answers.json');
      if (!fs.existsSync(path.resolve(file))) {
        return out({ ok: false, error: `找不到答案文件 ${file}` });
      }
      const parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
      const answers = Array.isArray(parsed) ? parsed : parsed.answers;
      const page = await session.ensure();
      const dryRun = !flag('commit');
      const applied = await applyAnswers(page, answers, cfg.selectors, cfg.behavior, { dryRun });
      return out({ ok: true, dryRun, applied });
    }
    case 'solve': {
      const page = await session.ensure();
      const max = Number(value('max', '15'));
      const mode = value('mode', '') || undefined;
      const batch = Number(value('batch', '0')) || undefined;
      const questions = (await collectQuestions(page, cfg.selectors, { max }))
        .map((q, i) => ({ ...q, index: i + 1 }));
      try {
        fs.writeFileSync(LAST_QUESTIONS, JSON.stringify({ at: Date.now(), questions }), 'utf8');
      } catch {
        /* 落盘失败不影响本次求解 */
      }
      const result = await solveQuestions({
        session,
        cfg,
        questions,
        mode,
        batchSize: batch,
        refresh: flag('refresh'),
      });
      let applied = null;
      if (flag('commit') && result.answers.length) {
        applied = await applyAnswers(page, result.answers, cfg.selectors, cfg.behavior, { dryRun: false });
      }
      return out({
        ok: true,
        mode: result.mode,
        total: questions.length,
        resolved: result.answers.length,
        cached: result.cached,
        key: result.key,
        unresolved: result.unresolved,
        ...(applied ? { applied } : {}),
      });
    }
    case 'submit': {
      if (!flag('confirm')) return out({ ok: false, error: '需要 --confirm 才会真正提交' });
      const page = await session.ensure();
      const result = await submitPaper(page, cfg.selectors, cfg.behavior, { confirm: true });
      let cleared = null;
      const threshold = Number(value('threshold', '90'));
      if (flag('clear-on-pass') && result.ok && typeof result.mastery === 'number') {
        if (result.mastery >= threshold) {
          try {
            const saved = JSON.parse(fs.readFileSync(LAST_QUESTIONS, 'utf8'));
            cleared = clearQuestions(cfg, saved.questions || []);
          } catch {
            cleared = 0;
          }
        }
      }
      return out(flag('clear-on-pass') ? { ...result, threshold, cleared } : result);
    }
    case 'analysis': {
      const page = await session.ensure();
      const result = await openAnalysis(page, cfg.selectors, cfg.behavior, {
        detail: flag('detail'),
        all: flag('all'),
      });
      if (!flag('learn')) return out(result);
      let learned = 0;
      try {
        const saved = JSON.parse(fs.readFileSync(LAST_QUESTIONS, 'utf8'));
        learned = learnCorrections(cfg, result.items, saved.questions || []);
      } catch {
        learned = 0;
      }
      return out({ ...result, learned });
    }
    case 'learn': {
      if (flag('all')) {
        const page = await session.ensure();
        const result = await openAnalysis(page, cfg.selectors, cfg.behavior, { all: true });
        if (!result.ok) return out(result);
        let saved;
        try {
          saved = JSON.parse(fs.readFileSync(LAST_QUESTIONS, 'utf8'));
        } catch {
          return out({ ok: false, error: '还没有采集记录，先跑一次 solve' });
        }
        const learned = learnCorrections(cfg, result.items, saved.questions || []);
        return out({ ok: true, learned, total: (saved.questions || []).length, scanned: result.items.length });
      }
      const file = value('file', 'adapter/corrections.json');
      const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
      if (!fs.existsSync(full)) return out({ ok: false, error: `找不到纠正文件 ${file}` });
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      const items = Array.isArray(raw) ? raw : raw.items || [];
      if (!fs.existsSync(LAST_QUESTIONS)) return out({ ok: false, error: '还没有采集记录，先跑一次 solve' });
      const saved = JSON.parse(fs.readFileSync(LAST_QUESTIONS, 'utf8'));
      const learned = learnCorrections(cfg, items, saved.questions || []);
      return out({ ok: true, learned, total: (saved.questions || []).length });
    }
    case 'cache': {
      if (argv[1] !== 'clear') return out({ ok: false, error: '用法: quiz-cli cache clear --paper' });
      let saved;
      try {
        saved = JSON.parse(fs.readFileSync(LAST_QUESTIONS, 'utf8'));
      } catch {
        return out({ ok: false, error: '还没有采集记录，先跑一次 solve' });
      }
      const removed = clearQuestions(cfg, saved.questions || []);
      return out({ ok: true, removed, total: (saved.questions || []).length });
    }
    case 'redo': {
      const page = await session.ensure();
      return out(await clickRedo(page, cfg.selectors, cfg.behavior));
    }
    case 'close': {
      // 先连上再关，否则新进程里没有已连接的浏览器，close 不会生效。
      await session.ensure().catch(() => null);
      return out({ ok: true, closed: await closeSession() });
    }
    default:
      return out({
        ok: false,
        error: '未知命令',
        usage: 'quiz-cli <open|status|probe|tabs|focus|shot|rects|click|clicktext|back|collect|solve|learn|cache|answer|submit|analysis|redo|close> [--url X] [--max N] [--out f] [--mode web|api] [--batch N] [--refresh] [--commit] [--confirm] [--learn] [--all] [--file f] [--detail] [--clear-on-pass] [--threshold N]',
      });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    out({ ok: false, error: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
