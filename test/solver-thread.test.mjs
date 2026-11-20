#!/usr/bin/env node
/** 会话线程自测：复用同一页、按记录地址续用、到上限轮换、提问间隔（不联网、不开浏览器）。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureThreadPage,
  noteSend,
  readThreadFile,
  rotateIfNeeded,
  threadState,
  waitForSlot,
  withThreadLock,
} from '../src/core/solver/thread.mjs';

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-thread-'));

function makeCfg(overrides = {}) {
  return {
    solver: {
      web: {
        url: 'https://chat.deepseek.com/',
        keepThread: true,
        minIntervalMs: 15000,
        maxPromptsPerThread: 40,
        threadMaxAgeMs: 43200000,
        rotateCooldownMs: 0,
        threadFile: path.join(dir, `thread-${Math.random().toString(16).slice(2)}.json`),
        selectors: {},
        ...overrides.web,
      },
    },
    behavior: { navigationTimeoutMs: 5000 },
  };
}

class FakePage {
  constructor(url = 'about:blank') {
    this._url = url;
    this._closed = false;
    this.gotos = [];
    this.brought = 0;
  }

  url() {
    return this._url;
  }

  isClosed() {
    return this._closed;
  }

  close() {
    this._closed = true;
    return Promise.resolve();
  }

  async goto(url) {
    this.gotos.push(url);
    this._url = url;
  }

  async bringToFront() {
    this.brought += 1;
  }

  async waitForTimeout() {}
}

function makeSession() {
  const pages = [];
  const session = {
    pages,
    context: {
      pages: () => pages.filter((p) => !p.isClosed()),
      newPage: async () => {
        const page = new FakePage('about:blank');
        pages.push(page);
        return page;
      },
    },
    ensure: async () => pages[0] || null,
  };
  return session;
}

await check('连续取页复用同一个标签，只新建一次', async () => {
  const session = makeSession();
  const cfg = makeCfg();
  const first = await ensureThreadPage(session, cfg);
  const second = await ensureThreadPage(session, cfg);
  assert.equal(first, second);
  assert.equal(session.pages.length, 1);
  assert.deepEqual(first.gotos, [cfg.solver.web.url]);
});

await check('标签页被关后按记录地址续用，而不是回首页', async () => {
  const session = makeSession();
  const cfg = makeCfg();
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/a/chat/s/abc123';
  noteSend(session, page, cfg);
  await page.close();

  const again = await ensureThreadPage(session, cfg);
  assert.notEqual(again, page);
  assert.equal(again.url(), 'https://chat.deepseek.com/a/chat/s/abc123');
  assert.notEqual(again.gotos[0], cfg.solver.web.url);
});

await check('线程记录落盘，新会话对象能读出来', async () => {
  const session = makeSession();
  const cfg = makeCfg();
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/a/chat/s/persist';
  noteSend(session, page, cfg);

  const saved = readThreadFile(cfg);
  assert.equal(saved.url, page._url);
  assert.equal(saved.sentCount, 1);
});

await check('达提问上限触发轮换：冷却、回首页、清空记录', async () => {
  const session = makeSession();
  const cfg = makeCfg({ web: { maxPromptsPerThread: 2 } });
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/a/chat/s/limit';
  noteSend(session, page, cfg);
  noteSend(session, page, cfg);

  let cooled = 0;
  const rotated = await rotateIfNeeded(session, cfg, {
    now: () => Date.now(),
    sleep: async () => { cooled += 1; },
    rotateCooldownMs: 0,
  });
  assert.equal(rotated, true);
  assert.equal(threadState(session).sentCount, 0);
  assert.equal(readThreadFile(cfg), null);
  assert.equal(page.gotos.at(-1), cfg.solver.web.url);
  assert.equal(typeof cooled, 'number');
});

await check('未达上限不轮换', async () => {
  const session = makeSession();
  const cfg = makeCfg();
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/a/chat/s/ok';
  noteSend(session, page, cfg);
  assert.equal(await rotateIfNeeded(session, cfg), false);
  assert.equal(threadState(session).sentCount, 1);
});

await check('两次提问间隔不足时补足等待', async () => {
  const session = makeSession();
  const cfg = makeCfg({ web: { minIntervalMs: 15000 } });
  const page = await ensureThreadPage(session, cfg);
  noteSend(session, page, cfg, { now: () => 1000 });

  let waited = null;
  const wait = await waitForSlot(session, cfg, {
    now: () => 4000,
    sleep: async (ms) => { waited = ms; },
  });
  assert.equal(wait, 12000);
  assert.equal(waited, 12000);
});

await check('首页 URL 不会被记成会话地址', async () => {
  const session = makeSession();
  const cfg = makeCfg();
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/'; // 仍是首页 = 没进入会话
  noteSend(session, page, cfg);
  const state = threadState(session);
  assert.equal(state.sentCount, 1);
  assert.equal(state.url, '');
  assert.equal(readThreadFile(cfg).url, '');
});

await check('同一 session 的求解按顺序串行', async () => {
  const session = makeSession();
  const order = [];
  const slow = () => withThreadLock(session, async () => {
    order.push('a-start');
    await new Promise((r) => setTimeout(r, 20));
    order.push('a-end');
  });
  const fast = () => withThreadLock(session, async () => {
    order.push('b-start');
    order.push('b-end');
  });
  await Promise.all([slow(), fast()]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});

fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nTHREAD TEST FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`\nTHREAD TEST PASS ${passed}/${passed}`);
