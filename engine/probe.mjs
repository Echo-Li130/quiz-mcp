#!/usr/bin/env node
/**
 * 独立的页面结构探测工具，不依赖 MCP。
 * 用法：node engine/probe.mjs [--url https://example.edu/paper]
 */
import { loadConfig } from '../src/core/config.mjs';
import { getSession } from '../src/session.mjs';
import { probePage } from '../src/core/probe.mjs';

const argv = process.argv.slice(2);
const urlFlag = argv.indexOf('--url');
const url = urlFlag >= 0 ? argv[urlFlag + 1] : '';

const cfg = loadConfig();
const session = getSession(cfg);

const page = await session.open(url);
await page.waitForTimeout(1500);
const info = await probePage(page);
process.stdout.write(JSON.stringify({ ok: true, ...info }, null, 2) + '\n');
process.exit(0);
