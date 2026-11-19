#!/usr/bin/env node
/** 缓存层自测：键稳定性、命中/未命中、损坏文件自愈、选项变化失效。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  questionKey,
  loadCache,
  getCached,
  putCached,
  saveCache,
} from '../src/core/solver/cache.mjs';

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  ✗ ${name} — ${error.message}`);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-mcp-cache-'));
const file = path.join(dir, 'answer-cache.json');
const cfg = { solver: { cacheFile: file } };

const question = {
  index: 1,
  kind: 'radio',
  stem: '中国的首都是',
  options: [{ label: 'A', text: '北京' }, { label: 'B', text: '上海' }],
};

check('题干相同、选项顺序不同 → 同一个键', () => {
  const reordered = { ...question, options: [...question.options].reverse() };
  assert.equal(questionKey(question), questionKey(reordered));
});

check('选项文本变化 → 不同键', () => {
  const changed = { ...question, options: [{ label: 'A', text: '北京' }, { label: 'B', text: '广州' }] };
  assert.notEqual(questionKey(question), questionKey(changed));
});

check('写入后可读回', () => {
  const cache = loadCache(cfg);
  putCached(cache, question, { labels: ['A'] });
  saveCache(cache);
  const again = loadCache(cfg);
  assert.deepEqual(getCached(again, question).labels, ['A']);
});

check('未命中返回 null', () => {
  const cache = loadCache(cfg);
  assert.equal(getCached(cache, { ...question, stem: '另一道题' }), null);
});

check('损坏文件自动从空缓存开始', () => {
  fs.writeFileSync(file, '{ not json');
  const cache = loadCache(cfg);
  assert.deepEqual(cache.entries, {});
});

check('超过上限按时间淘汰最旧的', () => {
  const cache = { file, entries: {} };
  for (let i = 0; i < 2100; i += 1) {
    cache.entries[`k${i}`] = { labels: ['A'], at: i };
  }
  const kept = saveCache(cache);
  assert.equal(kept, 2000);
  assert.equal(getCached({ file, entries: cache.entries }, { stem: 'k0', options: [], kind: 'radio' }), null);
});

fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nSOLVER CACHE FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`\nSOLVER CACHE PASS ${passed}/${passed}`);
