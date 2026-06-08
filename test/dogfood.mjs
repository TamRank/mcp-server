/**
 * E2E dogfood — runs the canonical agent loop through the MCP server transport:
 * read → dry-run → execute → audit → rollback → verify restored. Non-destructive
 * (the rollback restores the original value).
 *
 * Env: TAMRANK_PAT (full scopes), TAMRANK_SITE_URL, TAMRANK_TEST_POST.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POST = Number(process.env.TAMRANK_TEST_POST);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'index.js')],
  cwd: root,
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'tamrank-dogfood', version: '1.0.0' });
await client.connect(transport);

/** Parse the JSON out of a tool result (write results have a hint line first). */
function body(r) {
  const t = r.content?.[0]?.text || '';
  const i = t.indexOf('{');
  return i >= 0 ? JSON.parse(t.slice(i)) : {};
}
const call = (name, args) => client.callTool({ name, arguments: args });

console.log(`\n=== canonical loop through the MCP server (post ${POST}) ===`);
console.log('1) get_capabilities     -> tier =', body(await call('get_capabilities', {})).tier);
console.log('2) get_site_health      -> seo  =', body(await call('get_site_health', {})).scores?.seo?.value);

const dry = body(await call('update_meta', { post_id: POST, meta_title: 'DOGFOOD via MCP server' }));
console.log('3) update_meta dry-run  -> mode =', dry.mode, '| change_token', dry.change_token?.slice(0, 12) + '…');

const exe = body(await call('update_meta', { post_id: POST, meta_title: 'DOGFOOD via MCP server', execute: true, change_token: dry.change_token }));
console.log('4) update_meta execute  -> mode =', exe.mode, '| audit_id =', exe.audit_id);

const log = body(await call('get_audit_log', { post_id: POST, source: 'agent', limit: 3 }));
console.log('5) get_audit_log(agent) -> entries =', log.entries?.length, '| top =', log.entries?.[0]?.action, '| rollback_eligible =', log.entries?.[0]?.rollback_eligible);

const rdry = body(await call('rollback', { action_id: exe.audit_id }));
console.log('6) rollback dry-run     ->', rdry.plan);

const rexe = body(await call('rollback', { action_id: exe.audit_id, execute: true, change_token: rdry.change_token }));
console.log('7) rollback execute     -> mode =', rexe.mode, '| reverted =', rexe.reverted_action);

const after = body(await call('get_meta', { post_id: POST }));
console.log('8) title after rollback -> ', JSON.stringify(after.meta?.meta_title), '(restored)');

await client.close();
console.log('\nDOGFOOD LOOP DONE');
process.exit(0);
