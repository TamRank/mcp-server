import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createWorkflowServer } from '../../src/hosted/factory.js';
import { buildWorkflowServer } from '../../src/workflow-server.js';
import { createStubVps } from './stub-vps.mjs';
import { context, connect, fullCaps, toolCases, planArgs, executeArgs, nativeReply, id, hash } from './factory-fixtures.mjs';
const value = output => JSON.parse(output.content[0].text);
const calls = toolCases();

// Construction validates the entire context before making any server/request.
for (const field of ['validatedInstallation','grantContext','filteredCapabilities','auditContext','transport','authorizer']) {
  const stub = createStubVps(), ctx = context(stub); delete ctx[field];
  assert.throws(() => createWorkflowServer(ctx), /Invalid hosted context/); assert.equal(stub.calls.length, 0);
}
for (const edit of [
  c => c.validatedInstallation.workflow_profile = 'specialist', c => c.validatedInstallation.workflow_profile = 'legacy',
  c => c.validatedInstallation.blog_id = 0, c => c.validatedInstallation.generation = 1.1,
  c => c.validatedInstallation.installation_id = 'invalid', c => c.validatedInstallation.rest_style = 'invalid',
  c => c.validatedInstallation.rest_base_url = 'https://other.example.invalid/wp-json/tamrank/v2',
  c => c.validatedInstallation.rest_base_url = 'https://site.example.invalid/wp-json/tamrank/v1',
  c => c.validatedInstallation.rest_base_url = 'http://site.example.invalid/wp-json/tamrank/v2',
  c => c.validatedInstallation.rest_base_url = 'https://127.0.0.1/wp-json/tamrank/v2',
  c => c.validatedInstallation.rest_base_url = 'https://site.example.invalid:8443/wp-json/tamrank/v2',
  c => c.grantContext.scopes = ['site:read','root'], c => c.grantContext.scopes = ['site:read','site:read'],
  c => c.grantContext.account_id = '', c => c.auditContext.grantLabel = 'unknown',
  c => c.auditContext.clientLabel = '<script>', c => c.auditContext.request_id = '',
  c => c.transport.request = null, c => c.authorizer.authorizeOperation = null,
  c => c.authorizer.recordValidatedResult = null, c => c.filteredCapabilities.bad = () => {},
  c => c.filteredCapabilities = {}, c => c.filteredCapabilities.contract_version = 1,
  c => delete c.filteredCapabilities.mcp_bridge_compatibility,
  c => c.receiptStore = {}, c => c.recovery = {}, c => c.preview = true,
  c => c.validatedInstallation.preview = true,
]) { const ctx = context(createStubVps()); edit(ctx); assert.throws(() => createWorkflowServer(ctx)); }
// The port rule is its own refusal: an installation on :8443 is a contract question, not a typo.
for (const [url, message] of [['https://site.example.invalid:8443/wp-json/tamrank/v2', /HTTPS URL without an explicit port$/],
  ['http://site.example.invalid:8443/wp-json/tamrank/v2', /Invalid hosted context: HTTPS URL$/]]) {
  const ctx = context(createStubVps()); ctx.validatedInstallation.rest_base_url = url;
  assert.throws(() => createWorkflowServer(ctx), message);
}
{ const ctx = context(createStubVps()); ctx.validatedInstallation.canonical_home_url = 'https://site.example.invalid:8443/';
  assert.throws(() => createWorkflowServer(ctx), /HTTPS URL without an explicit port$/); }
{
  const ctx = context(createStubVps()), server = createWorkflowServer(ctx);
  assert.throws(() => ctx.validatedInstallation.rest_base_url = 'https://other.example.invalid/');
  assert.throws(() => ctx.grantContext.scopes.push('root'));
  assert.throws(() => ctx.filteredCapabilities.field_execution.available = false);
  assert.throws(() => ctx.authorizer.authorizeOperation = () => ({ ok: true }));
  await server.close();
}

