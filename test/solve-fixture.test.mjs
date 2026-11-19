#!/usr/bin/env node
/** 编排层自测：用注入式假 provider 验证解析、缓存、刷新与失败降级（不联网、不开浏览器）。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { solveQuestions } from '../src/core/solver/index.mjs';
import { loadCache, putCached, saveCache } from '../src/core/solver/cache.mjs';

const failures = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  ✗ ${name} — ${error.message}`);
  }
}

const questions = [
  { index: 1, kind: 'radio', stem: '中国的首都是', options: [{ label: 'A', text: '北京' }, { label: 'B', text: '上海' }] },
  { index: 2, kind: 'multi', stem: '下列属于水果的是', options: [{ label: 'A', text: '苹果' }, { label: 'B', text: '白菜' }, { label: 'C', text: '香蕉' }] },
  { index: 3, kind: 'blank', stem: '1+1 =', options: [] },
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-mcp-solve-'));
const cfg = {
  solver: {
    mode: 'web',
    batchSize: 8,
    timeoutMs: 2000,
    cacheFile: path.join(dir, 'answer-cache.json'),
    web: { url: 'https://chat.deepseek.com/', selectors: {} },
    api: { baseUrl: '', model: '', keyEnv: '' },
  },
  behavior: { waitAfterClickMs: 1, waitAfterNextMs: 1 },
  selectors: {},
};

let calls = 0;
const good = {
  solve: async (qs) => {
    calls += 1;
    return qs
      .map((q) => {
        if (q.kind === 'blank') return `${q.index}|2`;
        if (q.kind === 'multi') return `${q.index}|A,C`;
        return `${q.index}|A`;
      })
      .join('\n');
  },
};

await check('全部解析成功，且题目原文不进入结果', async () => {
  const result = await solveQuestions({ cfg, questions, provider: good, refresh: true });
  assert.equal(result.answers.length, 3);
  assert.equal(result.key, '1:A 2:A,C 3:2');
  assert.equal(result.unresolved.length, 0);
  assert.ok(!JSON.stringify(result).includes('首都'));
});

await check('第二次相同题目走缓存，不再调用求解器', async () => {
  const before = calls;
  const result = await solveQuestions({ cfg, questions, provider: good });
  assert.equal(calls, before);
  assert.equal(result.cached, 3);
});

await check('refresh=true 强制重新求解', async () => {
  const before = calls;
  await solveQuestions({ cfg, questions, provider: good, refresh: true });
  assert.equal(calls, before + 1);
});

await check('无法解析时只回题号，不猜答案', async () => {
  const result = await solveQuestions({
    cfg,
    questions,
    provider: { solve: async () => '抱歉，我无法作答。' },
    refresh: true,
  });
  assert.equal(result.answers.length, 0);
  assert.deepEqual(result.unresolved.map((u) => u.index), [1, 2, 3]);
});

await check('mode=off 返回 solver-disabled', async () => {
  const result = await solveQuestions({ cfg: { ...cfg, solver: { ...cfg.solver, mode: 'off' } }, questions, provider: good });
  assert.equal(result.code, 'solver-disabled');
});

await check('计数题：解析失败但部分成功时保留已解析结果', async () => {
  let round = 0;
  const partial = {
    solve: async (qs) => {
      round += 1;
      return round === 1 ? '1|A' : '';
    },
  };
  const result = await solveQuestions({ cfg, questions, provider: partial, refresh: true });
  assert.equal(result.answers.length, 1);
  assert.deepEqual(result.unresolved.map((u) => u.index), [2, 3]);
});

await check('缓存里的超长填空答案不复用', async () => {
  const cache = loadCache(cfg);
  putCached(cache, questions[2], { text: '很长'.repeat(10) });
  saveCache(cache);
  let calls2 = 0;
  const provider = {
    solve: async (qs) => {
      calls2 += 1;
      return `${qs[0].index}|正确短语`;
    },
  };
  const result = await solveQuestions({ cfg, questions: [questions[2]], provider });
  assert.equal(calls2, 1);
  assert.deepEqual(result.answers[0], { index: 3, text: '正确短语' });
});

await check('从解析页学习错题写入缓存', async () => {
  const { learnCorrections } = await import('../src/core/solver/learn.mjs');
  const learned = learnCorrections(cfg, [{ stem: '1+1 =', correctAnswer: '增强民族认同和团结' }], [questions[2]]);
  assert.equal(learned, 1);
  let calls3 = 0;
  const result = await solveQuestions({
    cfg,
    questions: [questions[2]],
    provider: {
      solve: async () => {
        calls3 += 1;
        return '3|错误';
      },
    },
  });
  assert.equal(calls3, 0);
  assert.deepEqual(result.answers[0], { index: 3, text: '增强民族认同和团结' });
});

fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nSOLVE FIXTURE FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`\nSOLVE FIXTURE PASS ${passed}/${passed}`);
