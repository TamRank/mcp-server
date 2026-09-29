/** Hosted redirects and the stored-data specialist reads, through the real factory and SDK. */
import assert from 'node:assert/strict';
import { createWorkflowServer } from '../../src/hosted/factory.js';
import { createStubVps } from './stub-vps.mjs';
import { hostedRedirectCapability, hostedRedirectItems, validRedirectExecutionResponse } from '../../src/redirect-execution.js';
import { context, connect, fullCaps, planArgs, id, other, hash } from './factory-fixtures.mjs';
const value = output => JSON.parse(output.content[0].text);
const grant = '22222222-2222-4222-8222-222222222222';
const eightScopes = ['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write','redirects:write'];
const redirectOps = ['redirect.create','redirect.update','redirect.delete'];
// What PRO advertises with every scope granted: mixed sets, recovery and field operations included.
const siteRedirects = (operations = redirectOps) => ({ contract_version: 1, available: true, mixed_available: true, read_available: true,
  rollback_available: true, recovery_available: true, recovery_delivery_available: true,
  operations: ['meta.update','social.update','image_alt.update', ...operations] });
const redirectCaps = (operations) => ({ ...fullCaps(), redirect_execution: siteRedirects(operations) });
const redirectOnlyCaps = () => { const caps = redirectCaps(); delete caps.field_execution; delete caps.field_proposals; return caps; };
const create = { operation: 'redirect.create', target: { source_url: '/contact-us' },
  fields: { target_url: { mode: 'set', value: '/contact' }, redirect_type: { mode: 'set', value: 301 } } };
const remove = { operation: 'redirect.delete', target: { redirect_id: 7 }, fields: { acknowledge_deletion: { mode: 'set', value: true } } };
const meta = planArgs().items[0];
const plan = items => ({ ...planArgs(), items });
const reply = (state = 'planned', { inverse = false, operation = 'redirect.create', acks = operation === 'redirect.delete' ? ['redirect_deletion'] : [] } = {}) => ({ contract_version: 1,
  record: { state, envelope: { plan: { contract_version: 2, kind: inverse ? 'rollback' : 'forward', change_set_id: id,
    policy_version: inverse ? 'workflow-redirect-rollback-1' : 'workflow-redirect-execution-1', frontend_verification: 'not_performed',
    items: [{ item_id: other, operation }], required_acknowledgements: acks }, plan_hash: hash,
    change_token: (inverse ? 'trxr1.' : 'trcx1.') + 'c'.repeat(64) } } });
const execute = (token = 'trcx1.', acks = []) => ({ change_set_id: id, change_token: token + 'c'.repeat(64),
  confirmation: { plan_hash: hash, confirmed: true, acknowledgements: acks } });
const body = call => JSON.parse(new TextDecoder().decode(call.bodyBytes));
let checks = 0; const ok = (v, label) => { checks++; assert.ok(v, label); }, eq = (a, b, label) => { checks++; assert.deepEqual(a, b, label); };

// 1. The factory knows redirects:write; an unknown scope still fails the whole context.
{
  const server = createWorkflowServer(context(createStubVps(), { scopes: eightScopes, capabilities: redirectCaps() }));
  ok(server, 'A grant carrying redirects:write constructs a hosted server'); await server.close();
  for (const scopes of [[...eightScopes, 'schema:write'], ['site:read','redirects:write','redirects:write']])
    assert.throws(() => createWorkflowServer(context(createStubVps(), { scopes })), /grant scopes/), checks++;
}

// 2. Without redirect_execution (VPS flag off, or a grant without the scope) nothing changes.
{
  const fixture = await connect({}, { scopes: eightScopes });
  try {
    const names = (await fixture.client.listTools()).tools.map(t => t.name);
    ok(!names.some(n => n.startsWith('get_redirects')), 'No redirect read listed without the capability');
    eq(value(await fixture.client.callTool({ name: 'plan_changes', arguments: plan([create]) })).code, 'operation_unavailable', 'Redirect plan refused');
    eq(fixture.stub.calls.length, 0, 'Nothing sent');
    ok(!(await fixture.client.getInstructions?.() ?? '').includes('stored-data'), 'Instructions unchanged without specialist reads');
  } finally { await fixture.close(); }
}