// Every real SDK invocation traverses schema -> authorize -> request -> record.
{
  const fixture = await connect({ responses: calls.map(([, , body]) => ({ body })) });
  try {
    assert.deepEqual((await fixture.client.listTools()).tools.map(t => t.name), calls.map(([name]) => name));
    for (const [name, args] of calls) {
      const start = fixture.stub.events.length;
      const output = await fixture.client.callTool({ name, arguments: args });
      assert.equal(output.isError, undefined, `${name}: ${JSON.stringify(output)}`);
      assert.deepEqual(fixture.stub.events.slice(start).map(e => e.type), ['authorize','request','record'], name);
      assert.equal(fixture.stub.events[start].toolName, name);
      assert.deepEqual(fixture.stub.events[start].parsedArgs, args);
      assert.equal(fixture.stub.recorded.at(-1).toolName, name);
    }
    const body = JSON.parse(new TextDecoder().decode(fixture.stub.calls[9].bodyBytes));
    assert.equal(body.confirmation.agent.name, 'grant:22222222-2222-4222-8222-222222222222');
    assert.deepEqual(body.confirmation.client, { name: 'Synthetic MCP client', version: '2.4' });
    assert.equal(JSON.stringify(body).includes('OAuth fixture display'), false);
    assert.deepEqual(Object.keys(body).sort(), ['change_set_id','change_token','confirmation','client_request_id'].sort());
    assert.deepEqual(Object.keys(body.confirmation).sort(), ['plan_hash','confirmed','mode','acknowledgements','client','agent'].sort());
    assert.equal(body.client_request_id, 'mcp-execute-' + hash);
  } finally { await fixture.close(); }
}

// Deny independently for all twelve, including set-binding and hidden execution.
for (const [name, args] of calls) {
  const fixture = await connect({ decisions: { [name]: { ok: false, code: name === 'get_changes' ? 'change_set_forbidden' : 'insufficient_scope',
    message: 'Synthetic deny', retryable: false } } });
  try {
    const output = await fixture.client.callTool({ name, arguments: args });
    assert.equal(value(output).code, name === 'get_changes' ? 'change_set_forbidden' : 'insufficient_scope');
    assert.equal(fixture.stub.calls.length, 0); assert.equal(fixture.stub.recorded.length, 0);
    assert.deepEqual(fixture.stub.events[0].parsedArgs, args);
  } finally { await fixture.close(); }
}
{
  const fixture = await connect({ decisions: { execute_change_set: { ok: false, code: 'insufficient_scope', message: 'No write scope', retryable: false } } },
    { scopes: ['site:read'], capabilities: { contract_version: 2, mcp_bridge_compatibility: 'safe-beta-1', reads: { get_site_context: { available: true } } } });
  try {
    assert.deepEqual(fixture.ctx.grantContext.scopes, ['site:read']);
    assert.equal((await fixture.client.listTools()).tools.some(t => t.name === 'execute_change_set'), false);
    const output = await fixture.client.callTool({ name: 'execute_change_set', arguments: executeArgs() });
    assert.equal(value(output).code, 'insufficient_scope'); assert.equal(fixture.stub.calls.length, 0);
    assert.equal(fixture.stub.events[0].toolName, 'execute_change_set');
  } finally { await fixture.close(); }
}

// Invalid shape AND invalid semantic combinations never call authorization.
for (const [name, args] of [ ['get_page', {}], ['get_work_queue', { section: 'administration' }],
  ...['agent','agent_name','grant_label'].map(key => ['execute_change_set', { ...executeArgs(), [key]: 'spoof' }]) ]) {
  const fixture = await connect();
  try {
    assert.equal(value(await fixture.client.callTool({ name, arguments: args })).code, 'invalid_request');
    assert.equal(fixture.stub.events.length, 0); assert.equal(fixture.stub.calls.length, 0);
  } finally { await fixture.close(); }
}

// Protocol task hints are unavailable and cannot execute an ordinary tool.
{
  const fixture = await connect();
  try {
    await assert.rejects(fixture.client.request({ method: 'tools/call', params: { name: 'get_site_context', arguments: {}, task: { ttl: 1000 } } }, CallToolResultSchema), /does not support task creation/);
    assert.equal(fixture.stub.calls.length, 0);
    assert.equal(fixture.stub.events.length, 0);
  } finally { await fixture.close(); }
}

