#!/usr/bin/env node
/**
 * @tam-rank/mcp-server — entry point.
 *
 * A local stdio MCP server that bridges an AI client (Claude Desktop, Cursor,
 * Claude Code) to the TamRank Agent-API on one WordPress site. Configured from the
 * environment:
 *
 *   TAMRANK_PAT       a site-local Personal Access Token (tamrank_pat_…)
 *   TAMRANK_SITE_URL  the site base URL (https://your-site.com)
 *   TAMRANK_TIMEOUT   optional request timeout in ms (default 30000)
 *
 * Everything is logged to stderr — stdout is the JSON-RPC channel and must stay
 * clean. Credentials never leave the machine; the server only forwards requests.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { TamRankClient, ApiError } from './src/rest.js';
import { registerTools } from './src/tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const PAT = process.env.TAMRANK_PAT;
const SITE_URL = process.env.TAMRANK_SITE_URL;
const TIMEOUT = Number(process.env.TAMRANK_TIMEOUT) || 30000;

function die(message, code = 1) {
  console.error(`\nTamRank MCP Server\n──────────────────\n${message}\n`);
  process.exit(code);
}

if (!PAT || !SITE_URL) {
  die(
    'Missing configuration. Set both environment variables:\n\n' +
    '  TAMRANK_PAT       your tamrank_pat_… token\n' +
    '  TAMRANK_SITE_URL  https://your-site.com\n\n' +
    'Create a token at https://tamrank.com/account/agent-tokens'
  );
}

if (!PAT.startsWith('tamrank_pat_')) {
  die('TAMRANK_PAT does not look like a TamRank token (expected the tamrank_pat_ prefix).');
}

const client = new TamRankClient({ siteUrl: SITE_URL, pat: PAT, timeoutMs: TIMEOUT });

/**
 * Preflight: confirm the site is reachable, the token is valid, and PRO is active
 * before exposing any tools (4d FREE-upgrade-exit). A FREE/unlicensed site can do
 * nothing through the agent API, so we surface the upgrade and exit cleanly rather
 * than start a server whose every call 402s.
 */
async function preflight() {
  try {
    const caps = await client.get('/capabilities');
    if (caps && caps.pro_active === false) {
      die(
        `${SITE_URL} is not on TamRank PRO.\n` +
        'The agent API requires an active PRO licence.\n\n' +
        'Upgrade: https://tamrank.com/pricing',
        0
      );
    }
    const scopes = caps?.agent?.scopes;
    console.error(
      `TamRank MCP Server v${pkg.version} — connected to ${SITE_URL}` +
      (Array.isArray(scopes) ? ` (scopes: ${scopes.join(', ') || 'none'})` : '')
    );
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        die('Authentication failed — the TAMRANK_PAT was rejected. Check the token (it may be revoked or expired).');
      }
      if (err.status === 402) {
        die(
          `${SITE_URL} is not on TamRank PRO.\n` +
          'The agent API requires an active PRO licence.\n\n' +
          'Upgrade: https://tamrank.com/pricing',
          0
        );
      }
      if (err.status === 0) {
        // Network/timeout — do not hard-fail; the client may retry once the site
        // is reachable. Tools will report the same error per call.
        console.error(`TamRank MCP Server: warning — ${err.message}. Starting anyway.`);
        return;
      }
      die(`Preflight failed (${err.status} ${err.code}): ${err.message}`);
    }
    die(`Preflight failed: ${err.message}`);
  }
}

async function main() {
  await preflight();

  const server = new McpServer({ name: 'tamrank', version: pkg.version });
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Connected. The client now drives via JSON-RPC over stdio.
}

main().catch((err) => {
  die(`Fatal: ${err.message}`);
});
