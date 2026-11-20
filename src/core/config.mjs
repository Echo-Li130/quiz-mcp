import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 选择器的默认值——全部可在 adapter/config.json 里覆盖 */
export const DEFAULT_SELECTORS = {
  title: '.left-title .Ttile',
  questionRoot: '.ques-detail',
  section: '.ques-details-title .t-name',
  type: '.questionTitle .letterSortNum',
  stem: '.questionName pre, .questionName .centent-pre',
  radioItem: '.questionContent ul.radio-view li',
  radioLabel: '.letterSort',
  radioChecked: 'i.checkedIcon',
  multiItem: '.questionContent .checkbox-views label.el-checkbox',
  multiLabel: '.letterSort',
  multiChecked: 'is-checked',
  selectedHint: 'checked|selected|active|cur',
  blankInput: '.questionContent input[type=text], .questionContent input.el-input__inner',
  progress: '.answer-pro .pro',
  nextText: '下一题',
  prevText: '上一题',
  submit: 'span.reviewDone',
  analysisText: '查看作答记录与解析',
  redoText: '重新答题',
  promptRoot: '.el-message-box, .el-dialog__wrapper',
};

/**
 * 求解器（quiz_solve）的默认值。
 *
 * mode 默认 off —— 不启用时 quiz_solve 只回 solver-disabled，其余工具行为一字不变。
 * web  = 网页版 DeepSeek（复用同一个浏览器，登录态留在 .profiles/，题目不出本机进程）
 * api  = DeepSeek 兼容接口（按 token 计费，最稳）
 */
export const DEFAULT_SOLVER = {
  mode: 'off',
  batchSize: 8,
  timeoutMs: 120000,
  cacheFile: 'adapter/answer-cache.json',
  web: {
    url: 'https://chat.deepseek.com/',
    // 会话复用：默认沿用同一个对话，避免每次求解都新开对话触发风控
    keepThread: true,
    minIntervalMs: 15000, // 两次提问的最小间隔
    maxPromptsPerThread: 40, // 单个对话最多提问数，到上限才换新对话
    threadMaxAgeMs: 43200000, // 12 小时后换新对话
    rotateCooldownMs: 300000, // 换新对话前冷却 5 分钟
    threadFile: 'adapter/solver-thread.json',
    selectors: {
      input: 'textarea',
      send: 'button[type=submit]',
      reply: '[class*=markdown]',
      loginHint: '登录|Log in|Sign in|扫码登录|手机号',
    },
  },
  api: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
};

function mergeSolver(...parts) {
  const out = {
    ...DEFAULT_SOLVER,
    web: { ...DEFAULT_SOLVER.web, selectors: { ...DEFAULT_SOLVER.web.selectors } },
    api: { ...DEFAULT_SOLVER.api },
  };
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const { web, api, ...rest } = part;
    Object.assign(out, rest);
    if (web) {
      out.web = { ...out.web, ...web, selectors: { ...out.web.selectors, ...(web.selectors || {}) } };
    }
    if (api) out.api = { ...out.api, ...api };
  }
  return out;
}

const CONFIG_CANDIDATES = ['adapter/config.json', 'config.json'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 读取本地配置：adapter/config.json > config.json > 默认值。
 * 站点域名不写在代码里，必须由使用者本地填写。
 */
export function loadConfig(overrides = {}) {
  let local = {};
  const envPath = process.env.QUIZ_CONFIG;
  const candidates = envPath ? [envPath] : CONFIG_CANDIDATES;
  for (const rel of candidates) {
    const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    if (fs.existsSync(file)) {
      local = readJson(file);
      break;
    }
  }

  const site = {
    host: '',
    cdpPort: 9333,
    browser: 'auto',
    headless: false,
    noSandbox: process.env.QUIZ_NO_SANDBOX === '1',
    windowSize: '1280x900',
    fixturePath: process.env.QUIZ_FIXTURE || '',
    ...(local.site || {}),
    ...(overrides.site || {}),
  };

  return {
    site,
    selectors: { ...DEFAULT_SELECTORS, ...(local.selectors || {}), ...(overrides.selectors || {}) },
    behavior: {
      waitAfterClickMs: 220,
      waitAfterNextMs: 600,
      navigationTimeoutMs: 60000,
      ...(local.behavior || {}),
      ...(overrides.behavior || {}),
    },
    solver: mergeSolver(local.solver, overrides.solver),
  };
}

/** 缓存文件的绝对路径：配置里写相对路径时按仓库根解析，不依赖进程 cwd。 */
export function cacheFilePath(cfg) {
  const rel = cfg?.solver?.cacheFile || DEFAULT_SOLVER.cacheFile;
  return path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
}

/** 网页版求解会话记录文件：记下当前复用的对话地址与提问次数。 */
export function threadFilePath(cfg) {
  const rel = cfg?.solver?.web?.threadFile || DEFAULT_SOLVER.web.threadFile;
  return path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
}

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** 按配置或平台挑一个可用的浏览器可执行文件 */
export function findBrowser(name = 'auto') {
  const wanted = String(name || 'auto').toLowerCase();
  const filter = wanted === 'chrome'
    ? (p) => /chrome/i.test(p)
    : wanted === 'msedge' || wanted === 'edge'
      ? (p) => /edge/i.test(p)
      : () => true;
  const hit = BROWSERS.find((p) => filter(p) && fs.existsSync(p));
  if (!hit) {
    throw new Error('没有找到 Chrome / Edge 可执行文件，请安装其中之一，或在 config.json 里配置 site.browser');
  }
  return hit;
}

export function profileDir(cfg) {
  const dir = path.join(ROOT, '.profiles', `${cfg.site.browser || 'auto'}-${cfg.site.cdpPort}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function fixtureFile(cfg) {
  if (!cfg.site.fixturePath) return null;
  const file = path.isAbsolute(cfg.site.fixturePath)
    ? cfg.site.fixturePath
    : path.join(ROOT, cfg.site.fixturePath);
  return fs.existsSync(file) ? file : null;
}

export function siteUrl(cfg, url) {
  if (url) return url;
  if (!cfg.site.host) {
    throw new Error('未配置目标站点：请在 adapter/config.json 里填写 site.host，或调用时传入 url');
  }
  return cfg.site.host;
}
