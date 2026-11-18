#!/usr/bin/env node
/**
 * MCP 协议自测：以真实 MCP 客户端身份连接本机 server，
 * 验证握手、listTools，并调用 quiz_open / quiz_collect / quiz_close。
 * 全程使用内置 fixture，不访问外网、不需要登录。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'bin', 'quiz-mcp.mjs')],
  cwd: ROOT,
  env: { ...process.env, QUIZ_CONFIG: 'test/config.fixture.json' },
  stderr: 'pipe',
});

const client = new Client({ name: 'quiz-mcp-selftest', version: '0.1.0' });
await client.connect(transport);
console.log('MCP 握手成功');

const { tools } = await client.listTools();
console.log(`工具数量：${tools.length}`);
tools.forEach((t) => console.log(`  - ${t.name}`));

const open = await client.callTool({ name: 'quiz_open', arguments: {} });
console.log('quiz_open:', String(open.content?.[0]?.text || '').slice(0, 160).replace(/\s+/g, ' '));

const collect = await client.callTool({ name: 'quiz_collect', arguments: { max: 10 } });
const parsed = JSON.parse(String(collect.content?.[0]?.text || '{}'));
console.log('quiz_collect: count =', parsed.count);

await client.callTool({ name: 'quiz_close', arguments: {} });
await client.close();

const ok = tools.length === 9 && parsed.count === 4;
console.log(ok ? '\nMCP TEST PASS' : '\nMCP TEST FAIL');
process.exit(ok ? 0 : 1);
