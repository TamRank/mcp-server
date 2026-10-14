/** Golf 2b E2E against a local PRO site (stdio bridge of this checkout). PAT comes from the environment and is never printed.
 * Usage: TAMRANK_SITE_URL=http://localhost:10003 TAMRANK_PAT=... node scripts/e2e-golf2b-local.mjs <page-url> [<page-url-2>] */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const site = process.env.TAMRANK_SITE_URL, pat = process.env.TAMRANK_PAT;
if (!site || !pat) { console.error('TAMRANK_SITE_URL and TAMRANK_PAT are required.'); process.exit(2); }
const [pageA, pageB = pageA] = process.argv.slice(2);
const redact = text => text.split(pat).join('[pat]');
const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../index-workflow.js', import.meta.url).pathname],
  env: { ...process.env, TAMRANK_SITE_URL: site, TAMRANK_PAT: pat }, stderr: 'ignore' });
const client = new Client({ name: 'golf2b-e2e', version: '1' });
await client.connect(transport);
const call = async (name, args) => {
  const out = await client.callTool({ name, arguments: args });
  console.log(`\n### ${name} ${JSON.stringify(args)}${out.isError ? ' (isError)' : ''}\n${redact(out.content[0].text)}`);
  return out;
};
try {
  const names = (await client.listTools()).tools.map(t => t.name);
  console.log('### tools/list (' + names.length + '): ' + names.join(', '));
  const caps = JSON.parse((await client.callTool({ name: 'get_capabilities', arguments: {} })).content[0].text);
  console.log('### get_capabilities (uitsnede): ' + JSON.stringify({ live_check: caps.live_check, index_checks: caps.index_checks,
    scan_limits: caps.scan_limits, get_outcomes: caps.reads?.get_outcomes }));
  await call('list_changes', { limit: 3 });
  await call('list_changes', { url: pageA, since: '2026-10-01', limit: 5 });
  await call('get_outcomes', { url: pageA, limit: 1 });
  await call('live_check', { url: pageA });
  await call('live_check', { url: 'https://evil.example/' });
  await call('live_check', { url: pageB });
  await call('live_check', { url: pageA }); // with the temporary limit of 2 per hour: the limit message
  if (names.includes('start_scan')) {
    await call('start_scan', { type: 'index', urls: [pageA, pageB] });
  } else console.log('\n### start_scan: not listed (this PAT or site does not offer index checks)');
} finally { await client.close(); }
