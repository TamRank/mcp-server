/** Hosted tools/list declares exact OAuth permissions; stdio remains token-based. */
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildWorkflowServer } from '../../src/workflow-server.js';
import { connect, fullCaps } from './factory-fixtures.mjs';

const redirectCaps = () => ({ ...fullCaps(), specialist_reads: { get_redirects: { available: true } }, redirect_execution: {
  contract_version: 1, available: true, read_available: true, rollback_available: true,
  operations: ['redirect.create','redirect.update','redirect.delete'],
} });
const rawSchema = z.object({ tools: z.array(z.object({ name: z.string() }).passthrough()) }).passthrough();
const byName = tools => new Map(tools.map(tool => [tool.name, tool]));
const oauthScopes = tool => {
  assert.deepEqual(tool.securitySchemes, tool._meta?.securitySchemes,
    `${tool.name}: top-level and compatibility mirror match`);
  assert.deepEqual(tool.securitySchemes.map(scheme => scheme.type), ['oauth2'],
    `${tool.name}: hosted is authenticated, never anonymous`);
  return tool.securitySchemes[0].scopes;
};

const hosted = await connect({}, { scopes: [
  'site:read','meta:write','audit:read','rollback','changes:write',
  'tasks:write','importance:write','redirects:write',
], capabilities: redirectCaps() });
try {
  const raw = byName((await hosted.client.request({ method: 'tools/list' }, rawSchema)).tools);
  const parsed = byName((await hosted.client.listTools()).tools);
  for (const name of ['get_site_context','get_capabilities','get_work_queue','get_signals',
    'search_pages','get_page','diagnose_page','get_redirects']) {
    const tool = raw.get(name);
    assert.ok(tool, `${name}: listed`);
    assert.deepEqual(oauthScopes(tool), ['site:read']);
    assert.deepEqual(parsed.get(name)?._meta?.securitySchemes, tool.securitySchemes,
      `${name}: mirror survives SDK parsing`);
  }
  assert.deepEqual(oauthScopes(raw.get('get_changes')), ['site:read','audit:read']);
  assert.deepEqual(oauthScopes(raw.get('update_work_item')),
    ['site:read','tasks:write','importance:write']);
  for (const name of ['plan_changes','execute_change_set','rollback_change_set']) {
    const scopes = oauthScopes(raw.get(name));
    assert.ok(scopes.includes('redirects:write'), `${name}: can handle redirects`);
    assert.ok(scopes.includes('meta:write'), `${name}: can handle fields`);
    assert.ok(scopes.includes('changes:write'), `${name}: requires change workflow`);
  }
  for (const name of ['get_changes','get_redirects','get_page'])
    assert.ok(!oauthScopes(raw.get(name)).includes('redirects:write'),
      `${name}: no redirect write permission on reads`);
} finally { await hosted.close(); }

// A denied write can request fresh consent without forwarding an untrusted or
// unrelated challenge. Authorization must still refuse the site request.
const challenge = 'Bearer resource_metadata="https://mcp.tamrank.com/.well-known/oauth-protected-resource/mcp", scope="site:read changes:write redirects:write", error="insufficient_scope", error_description="Additional permission required"';
for (const [code, supplied, expected] of [
  ['insufficient_scope', challenge, [challenge]],
  ['insufficient_scope', `${challenge}\r\nInjected: 1`, undefined],
  ['operation_unavailable', challenge, undefined],
]) {
  const fixture = await connect({ decisions: { plan_changes: {
    ok: false, code, message: 'Synthetic refusal', retryable: false,
    wwwAuthenticate: supplied,
  } } }, { capabilities: redirectCaps() });
  try {
    const output = await fixture.client.callTool({ name: 'plan_changes', arguments: {
      client_request_id: 'synthetic-scope-plan-001',
      origin: { kind: 'user_request', reference: 'synthetic', summary: 'Synthetic scope check' },
      items: [{ operation: 'redirect.create', target: { source_url: '/old' },
        fields: { target_url: { mode: 'set', value: '/new' }, redirect_type: { mode: 'set', value: 301 } } }],
    } });
    assert.equal(output.isError, true);
    assert.deepEqual(output._meta?.['mcp/www_authenticate'], expected);
    assert.equal(fixture.stub.calls.length, 0);
  } finally { await fixture.close(); }
}

const stdio = buildWorkflowServer({}, { profile: 'core', capabilities: fullCaps() });
const client = new Client({ name: 'Synthetic stdio client', version: '1' });
const [a,b] = InMemoryTransport.createLinkedPair();
await stdio.connect(a); await client.connect(b);
try {
  const tools = (await client.request({ method: 'tools/list' }, rawSchema)).tools;
  for (const tool of tools) {
    assert.equal(tool.securitySchemes, undefined, `${tool.name}: stdio has no OAuth declaration`);
    assert.equal(tool._meta?.securitySchemes, undefined, `${tool.name}: stdio has no OAuth mirror`);
  }
} finally { await client.close(); await stdio.close(); }

console.log('PASS: hosted OAuth tool scopes; redirects write only on change tools, no stdio OAuth metadata');