// 3. With redirect_execution: exact redirect-only plan, execute, read, rollback and inverse execute.
{
  const fixture = await connect({ responses: [{ body: reply() }, { body: reply('executed', { acks: [] }) }, { body: reply('executed') },
    { body: reply('planned', { inverse: true, operation: 'redirect.delete' }) }, { body: reply('executed', { inverse: true, operation: 'redirect.delete' }) }] },
    { scopes: eightScopes, capabilities: redirectOnlyCaps() });
  try {
    eq((await fixture.client.listTools()).tools.map(t => t.name).filter(n => ['plan_changes','execute_change_set','get_changes','rollback_change_set'].includes(n)).sort(),
      ['execute_change_set','get_changes','plan_changes','rollback_change_set'], 'Redirect capability alone lists the four change tools');
    const planned = await fixture.client.callTool({ name: 'plan_changes', arguments: plan([create]) });
    eq(planned.isError, undefined, JSON.stringify(planned));
    eq([fixture.stub.calls[0].method, new URL(fixture.stub.calls[0].url).pathname], ['POST', '/wp-json/tamrank/v2/changes/executions'], 'Native redirect plan route');
    eq(value(planned).record.envelope.plan.policy_version, 'workflow-redirect-execution-1', 'Redirect envelope released after recording');
    eq((await fixture.client.callTool({ name: 'execute_change_set', arguments: execute() })).isError, undefined, 'Redirect execution');
    const sent = body(fixture.stub.calls[1]);
    eq(sent.confirmation.agent, { name: 'grant:' + grant }, 'Redirect confirmation carries the grant label, not unknown');
    eq(sent.confirmation.acknowledgements, [], 'Acknowledgements are copied, never invented');
    eq(sent.client_request_id, 'mcp-execute-' + hash, 'Same exact request identity as field execution');
    eq((await fixture.client.callTool({ name: 'get_changes', arguments: { change_set_id: id, kind: 'execution' } })).isError, undefined, 'Redirect set reads');
    eq((await fixture.client.callTool({ name: 'rollback_change_set', arguments: { change_set_id: id, client_request_id: 'synthetic-rollback-001', item_ids: [other] } })).isError,
      undefined, 'Redirect rollback preview');
    eq((await fixture.client.callTool({ name: 'execute_change_set', arguments: execute('trxr1.') })).isError, undefined, 'Separately approved inverse');
    eq(body(fixture.stub.calls[4]).confirmation.agent, { name: 'grant:' + grant }, 'Inverse confirmation carries the grant label');
    eq(fixture.stub.recorded.map(r => r.toolName), ['plan_changes','execute_change_set','get_changes','rollback_change_set','execute_change_set'], 'Every result recorded');
  } finally { await fixture.close(); }
}

// 4. Deletion: the acknowledgement is copied from the approved input.
{
  const fixture = await connect({ responses: [{ body: reply('executed', { operation: 'redirect.delete', acks: ['redirect_deletion'] }) }] },
    { scopes: eightScopes, capabilities: redirectOnlyCaps() });
  try {
    eq((await fixture.client.callTool({ name: 'execute_change_set', arguments: execute('trcx1.', ['redirect_deletion']) })).isError, undefined, 'Deletion executes');
    eq(body(fixture.stub.calls[0]).confirmation.acknowledgements, ['redirect_deletion'], 'Deletion acknowledgement copied');
  } finally { await fixture.close(); }
}

