#!/usr/bin/env node
/**
 * CLI 入口：给不支持 MCP 的 agent 或人类直接用。
 * 与 MCP server 共用 src/core，行为一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/core/config.mjs';
import { getSession, closeSession } from '../src/session.mjs';
import { openAnalysis } from '../src/core/analysis.mjs';
import { applyAnswers } from '../src/core/fill.mjs';
import { collectQuestions, readStatus } from '../src/core/extract.mjs';
import { probePage } from '../src/core/probe.mjs';
import { clickRedo } from '../src/core/redo.mjs';
import { submitPaper } from '../src/core/submit.mjs';

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
    case 'submit': {
      if (!flag('confirm')) return out({ ok: false, error: '需要 --confirm 才会真正提交' });
      const page = await session.ensure();
      return out(await submitPaper(page, cfg.selectors, cfg.behavior, { confirm: true }));
    }
    case 'analysis': {
      const page = await session.ensure();
      return out(await openAnalysis(page, cfg.selectors, cfg.behavior));
    }
    case 'redo': {
      const page = await session.ensure();
      return out(await clickRedo(page, cfg.selectors, cfg.behavior));
    }
    case 'close': {
      return out({ ok: true, closed: await closeSession() });
    }
    default:
      return out({
        ok: false,
        error: '未知命令',
        usage: 'quiz-cli <open|status|probe|collect|answer|submit|analysis|redo|close> [--url X] [--max N] [--out f] [--commit] [--confirm]',
      });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    out({ ok: false, error: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
