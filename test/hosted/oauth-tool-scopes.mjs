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
const sevenScopes = ['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write'];
const eightScopes = [...sevenScopes,'redirects:write'];
const rawSchema = z.object({ tools: z.array(z.object({ name: z.string() }).passthrough()) }).passthrough();
const byName = tools => new Map(tools.map(tool => [tool.name, tool]));
const oauthScopes = tool => {
  assert.deepEqual(tool.securitySchemes, tool._meta?.securitySchemes,
    `${tool.name}: top-level and compatibility mirror match`);
  assert.deepEqual(tool.securitySchemes.map(scheme => scheme.type), ['oauth2'],
    `${tool.name}: hosted is authenticated, never anonymous`);
  return tool.securitySchemes[0].scopes;
};

const hosted = await connect({}, { scopes: eightScopes, offeredScopes: eightScopes, capabilities: redirectCaps() });
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
  for (const name of ['plan_changes','execute_change_set','rollback_change_set'])
    assert.deepEqual(oauthScopes(raw.get(name)),
      ['site:read','changes:write','meta:write','audit:read','rollback','redirects:write'],
      `${name}: field and redirect sets require all five API write-flow scopes`);
  for (const name of ['get_changes','get_redirects','get_page'])
    assert.ok(!oauthScopes(raw.get(name)).includes('redirects:write'),
      `${name}: no redirect write permission on reads`);
} finally { await hosted.close(); }

// With the redirect feature flag off, the authorization server offers seven
// scopes, so tools must not ask for an eighth even if capabilities drift.
const noRedirect = await connect({}, { offeredScopes: sevenScopes, capabilities: redirectCaps() });
try {
  const tools = byName((await noRedirect.client.request({ method: 'tools/list' }, rawSchema)).tools);
  for (const name of ['plan_changes','execute_change_set','rollback_change_set'])
    assert.deepEqual(oauthScopes(tools.get(name)),
      ['site:read','changes:write','meta:write','audit:read','rollback'],
      `${name}: no unoffered redirects:write scope`);
} finally { await noRedirect.close(); }

// A global flag can offer redirects while this particular site lacks the PRO
// capability. Do not request a permission it cannot currently use.
const unsupportedSite = await connect({}, { offeredScopes: eightScopes });
try {
  const tools = byName((await unsupportedSite.client.request({ method: 'tools/list' }, rawSchema)).tools);
  for (const name of ['plan_changes','execute_change_set','rollback_change_set'])
    assert.ok(!oauthScopes(tools.get(name)).includes('redirects:write'),
      `${name}: site without redirect lane does not request redirect permission`);
} finally { await unsupportedSite.close(); }

// With the flag on but this grant still missing redirects:write, the AS offers
// eight scopes while the filtered capability is unavailable. Request upgrade.
const upgradeCaps = () => ({ ...fullCaps(), redirect_execution: {
  contract_version: 1, available: false, read_available: false,
  rollback_available: false, operations: [],
} });
const upgrade = await connect({}, { capabilities: upgradeCaps(), offeredScopes: eightScopes });
try {
  const tools = byName((await upgrade.client.request({ method: 'tools/list' }, rawSchema)).tools);
  for (const name of ['plan_changes','execute_change_set','rollback_change_set'])
    assert.ok(oauthScopes(tools.get(name)).includes('redirects:write'),
      `${name}: existing seven-scope grant can upgrade`);
} finally { await upgrade.close(); }