// 5. Refusals with zero upstream requests: recovery, mixed sets, unlisted operations, schema.
for (const [label, capabilities, name, args, codes] of [
  ['recovery read', redirectCaps(), 'get_changes', { change_set_id: id, kind: 'recovery' }, ['operation_unavailable']],
  ['recovery token without plan', redirectCaps(), 'execute_change_set', execute('trrr1.'), ['invalid_request']],
  ['recovery token with plan', redirectCaps(), 'execute_change_set', { ...execute('trrr1.'), recovery_plan: { change_set_id: id } }, ['invalid_request','operation_unavailable']],
  ['mixed field+redirect set', redirectCaps(), 'plan_changes', plan([create, meta]), ['operation_unavailable']],
  ['redirect.delete not listed', redirectCaps(['redirect.create','redirect.update']), 'plan_changes', plan([remove]), ['operation_unavailable']],
  ['redirect without available', { ...fullCaps(), redirect_execution: { ...siteRedirects(), available: false } }, 'plan_changes', plan([create]), ['operation_unavailable']],
  ['inverse without rollback grant', { ...redirectOnlyCaps(), redirect_execution: { ...siteRedirects(), rollback_available: false } }, 'execute_change_set', execute('trxr1.'), ['invalid_request']],
  ['schema execution stays stripped', { ...redirectCaps(), schema_execution: { contract_version: 1, available: true, read_available: true,
    rollback_available: true, recovery_available: true, operations: ['schema.select'] } }, 'plan_changes',
    plan([{ operation: 'schema.select', target: { post_id: 1 }, fields: { schema_type: { mode: 'set', value: 'Article' } } }]), ['invalid_request','operation_unavailable']],
  ['schema preview stays stripped', { ...redirectCaps(), schema_preview: { contract_version: 2, available: true, operations: ['schema.select'] } }, 'plan_changes',
    { schema_preview: { operation: 'schema.select', post_id: 1 } }, ['invalid_request','operation_unavailable']],
]) {
  const fixture = await connect({}, { scopes: eightScopes, capabilities });
  try {
    const output = value(await fixture.client.callTool({ name, arguments: args }));
    ok(codes.includes(output.code), `${label}: ${JSON.stringify(output)}`);
    eq(fixture.stub.calls.length, 0, `${label}: nothing sent`);
  } finally { await fixture.close(); }
}
// The bridge's own normalisation: even a VPS that left them on cannot enable recovery or mixed sets.
eq(hostedRedirectCapability(siteRedirects()), { ...siteRedirects(), mixed_available: false, recovery_available: false,
  recovery_delivery_available: false, operations: redirectOps }, 'Hosted redirect capability is redirect-only, no recovery');
eq(hostedRedirectCapability({ ...siteRedirects(), contract_version: 2 }), undefined, 'Unknown contract is dropped');
eq(hostedRedirectCapability(undefined), undefined, 'Absent stays absent');

