import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { findBrowser, fixtureFile, profileDir } from './config.mjs';

async function portOpen(port, timeoutMs = 800) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitPort(port, deadlineMs = 25000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/**
 * 单例浏览器会话：优先复用已在目标端口监听的浏览器，否则启动一个带持久 profile 的。
 * profile 目录放在 .profiles/（已被 .gitignore 排除），登录态只保存在本机。
 */
export class BrowserSession {
  constructor(cfg) {
    this.cfg = cfg;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.spawned = false;
  }

  async ensure() {
    if (this.browser && this.page && !this.page.isClosed()) return this.page;

    const port = this.cfg.site.cdpPort;
    if (!(await portOpen(port))) {
      const exe = findBrowser(this.cfg.site.browser);
      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir(this.cfg)}`,
        '--no-first-run',
        '--no-default-browser-check',
        `--window-size=${this.cfg.site.windowSize}`,
      ];
      if (this.cfg.site.headless) args.push('--headless=new');
      if (this.cfg.site.noSandbox) args.push('--no-sandbox');
      args.push('about:blank');

      spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
      this.spawned = true;
      if (!(await waitPort(port))) {
        throw new Error(`浏览器调试端口 ${port} 未能在 25 秒内就绪`);
      }
    }

    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    this.context = this.browser.contexts()[0] || (await this.browser.newContext());
    this.page = this.pickPage() || (await this.context.newPage());
    return this.page;
  }

  pickPage() {
    const pages = this.context.pages().filter((p) => !p.isClosed());
    const host = this.cfg.site.host;
    if (host) {
      const hit = pages.find((p) => p.url().startsWith(host));
      if (hit) return hit;
    }
    // 学习页在另一个子域，且求解器会常驻一个 chat.deepseek.com 标签页：
    // 都匹配不到配置域名时，优先挑「不是空白页、也不是求解器页」的那个。
    const preferred = pages.find(
      (p) => !/^about:blank/.test(p.url()) && !/chat\.deepseek\.com/.test(p.url()),
    );
    return preferred || pages[0] || null;
  }

  /** 打开目标页；若配置了 fixturePath 则加载本地自测页 */
  async open(url) {
    const page = await this.ensure();
    const fixture = fixtureFile(this.cfg);
    if (fixture && !url) {
      const html = fs.readFileSync(fixture, 'utf8');
      await page.setContent(html, { waitUntil: 'load' });
      return page;
    }
    const target = url || this.cfg.site.host;
    if (!target) throw new Error('未指定地址：请在 config.json 填 site.host，或传 url');
    if (!page.url().startsWith(target)) {
      await page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: this.cfg.behavior.navigationTimeoutMs,
      });
    }
    return page;
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
