/** tools/list offers only what the connection can do (toets 5 Oct 2026, points 2 and 3), through the real factory and SDK. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildWorkflowServer } from '../../src/workflow-server.js';
import { connect, fullCaps, id } from './factory-fixtures.mjs';
const value = output => JSON.parse(output.content[0].text);
const eightScopes = ['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write','redirects:write'];
const fieldOps = ['meta.update','social.update','image_alt.update'], redirectOps = ['redirect.create','redirect.update','redirect.delete'];
// What PRO advertises with every scope granted: recovery on for fields and redirects.
const recoveryCaps = () => {
  const caps = fullCaps();
  caps.field_execution = { ...caps.field_execution, recovery_available: true };
  caps.redirect_execution = { contract_version: 1, available: true, mixed_available: true, read_available: true, rollback_available: true,
    recovery_available: true, recovery_delivery_available: true, operations: [...fieldOps, ...redirectOps] };
  return caps;
};
const specialistCaps = () => ({ ...recoveryCaps(), specialist_reads: Object.fromEntries(['get_site_diagnostics','get_redirects','get_topical_authority']
  .map(name => [name, { available: true }])) });
const byName = tools => new Map(tools.map(tool => [tool.name, tool]));
const listRaw = async client => byName((await client.request({ method: 'tools/list' }, ListToolsResultSchema)).tools);
let checks = 0; const ok = (v, label) => { checks++; assert.ok(v, label); }, eq = (a, b, label) => { checks++; assert.deepEqual(a, b, label); };

const recoveryFree = (tools, label) => {
  const changes = tools.get('get_changes'), execute = tools.get('execute_change_set');
  ok(!/recovery/i.test(changes.description), `${label}: get_changes description offers no recovery (${changes.description})`);
  eq(changes.inputSchema.properties.kind.enum, ['draft','execution'], `${label}: get_changes kind offers no recovery`);
  ok(!/recovery/i.test(execute.description), `${label}: execute_change_set description offers no recovery (${execute.description})`);
  ok(!Object.hasOwn(execute.inputSchema.properties, 'recovery_plan'), `${label}: execute_change_set lists no recovery_plan`);
  ok(!/trfr1|trrr1/.test(execute.inputSchema.properties.change_token.pattern), `${label}: no recovery token in the listed pattern`);
  ok(/trce1/.test(execute.inputSchema.properties.change_token.pattern), `${label}: ordinary execution tokens stay listed`);
};

// Point 2. A hosted connection is never offered recovery, even when the site advertises it.
for (const [label, capabilities] of [['field+redirect site', recoveryCaps()], ['field-only site', (() => { const c = recoveryCaps(); delete c.redirect_execution; return c; })()]]) {
  const fixture = await connect({}, { scopes: eightScopes, capabilities });
  try {
    recoveryFree(await listRaw(fixture.client), `hosted ${label}`);
    // The parse schema is unchanged: a direct recovery call still reaches the authorizer and is refused there.
    const output = value(await fixture.client.callTool({ name: 'get_changes', arguments: { change_set_id: id, kind: 'recovery' } }));
    eq(output.code, 'operation_unavailable', `hosted ${label}: direct recovery call refused`);
    eq(fixture.stub.events[0]?.type, 'authorize', `hosted ${label}: refused after authorization, not by the listing`);
    eq(fixture.stub.calls.length, 0, `hosted ${label}: nothing sent`);
  } finally { await fixture.close(); }
}

// Point 2, counter-test. Stdio on a site where recovery is available still offers it; a clamped profile does not.
const stdio = async options => {
  const transport = { async get() { return { contract_version: 2 }; }, async post() { return { contract_version: 2 }; } };
  const server = buildWorkflowServer(transport, options);
  const client = new Client({ name: 'Synthetic stdio client', version: '1.0' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try { return await listRaw(client); } finally { await client.close(); await server.close(); }
};
{
  const tools = await stdio({ capabilities: recoveryCaps() });
  const changes = tools.get('get_changes'), execute = tools.get('execute_change_set');
  eq(changes.description, 'Status/recovery preview.', 'stdio with recovery: description offers recovery');
  eq(changes.inputSchema.properties.kind.enum, ['draft','execution','recovery'], 'stdio with recovery: kind offers recovery');
  ok(/Recovery/.test(execute.description), 'stdio with recovery: execute_change_set explains recovery');
  ok(Object.hasOwn(execute.inputSchema.properties, 'recovery_plan'), 'stdio with recovery: recovery_plan listed');
  ok(/trrr1/.test(execute.inputSchema.properties.change_token.pattern), 'stdio with recovery: recovery token listed');
}
{
  const caps = recoveryCaps(); caps.mcp_bridge_compatibility = 'workflow-v2-1';
  const { clampToToolProfile } = await import('../../src/workflow-profile.js');
  recoveryFree(await stdio({ capabilities: clampToToolProfile(caps), profileClamp: true }), 'stdio clamped workflow-v2-1');
}
{
  // A stdio site that reads redirects but has no recovery is not told about it either.
  const caps = recoveryCaps(); caps.field_execution.recovery_available = false; caps.redirect_execution.recovery_available = false;
  const tools = await stdio({ capabilities: caps });
  ok(!/recovery/i.test(tools.get('get_changes').description), 'stdio without recovery: description offers none');
  eq(tools.get('get_changes').inputSchema.properties.kind.enum, ['draft','execution'], 'stdio without recovery: kind offers none');
}

// Point 3. The rule each read enforces is in its listing, and a refusal names the argument.
{
  const fixture = await connect({ responses: [{ body: { contract_version: 2, items: [] } }] }, { scopes: eightScopes, capabilities: specialistCaps() });
  try {
    const tools = await listRaw(fixture.client);
    ok(/trace needs redirect_id/.test(tools.get('get_redirects').description), 'get_redirects description names redirect_id as required for trace');
    for (const name of ['get_site_diagnostics','get_topical_authority']) {
      ok(/overview: section only/.test(tools.get(name).description), `${name} description: overview takes section only`);
    }
    for (const [name, args, message] of [
      ['get_site_diagnostics', { section: 'overview', limit: 5 }, /section overview accepts only section; remove limit; nothing was sent\./],
      ['get_site_diagnostics', { limit: 5, cursor: 'x' }, /remove limit, cursor;/],
      ['get_site_diagnostics', { section: 'metadata', url: 'https://site.example.invalid/' }, /url requires section 404_events/],
      ['get_topical_authority', { section: 'overview', limit: 5 }, /section overview accepts only section; remove limit; nothing was sent\./],
      ['get_topical_authority', { section: 'pages' }, /section pages requires cluster/],
      ['get_topical_authority', { section: 'gaps', cluster: 2 }, /section gaps does not accept cluster/],
      ['get_redirects', { section: 'trace' }, /section trace requires redirect_id/],
      ['get_redirects', { section: 'trace', redirect_id: 3, q: 'x' }, /section trace does not accept q/],
      ['get_redirects', { section: 'trace', q: 'x' }, /requires redirect_id and section trace does not accept q/],
      ['get_redirects', { section: 'rules', redirect_id: 3 }, /redirect_id requires section trace/],
    ]) {
      const output = value(await fixture.client.callTool({ name, arguments: args }));
      eq(output.code, 'invalid_request', `${name} ${JSON.stringify(args)} refused`);
      ok(message.test(output.message), `${name} ${JSON.stringify(args)}: ${output.message}`);
    }
    eq(fixture.stub.calls.length, 0, 'Refused arguments send nothing');
    // The paged sections still take limit.
    eq((await fixture.client.callTool({ name: 'get_site_diagnostics', arguments: { section: '404_urls', limit: 5 } })).isError, undefined, 'limit works on a list section');
  } finally { await fixture.close(); }
}
console.log(`PASS: hosted listing truth (${checks} checks): no recovery offered where it is refused (hosted, clamped, no-recovery stdio), still offered where available, specialist-read refusals name the argument.`);
