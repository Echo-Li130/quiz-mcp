#!/usr/bin/env node
/**
 * 引擎自测：用内置 fixture 验证 采集 → 作答 → 提交 整条链路。
 * 不访问任何外部网站，不需要登录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { DEFAULT_SELECTORS, findBrowser } from '../src/core/config.mjs';
import { collectQuestions } from '../src/core/extract.mjs';
import { applyAnswers } from '../src/core/fill.mjs';
import { parseMastery } from '../src/core/submit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SELECTORS = {
  ...DEFAULT_SELECTORS,
  title: '.paper-title',
  questionRoot: '.question',
  section: '.question-section',
  type: '.question-type',
  stem: '.question-stem',
  radioItem: '.options li',
  radioLabel: '.option-label',
  radioChecked: 'i.checked',
  multiItem: '.options.multi li',
  multiLabel: '.option-label',
  multiChecked: 'is-checked',
  blankInput: '.question input[type=text]',
  progress: '.progress-value',
  nextText: '下一题',
  prevText: '上一题',
  submit: 'button.submit',
};

const behavior = { waitAfterClickMs: 120, waitAfterNextMs: 300 };

const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
const page = await browser.newPage();
await page.setContent(fs.readFileSync(path.join(ROOT, 'test/fixture.html'), 'utf8'), { waitUntil: 'load' });

const questions = await collectQuestions(page, SELECTORS, { max: 10 });
console.log(`采集到 ${questions.length} 题`);
questions.forEach((q) => console.log(`  ${q.type} | ${q.stem.slice(0, 30)} | options=${q.options.length}`));

const answers = [
  { index: 1, labels: ['A'] },
  { index: 2, labels: ['B'] },
  { index: 3, labels: ['A', 'C'] },
  { index: 4, text: '6' },
];
const applied = await applyAnswers(page, answers, SELECTORS, behavior, { dryRun: false });
console.log('作答结果：');
applied.forEach((a) => console.log(`  #${a.index} ${a.verified ? '✅' : '❌'} ${a.kind} ${JSON.stringify(a.labels || a.value || '')}`));

const state = await page.evaluate(() => JSON.parse(JSON.stringify(window.__quizState || {})));
console.log('fixture 内部状态：', JSON.stringify(state));

await page.locator(SELECTORS.submit).click();
await page.waitForTimeout(300);
const text = await page.evaluate(() => document.body.innerText);
const mastery = parseMastery(text);
console.log('提交结果：', text.match(/掌握度[^\n]*/)?.[0] || text);
console.log('解析结果：', JSON.stringify(mastery));
console.log('校验：', `questions=${questions.length}`, `applied=${applied.every((a) => a.verified)}`, `mastery=${mastery.mastery}`);

await browser.close();

const ok = questions.length === 4 && applied.every((a) => a.verified) && mastery.mastery === 100;
console.log(ok ? '\nSELFTEST PASS 4/4' : '\nSELFTEST FAIL');
process.exit(ok ? 0 : 1);
