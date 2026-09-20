/**
 * Smoke test — spawns the server over stdio and drives it like a real MCP client.
 * Requires TAMRANK_PAT + TAMRANK_SITE_URL in the env (and optionally
 * TAMRANK_TEST_POST for a non-destructive dry-run update_meta).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POST = process.env.TAMRANK_TEST_POST;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'index.js')],
  cwd: root,
  env: { ...process.env },
  stderr: 'inherit',
});

const client = new Client({ name: 'tamrank-smoke', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\nTOOLS (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

async function call(name, args, expectError = false) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || '';
  console.log(`\n# ${name} ${r.isError ? '[ERROR]' : '[ok]'}\n${text.slice(0, 360)}`);
  assert.equal(!!r.isError, expectError, `${name} ${expectError ? 'should fail' : 'returned a tool error'}: ${text.slice(0, 240)}`);
  return r;
}

try {
  await call('get_capabilities', {});
  await call('get_site_health', {});
  if (POST) {
    await call('update_meta', { post_id: Number(POST), meta_title: 'MCP SMOKE (dry-run only, not applied)' });
  }
  await call('get_audit_log', { limit: 3 });
  // The nonexistent action must fail cleanly (403 without scope or 404 with it).
  await call('rollback', { action_id: 999999 }, true);
  console.log('\nSMOKE OK');
} finally {
  await client.close();
}
