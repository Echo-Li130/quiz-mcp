import { BrowserSession } from './core/browser.mjs';

let session = null;

/** 一个 MCP 进程内共享同一只浏览器，避免重复启动和 profile 锁冲突 */
export function getSession(cfg) {
  if (!session) session = new BrowserSession(cfg);
  return session;
}

export async function closeSession() {
  if (!session) return false;
  await session.close();
  session = null;
  return true;
}
