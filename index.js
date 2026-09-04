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
import { registerTools, INSTRUCTIONS } from './src/tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

/**
 * The TamRank logo, advertised in the server's Implementation so MCP clients that
 * render server icons (per the spec's `icons` field) show the brand mark instead
 * of an auto-generated letter avatar. A URL, not a data: URI — the inline base64
 * cost 12.3k characters in EVERY initialize response, more than a small server's
 * entire tool surface.
 */
const ICONS = [{
  src: 'https://tamrank.com/wp-content/uploads/2026/02/cropped-tamrank-favicon-192x192.png',
  mimeType: 'image/png',
  sizes: ['192x192'],
}];

const PAT = process.env.TAMRANK_PAT;
const SITE_URL = process.env.TAMRANK_SITE_URL;
const TIMEOUT = Number(process.env.TAMRANK_TIMEOUT) || 30000;

function die(message, code = 1) {
  console.error(`\nTamRank MCP Server\n──────────────────\n${message}\n`);
  process.exit(code);
}

// A configuration error stays fatal: there is nothing to connect to yet, so there
// is no session in which a diagnosis could be delivered.
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

const AUTH_FAILED = 'Authentication failed — the TAMRANK_PAT was rejected. Check the token (it may be revoked or expired).';
const NOT_PRO =
  `${SITE_URL} is not on TamRank PRO.\n` +
  'The agent API requires an active PRO licence.\n\n' +
  'Upgrade: https://tamrank.com/pricing';

/**
 * The preflight verdict, remembered for the life of the process.
 *
 * A rejected token or a missing PRO licence used to exit here, so the client saw
 * only "MCP error -32000: Connection closed" and could not tell an expired token
 * from a crashed server. The server now always starts: the diagnosis travels in the
 * initialize `instructions` and every tool call returns it as a tool error, without
 * touching the network.
 *
 * @type {{ok: boolean, status: number|null, code: string|null, message: string|null}}
 */
const PREFLIGHT = { ok: true, status: null, code: null, message: null };

function refuse(status, code, message) {
  PREFLIGHT.ok = false;
  PREFLIGHT.status = status;
  PREFLIGHT.code = code;
  PREFLIGHT.message = message;
  console.error(
    `\nTamRank MCP Server\n──────────────────\n${message}\n\n` +
    'The server keeps running so this reason reaches the client; every tool call returns it until it is fixed.\n'
  );
}

/**
 * Preflight: confirm the site is reachable, the token is valid and PRO is active.
 * Records the verdict in PREFLIGHT — it never exits.
 */
async function preflight() {
  try {
    const caps = await client.get('/capabilities');
    if (caps && caps.pro_active === false) {
      refuse(402, 'pro_required', NOT_PRO);
      return;
    }
    const scopes = caps?.agent?.scopes;
    console.error(
      `TamRank MCP Server v${pkg.version} — connected to ${SITE_URL}` +
      (Array.isArray(scopes) ? ` (scopes: ${scopes.join(', ') || 'none'})` : '')
    );
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return refuse(401, 'unauthorized', AUTH_FAILED);
      if (err.status === 402) return refuse(402, 'pro_required', NOT_PRO);
      if (err.status === 0) {
        // Network/timeout — not a verdict about the site or the token. The client
        // may retry once the site is reachable, so the tools stay live and report
        // the same error per call.
        console.error(`TamRank MCP Server: warning — ${err.message}. Starting anyway.`);
        return;
      }
      return refuse(err.status, err.code, `Preflight failed (${err.status} ${err.code}): ${err.message}`);
    }
    refuse(null, 'preflight_failed', `Preflight failed: ${err.message}`);
  }
}

/**
 * The instructions string the client reads at initialize. On a healthy connection
 * it carries the sequencing advice that used to be repeated across 40 tool
 * descriptions; on a refused one it carries the diagnosis, so a client that reads
 * only the handshake still learns why nothing works.
 *
 * @returns {string}
 */
function buildInstructions() {
  if (!PREFLIGHT.ok) {
    return `${PREFLIGHT.message}\n\nEvery tool call returns this same error until it is resolved.`;
  }
  return INSTRUCTIONS;
}

async function main() {
  await preflight();

  const server = new McpServer({
    name: 'tamrank',
    title: 'TamRank',
    version: pkg.version,
    websiteUrl: 'https://tamrank.com/agents',
    icons: ICONS,
  }, {
    instructions: buildInstructions(),
  });
  registerTools(server, client, PREFLIGHT);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Connected. The client now drives via JSON-RPC over stdio.
}

main().catch((err) => {
  die(`Fatal: ${err.message}`);
});
