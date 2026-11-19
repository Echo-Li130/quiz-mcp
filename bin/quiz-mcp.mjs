#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../src/core/config.mjs';
import { registerTools } from '../src/tools.mjs';

const cfg = loadConfig();
const server = new McpServer({ name: 'quiz-mcp', version: '0.2.0' });
registerTools(server, cfg);

await server.connect(new StdioServerTransport());
process.stderr.write('[quiz-mcp] ready (stdio)\n');
