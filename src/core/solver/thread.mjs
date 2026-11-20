/**
 * 网页版求解会话（thread）管理。
 *
 * 背景：网页版 DeepSeek 从首页发问会新建一个对话；旧实现每次求解都新开标签页并回首页，
 * 批量答题时会在短时间内堆出几十个新对话，容易触发平台风控。
 *
 * 这里把「对话」当成可复用资源：
 *   - 一个进程内只保留一个求解标签页；
 *   - 发送后记录会话地址（/a/chat/s/...），下次优先续用；
 *   - 两次提问之间强制最小间隔；
 *   - 单个对话提问数达上限或超龄时才轮换，且轮换前冷却。
 */
import fs from 'node:fs';
import path from 'node:path';
import { threadFilePath } from '../config.mjs';

const CHAT_THREAD_RE = /\/a\/chat\/s\//;
const stateMap = new WeakMap();
const lockMap = new WeakMap();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isChatUrl(url) {
  return CHAT_THREAD_RE.test(String(url || ''));
}

export function threadState(session) {
  let state = stateMap.get(session);
  if (!state) {
    state = {
      page: null,
      url: '',
      sentCount: 0,
      lastSentAt: 0,
      createdAt: 0,
      loaded: false,
    };
    stateMap.set(session, state);
  }
  return state;
}

export function readThreadFile(cfg) {
  const file = threadFilePath(cfg);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      url: typeof raw.url === 'string' ? raw.url : '',
      sentCount: Number(raw.sentCount) || 0,
      createdAt: Number(raw.createdAt) || 0,
      lastAt: Number(raw.lastAt) || 0,
    };
  } catch {
    return null;
  }
}

export function writeThreadFile(cfg, state) {
  const file = threadFilePath(cfg);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        version: 1,
        url: state.url || '',
        sentCount: state.sentCount || 0,
        createdAt: state.createdAt || 0,
        lastAt: state.lastSentAt || 0,
      }, null, 2),
      'utf8',
    );
    fs.renameSync(tmp, file);
  } catch {
    /* 线程记录写失败不影响求解 */
  }
}

export function clearThreadFile(cfg) {
  try {
    fs.rmSync(threadFilePath(cfg), { force: true });
  } catch {
    /* 删不掉就忽略 */
  }
}

function resetState(state) {
  state.page = null;
  state.url = '';
  state.sentCount = 0;
  state.lastSentAt = 0;
  state.createdAt = 0;
  state.loaded = true;
}

/** 进程首次使用时把磁盘上的会话记录读进内存。 */
function hydrate(session, cfg) {
  const state = threadState(session);
  if (state.loaded) return state;
  const saved = readThreadFile(cfg);
  if (saved) {
    state.url = saved.url || '';
    state.sentCount = saved.sentCount || 0;
    state.createdAt = saved.createdAt || 0;
    state.lastSentAt = saved.lastAt || 0;
  }
  state.loaded = true;
  return state;
}

function isAlive(page) {
  return Boolean(page) && typeof page.isClosed === 'function' && !page.isClosed();
}

function chatOrigin(cfg) {
  try {
    return new URL(cfg.solver.web.url).origin;
  } catch {
    return 'https://chat.deepseek.com';
  }
}

/**
 * 取出可复用的求解页：
 *   1) 内存里的页还活着 → 直接用；
 *   2) 否则在现开标签里找记录过的会话地址，其次任意会话页；
 *   3) 都没有才新建页，并优先 goto 记录过的会话地址（不是首页）。
 */
export async function ensureThreadPage(session, cfg) {
  const web = cfg.solver.web;
  const state = hydrate(session, cfg);

  if (isAlive(state.page)) {
    await state.page.bringToFront?.().catch?.(() => {});
    return state.page;
  }

  if (!session.context) await session.ensure();
  const pages = (session.context?.pages?.() || []).filter((p) => !p.isClosed());
  const origin = chatOrigin(cfg);

  let page = null;
  if (state.url) page = pages.find((p) => p.url() === state.url) || null;
  if (!page) page = pages.find((p) => isChatUrl(p.url())) || null;
  if (!page) page = pages.find((p) => String(p.url()).startsWith(origin)) || null;

  if (!page) {
    page = await session.context.newPage();
    const target = state.url || web.url;
    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: cfg.behavior?.navigationTimeoutMs || 60000,
    });
    await page.waitForTimeout?.(1200);
  }

  state.page = page;
  return page;
}

/** 两次提问之间至少间隔 minIntervalMs，用假时钟时可注入 now/sleep。 */
export async function waitForSlot(session, cfg, opts = {}) {
  const web = cfg.solver.web;
  const interval = Number(web.minIntervalMs) || 0;
  if (interval <= 0) return 0;
  const state = hydrate(session, cfg);
  const now = opts.now ? opts.now() : Date.now();
  if (!state.lastSentAt) return 0;
  const wait = state.lastSentAt + interval - now;
  if (wait <= 0) return 0;
  await (opts.sleep || sleep)(wait);
  return wait;
}

/** 一次提问成功后记账：会话地址、次数、时间，并落盘。 */
export function noteSend(session, page, cfg, opts = {}) {
  const state = threadState(session);
  const now = opts.now ? opts.now() : Date.now();
  state.sentCount += 1;
  state.lastSentAt = now;
  if (!state.createdAt) state.createdAt = now;
  const url = typeof page.url === 'function' ? page.url() : '';
  if (isChatUrl(url)) state.url = url;
  if (cfg.solver.web.keepThread !== false) writeThreadFile(cfg, state);
  return state;
}

/**
 * 是否该换新对话：提问数到上限，或会话超龄。
 * 需要换时先冷却，再把当前标签页导航回首页并清空记录。
 */
export async function rotateIfNeeded(session, cfg, opts = {}) {
  const web = cfg.solver.web;
  const state = hydrate(session, cfg);
  const maxPrompts = Number(web.maxPromptsPerThread) || 0;
  const maxAge = Number(web.threadMaxAgeMs) || 0;
  const now = opts.now ? opts.now() : Date.now();

  const tooMany = maxPrompts > 0 && state.sentCount >= maxPrompts;
  const tooOld = maxAge > 0 && state.createdAt > 0 && now - state.createdAt >= maxAge;
  if (!tooMany && !tooOld) return false;

  const cooldown = Number(web.rotateCooldownMs) || 0;
  if (cooldown > 0) await (opts.sleep || sleep)(cooldown);

  if (isAlive(state.page)) {
    await state.page.goto(web.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  resetState(state);
  clearThreadFile(cfg);
  return true;
}

/** 显式开新对话：关掉旧标签（或回首页）并清空记录。 */
export async function resetThread(session, cfg, opts = {}) {
  const state = threadState(session);
  if (isAlive(state.page)) {
    if (opts.close) await state.page.close().catch(() => {});
    else await state.page.goto(cfg.solver.web.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  resetState(state);
  clearThreadFile(cfg);
  return state;
}

/** 同一个 session 的求解串行执行，避免并发时同时往一个会话发问。 */
export function withThreadLock(session, fn) {
  const prev = lockMap.get(session) || Promise.resolve();
  const run = prev.then(fn, fn);
  lockMap.set(session, run.then(() => {}, () => {}));
  return run;
}
