#!/usr/bin/env node
/** 限速自测：间隔为 0 不等待、轮换前冷却、keepThread=false 不落盘（不联网、不开浏览器）。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureThreadPage,
  noteSend,
  readThreadFile,
  rotateIfNeeded,
  waitForSlot,
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-pacing-'));

function makeCfg(web = {}) {
  return {
    solver: {
      web: {
        url: 'https://chat.deepseek.com/',
        keepThread: true,
        minIntervalMs: 15000,
        maxPromptsPerThread: 40,
        threadMaxAgeMs: 43200000,
        rotateCooldownMs: 5000,
        threadFile: path.join(dir, `p-${Math.random().toString(16).slice(2)}.json`),
        selectors: {},
        ...web,
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
  }
  url() { return this._url; }
  isClosed() { return this._closed; }
  close() { this._closed = true; return Promise.resolve(); }
  async goto(url) { this.gotos.push(url); this._url = url; }
  async bringToFront() {}
  async waitForTimeout() {}
}

function makeSession() {
  const pages = [];
  return {
    context: {
      pages: () => pages.filter((p) => !p.isClosed()),
      newPage: async () => {
        const page = new FakePage();
        pages.push(page);
        return page;
      },
    },
    ensure: async () => pages[0] || null,
  };
}

await check('minIntervalMs=0 时不做任何等待', async () => {
  const session = makeSession();
  const cfg = makeCfg({ minIntervalMs: 0 });
  const page = await ensureThreadPage(session, cfg);
  noteSend(session, page, cfg);
  let slept = false;
  const wait = await waitForSlot(session, cfg, { sleep: async () => { slept = true; } });
  assert.equal(wait, 0);
  assert.equal(slept, false);
});

await check('轮换前按 rotateCooldownMs 冷却', async () => {
  const session = makeSession();
  const cfg = makeCfg({ maxPromptsPerThread: 1, rotateCooldownMs: 5000 });
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/a/chat/s/x';
  noteSend(session, page, cfg);

  const sleeps = [];
  const rotated = await rotateIfNeeded(session, cfg, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(rotated, true);
  assert.deepEqual(sleeps, [5000]);
});

await check('keepThread=false 时不写线程文件', async () => {
  const session = makeSession();
  const cfg = makeCfg({ keepThread: false });
  const page = await ensureThreadPage(session, cfg);
  page._url = 'https://chat.deepseek.com/a/chat/s/y';
  noteSend(session, page, cfg);
  assert.equal(readThreadFile(cfg), null);
});

fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error(`\nPACING TEST FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`\nPACING TEST PASS ${passed}/${passed}`);