// Greptile round 1: a site answer whose frozen items leave the redirect-only set is not released.
for (const [label, items, token] of [['field item in a redirect plan', [{ item_id: other, operation: 'meta.update' }], null],
  ['unlisted delete in a redirect plan', [{ item_id: other, operation: 'redirect.delete' }], null],
  ['field item in an executed redirect set', [{ item_id: other, operation: 'meta.update' }], 'trcx1.']]) {
  const answer = reply(token ? 'executed' : 'planned'); answer.record.envelope.plan.items = items;
  answer.record.envelope.plan.required_acknowledgements = items[0].operation === 'redirect.delete' ? ['redirect_deletion'] : [];
  const caps = redirectOnlyCaps(); caps.redirect_execution.operations = ['redirect.create','redirect.update'];
  const fixture = await connect({ responses: [{ body: answer }] }, { scopes: eightScopes, capabilities: caps });
  try {
    const output = await fixture.client.callTool(token ? { name: 'execute_change_set', arguments: execute(token) } : { name: 'plan_changes', arguments: plan([create]) });
    eq(value(output).code, 'field_execution_incompatible_response', label);
    eq(fixture.stub.recorded.length, 0, `${label}: not recorded`);
    ok(!JSON.stringify(output).includes(id), `${label}: set ID not released`);
  } finally { await fixture.close(); }
}
// Inverse sets may carry restores and deletes (the inverse of a create), never field items.
{
  const answer = reply('planned', { inverse: true, operation: 'redirect.restore' });
  const fixture = await connect({ responses: [{ body: answer }] }, { scopes: eightScopes, capabilities: redirectOnlyCaps() });
  try {
    eq((await fixture.client.callTool({ name: 'rollback_change_set', arguments: { change_set_id: id, client_request_id: 'synthetic-rollback-002', item_ids: [other] } })).isError,
      undefined, 'Inverse restore released');
  } finally { await fixture.close(); }
}
// Greptile round 2: a history-only answer (no frozen plan) is held to the same redirect-only set.
const now = 1800000000, executionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const row = { id: 1, source_url: '/old', target_url: '/new', redirect_type: '301', match_type: 'exact', active: 1, auto_generated: 0, created_at: '2026-01-01 00:00:00' };
const historyItem = (n, operation) => {
  const item_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb' + n, field = operation === 'meta.update', create = operation === 'redirect.create';
  const before = field ? { meta_title: { exists: true, value: 'Old title' } } : create ? null : row;
  const after = field ? { meta_title: { exists: true, value: 'New title' } } : create ? row : null;
  return { item_id, operation, target: field ? { post_id: 1 } : create ? { source_url: '/old' } : { redirect_id: 1 }, ...(field ? { url: 'https://owned.invalid/page' } : {}),
    before, after, fields: field ? { meta_title: { mode: 'set', value: 'New title' } } : create ? { target_url: { mode: 'set', value: '/new' } } : { acknowledge_deletion: { mode: 'set', value: true } },
    result: { version: 1, execution_id: executionId, item_id, state: 'applied', attempts: 1, committed_at: now + 1, audit_id: 4, changed: true, invalidation: 'delivered',
      ...(field ? {} : { redirect_result: { redirect_id: 1, before, after } }) } };
};
const historyOnly = operations => {
  const items = operations.map((op, n) => historyItem(n, op)), acks = operations.includes('redirect.delete') ? ['redirect_deletion'] : [];
  const h = { contract_version: 1, kind: 'field_execution_history', change_set_id: id, change_kind: 'forward', source_policy: 'workflow-redirect-execution-1', original_plan_hash: hash,
    site: { installation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', blog_id: 1, site_origin: 'https://owned.invalid' }, attribution: { removed_at: now + 10 },
    created_at: now, expires_at: now + 86400, state: 'executed', action_id: null, approval_recorded: true, execution_available: false,
    origin: { kind: 'user_request', reference: 'owned-history', summary: 'Reviewed change' }, items,
    execution: { execution_id: executionId, state: 'executed', registered_at: now, lease_until: now + 120, finished_at: now + 1,
      attestation: { mode: 'chat_attested', received_at: '2027-01-15T08:00:00+00:00', plan_hash: hash, statement: 'user approved in chat', acknowledgements: acks,
        provenance_asserted: true, human_verified: false, attribution_removed_at: now + 10 }, budget: { version: 1, window_start: now, operation_count: items.length, operator_limit: 30 } } };
  return { contract_version: 1, record: { state: 'executed', history: h, approval_recorded: true, execution_available: false,
    projection: { contract: 'execution_history_view_v1', private_proofs_omitted: true, plan_hash_scope: 'complete_stored_plan' } } };
};
for (const [label, operations, released] of [['history-only field item beside a redirect', ['meta.update', 'redirect.create'], false],
  ['history-only unlisted delete', ['redirect.delete'], false], ['history-only redirect-only set', ['redirect.create'], true]]) {
  const answer = historyOnly(operations);
  ok(validRedirectExecutionResponse(answer, id, hash), `${label}: a well-formed history the generic validator accepts`);
  const caps = redirectOnlyCaps(); caps.redirect_execution.operations = ['redirect.create', 'redirect.update'];
  for (const [name, args] of [['get_changes', { kind: 'execution', change_set_id: id }], ['execute_change_set', execute('trcx1.', operations.includes('redirect.delete') ? ['redirect_deletion'] : [])]]) {
    const fixture = await connect({ responses: [{ body: answer }] }, { scopes: eightScopes, capabilities: caps });
    try {
      const output = await fixture.client.callTool({ name, arguments: args });
      eq(fixture.stub.calls.length, 1, `${label}/${name}: the site answered`);
      if (released) {
        eq(output.isError, undefined, `${label}/${name}: released: ${JSON.stringify(output)}`);
        eq(value(output), answer, `${label}/${name}: released unchanged`);
        eq(fixture.stub.recorded.map(r => r.toolName), [name], `${label}/${name}: recorded`);
      } else {
        eq(value(output).code, 'field_execution_incompatible_response', `${label}/${name}`);
        eq(fixture.stub.recorded.length, 0, `${label}/${name}: not recorded`);
        ok(!JSON.stringify(output).includes(id), `${label}/${name}: set ID not released`);
      }
    } finally { await fixture.close(); }
  }
}
// An answer carrying neither a plan nor a history is never released.
ok(!hostedRedirectItems({ contract_version: 1, record: { state: 'executed' } }, siteRedirects()), 'Neither plan nor history: not released');
// Greptile round 1: a listed stored-data read is callable even if an ordinary reads entry says false.
{
  const caps = { ...fullCaps(), specialist_reads: { get_gsc_pages: { available: true } } };
  caps.reads.get_gsc_pages = { available: false };
  const fixture = await connect({ responses: [{ body: { contract_version: 2, items: [] } }] }, { capabilities: caps });
  try {
    ok((await fixture.client.listTools()).tools.some(t => t.name === 'get_gsc_pages'), 'Listed by its specialist entry');
    eq((await fixture.client.callTool({ name: 'get_gsc_pages', arguments: {} })).isError, undefined, 'Listing and dispatch agree');
  } finally { await fixture.close(); }
}

// 6. Stored-data specialist reads: listed and dispatched only with a filtered entry; scans never.
const specialist = { get_site_diagnostics: [{ section: '404_urls' }, '/site/diagnostics'], get_gsc_pages: [{ order: 'ctr_asc' }, '/gsc/pages'],
  get_redirects: [{ section: 'rules' }, '/redirects'], get_images_missing_alt: [{}, '/images/missing-alt'],
  get_topical_authority: [{ section: 'overview' }, '/site/topical-authority'] };
{
  const fixture = await connect();
  try {
    const names = (await fixture.client.listTools()).tools.map(t => t.name);
    for (const name of Object.keys(specialist)) {
      ok(!names.includes(name), `${name} hidden without specialist_reads`);
      eq(value(await fixture.client.callTool({ name, arguments: specialist[name][0] })).code, 'workflow_operation_unavailable', `${name} refused`);
    }
    eq(fixture.stub.calls.length, 0, 'Hidden specialist reads send nothing');
  } finally { await fixture.close(); }
}
for (const enabled of [Object.keys(specialist), ['get_redirects'], ['get_gsc_pages','get_site_diagnostics','get_images_missing_alt','get_topical_authority']]) {
  const caps = { ...fullCaps(), specialist_reads: Object.fromEntries(Object.keys(specialist).map(name => [name, { available: enabled.includes(name) }])) };
  const fixture = await connect({ responses: enabled.map(() => ({ body: { contract_version: 2, items: [] } })) }, { capabilities: caps });
  try {
    const names = (await fixture.client.listTools()).tools.map(t => t.name);
    for (const name of Object.keys(specialist)) eq(names.includes(name), enabled.includes(name), `${name} listing follows its entry`);
    for (const name of ['start_scan','get_scan_status','close_scan']) ok(!names.includes(name), `${name} never hosted`);
    ok(fixture.client.getInstructions().includes('except the listed stored-data reads'), 'Instructions name the exception');
    for (const name of enabled) {
      const start = fixture.stub.events.length;
      const output = await fixture.client.callTool({ name, arguments: specialist[name][0] });
      eq(output.isError, undefined, `${name}: ${JSON.stringify(output)}`);
      const call = fixture.stub.calls.at(-1);
      eq([call.method, new URL(call.url).pathname], ['GET', '/wp-json/tamrank/v2' + specialist[name][1]], `${name} route`);
      eq(fixture.stub.events.slice(start).map(e => e.type), ['authorize','request','record'], `${name} authorized and recorded`);
    }
    for (const name of ['start_scan','get_scan_status','close_scan']) {
      const output = await fixture.client.callTool({ name, arguments: {} }).catch(err => ({ isError: true, err }));
      ok(output.isError, `${name} is not a hosted tool`);
    }
    eq(fixture.stub.calls.length, enabled.length, 'One request per allowed read, none for scans');
  } finally { await fixture.close(); }
}
// The VPS decides every call: a denied specialist read sends nothing.
{
  const caps = { ...fullCaps(), specialist_reads: { get_gsc_pages: { available: true } } };
  const fixture = await connect({ decisions: { get_gsc_pages: { ok: false, code: 'insufficient_scope', message: 'Synthetic deny', retryable: false } } }, { capabilities: caps });
  try {
    eq(value(await fixture.client.callTool({ name: 'get_gsc_pages', arguments: {} })).code, 'insufficient_scope', 'Authorizer denial wins');
    eq(fixture.stub.calls.length, 0, 'Denied read sends nothing');
  } finally { await fixture.close(); }
}
console.log(`PASS: hosted redirects (${checks} checks): redirects:write grant, redirect-only plan/execute/read/rollback with grant label, copied deletion acknowledgement, recovery/mixed/unlisted/schema refused before any request, five stored-data specialist reads gated by their filtered entry, scans never hosted.`);