// A malformed authorizer result fails closed; the hook receives frozen data.
for (const permission of [undefined, {}, { ok: false }, 'throw']) {
  const fixture = await connect({}, {}, ctx => { ctx.authorizer.authorizeOperation = async () => {
    if(permission==='throw')throw new Error('Synthetic authorization failure'); return permission;
  }; });
  try {
    assert.equal(value(await fixture.client.callTool({ name: 'get_site_context', arguments: {} })).code, 'authorization_unavailable');
    assert.equal(fixture.stub.calls.length, 0);
  } finally { await fixture.close(); }
}
{
  const fixture = await connect({ responses: [{ body: nativeReply() }] }, {}, ctx => {
    ctx.authorizer.authorizeOperation = async (name, args) => {
      assert.equal(Object.isFrozen(args.items[0].fields.meta_title), true);
      assert.throws(() => args.items[0].fields.meta_title.value = 'Replaced');
      return { ok: true };
    };
  });
  try {
    assert.equal((await fixture.client.callTool({ name: 'plan_changes', arguments: planArgs() })).isError, undefined);
    assert.equal(JSON.parse(new TextDecoder().decode(fixture.stub.calls[0].bodyBytes)).items[0].fields.meta_title.value, 'Synthetic title');
  } finally { await fixture.close(); }
}

// A recorder must positively acknowledge success; absence is not proof of binding.
for (const recorded of [undefined, {}, { ok: false }]) {
  const fixture = await connect({ responses: [{ body: nativeReply() }] }, {}, ctx => {
    ctx.authorizer.recordValidatedResult = async () => recorded;
  });
  try {
    const output = await fixture.client.callTool({ name: 'plan_changes', arguments: planArgs() });
    assert.equal(value(output).code, 'proposal_binding_failed'); assert.equal(value(output).retryable, true);
    assert.equal(JSON.stringify(output).includes(id), false);
  } finally { await fixture.close(); }
}

// Raw site capabilities may never enlarge the grant-filtered visible result.
{
  const fixture = await connect({ responses: [{ body: { ...fullCaps(), unexpected_site_authority: 'must-not-be-released' } }] });
  try {
    const output = await fixture.client.callTool({ name: 'get_capabilities', arguments: {} });
    assert.deepEqual(value(output), fixture.ctx.filteredCapabilities);
    assert.equal(JSON.stringify(output).includes('must-not-be-released'), false);
  } finally { await fixture.close(); }
}

// SET02 and failed read recording close the entire successful result boundary.
for (const name of ['plan_changes','rollback_change_set','get_page']) {
  const [, args, body] = calls.find(([tool]) => tool === name);
  const fixture = await connect({ responses: [{ body }], recorderFailure: name });
  try {
    const output = await fixture.client.callTool({ name, arguments: args });
    assert.equal(output.isError, true); assert.equal(value(output).retryable, true);
    assert.equal(value(output).code, name === 'get_page' ? 'result_recording_failed' : 'proposal_binding_failed');
    assert.equal(JSON.stringify(output.content).includes(id), false);
    assert.equal(Object.hasOwn(value(output), 'record'), false); assert.equal(fixture.stub.recorded.length, 0);
    assert.deepEqual(fixture.stub.events.map(e => e.type), ['authorize','request','record']);
  } finally { await fixture.close(); }
}
for (const response of [{ status: 503, body: { code: 'unavailable', message: 'Synthetic', data: { status: 503 } } },
  { body: { contract_version: 1, record: { state: 'invented' } } }]) {
  const fixture = await connect({ responses: [response] });
  try {
    assert.equal((await fixture.client.callTool({ name: 'plan_changes', arguments: planArgs() })).isError, true);
    assert.deepEqual(fixture.stub.events.map(e => e.type), ['authorize','request']);
    assert.equal(fixture.stub.recorded.length, 0);
  } finally { await fixture.close(); }
}