// A denied write can request fresh consent without forwarding an untrusted or
// unrelated challenge. Authorization must still refuse the site request.
const metadataUrl = 'https://mcp.tamrank.com/.well-known/oauth-protected-resource/mcp';
const challengeFor = url => `Bearer resource_metadata="${url}", scope="site:read changes:write redirects:write", error="insufficient_scope", error_description="Additional permission required"`;
const challenge = challengeFor(metadataUrl);
for (const [code, supplied, expected] of [
  ['insufficient_scope', challenge, [challenge]],
  ['insufficient_scope', `${challenge}\r\nInjected: 1`, undefined],
  ['operation_unavailable', challenge, undefined],
]) {
  const fixture = await connect({ decisions: { plan_changes: {
    ok: false, code, message: 'Synthetic refusal', retryable: false,
    wwwAuthenticate: supplied,
  } } }, { capabilities: upgradeCaps(), offeredScopes: eightScopes, resourceMetadataUrl: metadataUrl });
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

// A seven-scope grant has no redirect capability. Syntactically valid redirect
// plans/executions still reach the authorizer for re-consent, never WordPress;
// malformed execution input continues to fail before authorization.
{
  const fixture = await connect({ decisions: { plan_changes: {
    ok: false, code: 'insufficient_scope', message: 'Synthetic redirect scope missing',
    retryable: false, wwwAuthenticate: challenge,
  }, execute_change_set: {
    ok: false, code: 'insufficient_scope', message: 'Synthetic redirect scope missing',
    retryable: false, wwwAuthenticate: challenge,
  }, rollback_change_set: {
    ok: false, code: 'insufficient_scope', message: 'Synthetic redirect scope missing',
    retryable: false, wwwAuthenticate: challenge,
  } } }, { capabilities: upgradeCaps(), offeredScopes: eightScopes, resourceMetadataUrl: metadataUrl });
  try {
    const plan = { client_request_id: 'synthetic-redirect-plan-001',
      origin: { kind: 'user_request', reference: 'synthetic', summary: 'Synthetic scope upgrade' },
      items: [{ operation: 'redirect.create', target: { source_url: '/old' },
        fields: { target_url: { mode: 'set', value: '/new' }, redirect_type: { mode: 'set', value: 301 } } }],
    };
    const deniedPlan = await fixture.client.callTool({ name: 'plan_changes', arguments: plan });
    assert.equal(JSON.parse(deniedPlan.content[0].text).code, 'insufficient_scope');
    assert.deepEqual(deniedPlan._meta?.['mcp/www_authenticate'], [challenge]);
    assert.equal(fixture.stub.events[0]?.toolName, 'plan_changes');
    assert.equal(fixture.stub.calls.length, 0);
    const args = { change_set_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      change_token: 'trcx1.' + 'b'.repeat(64),
      confirmation: { plan_hash: 'a'.repeat(64), confirmed: true, acknowledgements: [] } };
    const denied = await fixture.client.callTool({ name: 'execute_change_set', arguments: args });
    assert.equal(JSON.parse(denied.content[0].text).code, 'insufficient_scope');
    assert.deepEqual(denied._meta?.['mcp/www_authenticate'], [challenge]);
    assert.equal(fixture.stub.events[1]?.toolName, 'execute_change_set');
    assert.equal(fixture.stub.calls.length, 0);
    const events = fixture.stub.events.length;
    const invalid = await fixture.client.callTool({ name: 'execute_change_set', arguments: {
      ...args, change_token: '',
    } });
    assert.equal(JSON.parse(invalid.content[0].text).code, 'invalid_request');
    assert.equal(fixture.stub.events.length, events);
    const deniedRollback = await fixture.client.callTool({ name: 'rollback_change_set', arguments: {
      change_set_id: args.change_set_id, client_request_id: 'synthetic-rollback-scope-001',
      item_ids: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    } });
    assert.equal(JSON.parse(deniedRollback.content[0].text).code, 'insufficient_scope');
    assert.deepEqual(deniedRollback._meta?.['mcp/www_authenticate'], [challenge]);
    assert.equal(fixture.stub.events[2]?.toolName, 'rollback_change_set');
    assert.equal(fixture.stub.calls.length, 0);
  } finally { await fixture.close(); }
}

// Staging uses its own canonical protected-resource URL. A production-origin
// challenge may not be forwarded there, while the staging-origin one can.
{
  const stagingUrl = 'https://mcp-staging.tamrank.com/.well-known/oauth-protected-resource/mcp';
  const fixture = await connect({ decisions: { plan_changes: {
    ok: false, code: 'insufficient_scope', message: 'Synthetic staging permission missing',
    retryable: false, wwwAuthenticate: challengeFor(stagingUrl),
  } } }, { capabilities: upgradeCaps(), offeredScopes: eightScopes, resourceMetadataUrl: stagingUrl });
  try {
    const output = await fixture.client.callTool({ name: 'plan_changes', arguments: {
      client_request_id: 'synthetic-staging-plan-001',
      origin: { kind: 'user_request', reference: 'synthetic', summary: 'Synthetic staging check' },
      items: [{ operation: 'redirect.create', target: { source_url: '/old' },
        fields: { target_url: { mode: 'set', value: '/new' }, redirect_type: { mode: 'set', value: 301 } } }],
    } });
    assert.deepEqual(output._meta?.['mcp/www_authenticate'], [challengeFor(stagingUrl)]);
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