// Recovery remains denied even if supplied capabilities advertise it.
{
  const caps = fullCaps(); caps.field_execution.recovery_available = true;
  const fixture = await connect({}, { capabilities: caps });
  try {
    assert.equal(value(await fixture.client.callTool({ name: 'get_changes', arguments: { change_set_id: id, kind: 'recovery' } })).code, 'operation_unavailable');
    assert.equal(fixture.stub.calls.length, 0); assert.equal(fixture.stub.events[0].type, 'authorize');
  } finally { await fixture.close(); }
}
{
  const caps = fullCaps(); caps.field_proposals.operations.push('redirect.create');
  const fixture = await connect({}, { capabilities: caps });
  try {
    const args = planArgs(); args.items = [{ operation: 'redirect.create', target: { source_url: '/synthetic' },
      fields: { target_url: { mode: 'set', value: '/synthetic-new' }, redirect_type: { mode: 'set', value: 301 } } }];
    assert.equal(value(await fixture.client.callTool({ name: 'plan_changes', arguments: args })).code, 'operation_unavailable');
    assert.equal(fixture.stub.calls.length, 0); assert.equal(fixture.stub.events[0].type, 'authorize');
  } finally { await fixture.close(); }
}

// WRITE01 classification survives existing tool error formatting, one request.
{
  const fixture = await connect({ responses: [{ failure: 'timeout' }] });
  try {
    const output = value(await fixture.client.callTool({ name: 'execute_change_set', arguments: executeArgs() }));
    assert.equal(output.code, 'site_unavailable'); assert.equal(output.outcome_unknown, true);
    assert.equal(output.automatic_retry, false); assert.equal(fixture.stub.calls.length, 1);
    assert.equal(fixture.stub.recorded.length, 0);
  } finally { await fixture.close(); }
}

// Query-style requests use the same full server authorization/recording path.
{
  const fixture = await connect({ responses: [{ body: { contract_version: 2 } }] }, {}, ctx => {
    ctx.validatedInstallation.rest_base_url = 'https://site.example.invalid/?rest_route=/tamrank/v2';
    ctx.validatedInstallation.rest_style = 'query';
  });
  try {
    assert.equal((await fixture.client.callTool({ name: 'get_work_queue', arguments: { status: 'open' } })).isError, undefined);
    assert.equal(fixture.stub.calls[0].url, 'https://site.example.invalid/?rest_route=%2Ftamrank%2Fv2%2Fwork-queue&status=open');
    assert.deepEqual(fixture.stub.events.map(e => e.type), ['authorize','request','record']);
  } finally { await fixture.close(); }
}

// CTX01: two grant/site servers, twenty interleaved executions, separate audits.
{
  const a = await connect({ responses: Array.from({ length: 10 }, () => ({ body: nativeReply('executed') })) });
  const b = await connect({ responses: Array.from({ length: 10 }, () => ({ body: nativeReply('executed') })) },
    { host: 'second.example.invalid', grant: '33333333-3333-4333-8333-333333333333' });
  try {
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const fixture = index % 2 ? b : a;
      assert.equal((await fixture.client.callTool({ name: 'execute_change_set', arguments: executeArgs() })).isError, undefined);
    }));
    for (const fixture of [a, b]) {
      assert.equal(fixture.stub.calls.length, 10);
      for (const call of fixture.stub.calls) {
        assert.equal(call.url.startsWith(fixture.ctx.validatedInstallation.rest_base_url + '/'), true);
        const body = JSON.parse(new TextDecoder().decode(call.bodyBytes));
        assert.equal(body.confirmation.agent.name, fixture.ctx.auditContext.grantLabel);
      }
    }
  } finally { await a.close(); await b.close(); }
}

// PROTO01: raw future initialize negotiates the pinned supported protocol.
{
  const server = createWorkflowServer(context(createStubVps()));
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await b.start();
  try {
    const answer = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('initialize timed out')), 1000);
      b.onmessage = message => { if (message.id === 1) { clearTimeout(timer); resolve(message); } }; });
    await b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {},
      clientInfo: { name: 'Synthetic future client', version: '1' } } });
    assert.equal((await answer).result.protocolVersion, '2025-11-25');
  } finally { await b.close(); await server.close(); }
}
assert.equal(typeof buildWorkflowServer, 'function');
console.log('PASS: hosted factory validation/deep-freeze, twelve hook paths, hidden direct authorization, SET01/SET02/CTX01/WRITE01/SCOPE01/PROTO01, trusted audit and preserved MCP clientInfo.');
