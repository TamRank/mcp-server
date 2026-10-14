/** Golf 3 hosted: PageSpeed plan → explicit chat approval → start → status. Synthetic VPS seam only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connect, fullCaps } from './factory-fixtures.mjs';
import { pagespeedRoute, pagespeedPolicy, pagespeedAcks, pagespeedHash } from '../../src/pagespeed-scans.js';

const id = '11111111-1111-4111-8111-111111111111', execution = '22222222-2222-4222-8222-222222222222';
const revision = 'a'.repeat(64), at = 1789218000;
const value = out => JSON.parse(out.content[0].text);
const sent = call => JSON.parse(new TextDecoder().decode(call.bodyBytes));
const scopes = ['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write'];
const support = { available: true, plan_available: true, read_available: true, route: pagespeedRoute, proposal_policy: pagespeedPolicy,
  max_targets: 25, attempts_per_device: 1, devices: ['mobile', 'desktop'], automatic_retries: 0, approval: 'chat_attested',
  scheduling: 'wp_cron', requires_cron_delivery: true, external_requests_reversible: false, results: 'private_scan_progress', legacy_cache_writes: false };
const caps = (extra = {}) => ({ ...fullCaps(), pagespeed_execution: support,
  scan_limits: { pagespeed_per_url_per_day: 20, pagespeed_full_scans_per_day: 1, schema_scans_at_once: 1 }, ...extra });
const targets = [7, 8].map(n => ({ post_id: n, title: 'Page ' + n, type: 'page', url: `https://site.example.invalid/p${n}/` }));
const proposal = { contract_version: 2, lane: 'scan', type: 'pagespeed', policy: pagespeedPolicy, proposal_id: id,
  preview_revision: revision, binding: { installation_id: id, blog_id: 1, operator_id: 2, token_id: 3 }, created_at: at, expires_at: at + 86400,
  targets, strategies: ['mobile', 'desktop'], required_acknowledgements: pagespeedAcks, warnings: ['w1', 'w2', 'w3', 'w4', 'w5'],
  budget: { max_provider_requests: 4, attempts_per_device: 1, automatic_retries: 0, enforced: true, monetary_cost: null, quota_remaining: null },
  reservation: { mode: 'exclusive', blocks: 'tamrank_pagespeed_requests', dispatch_enabled: true, release: 'known_completion_or_never_started_cancellation' },
  dispatch: { concurrency: 1, stop_on_uncertainty: true, result_storage: 'private_scan_progress', website_content_writes: false, legacy_cache_writes: false } };
const planHash = pagespeedHash(proposal);
const draft = (state = 'planned') => ({ contract_version: 2, proposal_id: id, proposal_hash: planHash, proposal, state, plan_persisted: true,
  approval_recorded: false, execution_enabled: false, queue_reserved: false, backend_requested: false });
const progress = () => ({ contract_version: 2, execution_id: execution, proposal_id: id, proposal, proposal_hash: planHash,
  automatic_retry_allowed: false, worker_liveness: 'unknown', dispatch_state: 'queued', scheduled_at: at + 1,
  progress: { contract_version: 2, view: 'execution_runtime', execution_id: execution, runtime_hash: revision, runtime_recorded: true, observed_at: at,
    execution_enabled: true, state: 'reserved', runtime: { contract_version: 2, policy: 'pagespeed-execution-runtime-1', execution_id: execution,
      registration_hash: revision, binding: proposal.binding, created_at: at, updated_at: at, revision: 0, dispatch_enabled: true, reservation_state: 'held', state: 'reserved',
      measurements: targets.flatMap((_, i) => ['mobile', 'desktop'].map(s => ({ measurement_id: createHash('sha256').update(execution + ':' + i + ':' + s).digest('hex'),
        state: 'not_started', attempts: [], result: null }))) } } });
const wpError = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const approve = { type: 'pagespeed', proposal_id: id, confirmation: { plan_hash: planHash, confirmed: true } };

// Not offered: nothing listed for PageSpeed, the index-only shape is unchanged, and a call sends nothing.
{
  const f = await connect({ responses: [] }, { capabilities: { ...fullCaps(), index_checks: { contract_version: 1, available: true } } });
  try {
    const tool = (await f.client.listTools()).tools.find(t => t.name === 'start_scan');
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['type', 'urls']);
    assert.deepEqual(tool.inputSchema.properties.type.enum, ['index']);
    assert.doesNotMatch(tool.description, /PageSpeed/);
    assert.doesNotMatch(f.client.getInstructions(), /PageSpeed/);
    const out = await f.client.callTool({ name: 'start_scan', arguments: { type: 'pagespeed', post_ids: [7] } });
    assert.equal(out.isError, true); assert.equal(value(out).code, 'workflow_operation_unavailable'); assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
// Offered: listed with only the PageSpeed arguments, the two-step description, the instruction, and both scan scopes.
{
  const offered = [...scopes, 'scans:execute', 'scans:plan'];
  const f = await connect({ responses: [] }, { capabilities: caps(), scopes, offeredScopes: offered });
  try {
    const tools = new Map((await f.client.listTools()).tools.map(t => [t.name, t]));
    const start = tools.get('start_scan'), status = tools.get('get_scan_status');
    assert.deepEqual(Object.keys(start.inputSchema.properties).sort(), ['confirmation', 'post_ids', 'proposal_id', 'type']);
    assert.deepEqual(start.inputSchema.properties.type.enum, ['pagespeed']);
    assert.deepEqual(Object.keys(status.inputSchema.properties).sort(), ['execution_id', 'proposal_id', 'type']);
    assert.match(start.description, /makes a plan and measures nothing/); assert.match(start.description, /Only after an explicit yes in chat/);
    assert.doesNotMatch(start.description, /Index check/);
    assert.equal(start.annotations.readOnlyHint, false); assert.equal(start.annotations.idempotentHint, undefined);
    assert.equal(status.annotations.readOnlyHint, true);
    assert.deepEqual(start._meta.securitySchemes, [{ type: 'oauth2', scopes: [...scopes, 'scans:execute', 'scans:plan'] }]);
    assert.match(f.client.getInstructions(), /except PageSpeed measurements \(start_scan type pagespeed: plan, show it, explicit chat approval, then start; only when asked\)/);
  } finally { await f.close(); }
  const both = await connect({ responses: [] }, { capabilities: caps({ index_checks: { contract_version: 1, available: true } }) });
  try {
    const start = (await both.client.listTools()).tools.find(t => t.name === 'start_scan');
    assert.deepEqual(start.inputSchema.properties.type.enum, ['index', 'pagespeed']);
    assert.match(start.description, /^Only when the user asks\. Index check: .* PageSpeed: /);
    assert.match(both.client.getInstructions(), /except index checks \(start_scan type index, only when asked\) and PageSpeed measurements/);
  } finally { await both.close(); }
}
// Plan: preview of exactly these pages, then one saved plan with a fresh request ID; every page and warning shown.
{
  const f = await connect({ responses: [{ body: { contract_version: 2, preview_revision: revision } }, { body: draft() }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'pagespeed', post_ids: [7, 8] } }));
    const preview = new URL(f.stub.calls[0].url);
    assert.equal(f.stub.calls[0].method, 'GET'); assert.equal(preview.pathname, '/wp-json/tamrank/v2/scans/preview');
    assert.equal(preview.searchParams.get('type'), 'pagespeed'); assert.equal(preview.searchParams.get('post_ids'), '7,8');
    assert.equal(new URL(f.stub.calls[1].url).pathname, '/wp-json/tamrank/v2/scans/executions/proposals');
    const body = sent(f.stub.calls[1]);
    assert.deepEqual(Object.keys(body).sort(), ['client_request_id', 'expected_revision', 'post_ids', 'type']);
    assert.equal(body.expected_revision, revision); assert.match(body.client_request_id, /^mcp-plan-[0-9a-f-]{36}$/);
    assert.equal(out.proposal_id, id); assert.equal(out.plan_hash, planHash); assert.equal(out.measurements, 4);
    assert.deepEqual(out.pages, [{ post_id: 7, title: 'Page 7', url: 'https://site.example.invalid/p7/' }, { post_id: 8, title: 'Page 8', url: 'https://site.example.invalid/p8/' }]);
    assert.deepEqual(out.warnings, ['w1', 'w2', 'w3', 'w4', 'w5']);
    assert.match(out.approval, /^Nothing has been measured yet\./); assert.match(out.approval, /at most 20 times a day/);
    assert.equal(out.binding, undefined); assert.equal(out.proposal, undefined);
    assert.deepEqual(f.stub.recorded.map(r => r.toolName), ['start_scan']); assert.equal(f.stub.recorded[0].result.proposal_id, id);
  } finally { await f.close(); }
}
// A plan the site refuses (no PageSpeed key) is a plain refusal; nothing was saved or measured.
{
  const f = await connect({ responses: [{ body: { contract_version: 2, preview_revision: revision } },
    wpError(409, 'scan_proposal_prerequisites', 'The PageSpeed workflow request was refused.')] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'pagespeed', post_ids: [7] } }));
    assert.equal(out.code, 'scan_proposal_prerequisites'); assert.match(out.message, /^The website turned this down\./);
  } finally { await f.close(); }
}
// Start: the exact plan is re-read, the fixed acknowledgements added, the request ID derived from the plan hash.
{
  const f = await connect({ responses: [{ body: draft() }, { body: progress() }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: approve }));
    assert.equal(f.stub.calls[0].method, 'GET'); assert.equal(new URL(f.stub.calls[0].url).pathname, `/wp-json/tamrank/v2/scans/executions/proposals/${id}`);
    assert.equal(f.stub.calls[1].method, 'POST'); assert.equal(new URL(f.stub.calls[1].url).pathname, '/wp-json/tamrank/v2/scans/executions');
    const body = sent(f.stub.calls[1]);
    assert.equal(body.proposal_id, id); assert.equal(body.client_request_id, 'mcp-pagespeed-' + planHash);
    assert.deepEqual(body.confirmation.acknowledgements, pagespeedAcks); assert.equal(body.confirmation.plan_hash, planHash);
    assert.equal(body.confirmation.mode, 'chat_attested'); assert.equal(body.confirmation.confirmed, true);
    assert.equal(body.confirmation.agent.name, 'grant:22222222-2222-4222-8222-222222222222');
    assert.equal(body.confirmation.client.name, 'Synthetic MCP client');
    assert.equal(out.execution_id, execution); assert.equal(out.state, 'reserved'); assert.equal(out.targets.length, 2);
    assert.match(out.explanation, /queued on the site/); assert.equal(out.runtime_hash, undefined); assert.equal(out.proposal_hash, undefined);
  } finally { await f.close(); }
}
// A plan that changed, or expired, is never started.
{
  const changed = draft(); changed.proposal_hash = 'b'.repeat(64);
  for (const [reply, code] of [[changed, 'pagespeed_proposal_mismatch'], [draft('expired'), 'pagespeed_proposal_expired']]) {
    const f = await connect({ responses: [{ body: reply }] }, { capabilities: caps() });
    try {
      const out = value(await f.client.callTool({ name: 'start_scan', arguments: approve }));
      assert.equal(out.code, code); assert.match(out.message, /Nothing was measured/); assert.equal(f.stub.calls.length, 1);
    } finally { await f.close(); }
  }
}
// An approval of another hash (an older version of the plan) never starts the current plan.
{
  const f = await connect({ responses: [{ body: draft() }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { ...approve, confirmation: { plan_hash: 'c'.repeat(64), confirmed: true } } }));
    assert.equal(out.code, 'pagespeed_proposal_mismatch'); assert.equal(f.stub.calls.length, 1);
  } finally { await f.close(); }
}
// The per-page daily limit, in plain words; nothing was measured.
{
  const f = await connect({ responses: [{ body: draft() }, wpError(429, 'pagespeed_url_limit_reached', 'x',
    { blocked_urls: ['https://site.example.invalid/p7/'], retry_at: '2026-10-15T10:00:00Z', limit: 20 })] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: approve }));
    assert.equal(out.code, 'pagespeed_url_limit_reached');
    assert.equal(out.message, 'PageSpeed was already measured the maximum number of times today for these pages. Nothing was measured. There is room again from 2026-10-15T10:00:00Z.');
    assert.deepEqual(out.blocked_urls, ['https://site.example.invalid/p7/']); assert.equal(out.automatic_retry, false);
  } finally { await f.close(); }
}
// A lost start answer is uncertain: never "failed", repeat only the identical start.
{
  const f = await connect({ responses: [{ body: draft() }, { failure: 'timeout' }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: approve }));
    assert.match(out.message, /may or may not have started/); assert.match(out.assistant_note, /exactly the same proposal_id and confirmation/);
    assert.equal(out.automatic_retry, false); assert.equal(f.stub.calls.length, 2);
  } finally { await f.close(); }
}
// Status: by execution_id (results) and by proposal_id (the saved plan).
{
  const done = progress(); done.dispatch_state = 'completed'; done.scheduled_at = null;
  const p = done.progress, r = p.runtime; p.state = r.state = 'completed'; p.execution_enabled = r.dispatch_enabled = false; r.reservation_state = 'released';
  for (const m of r.measurements) { m.state = 'succeeded'; m.result = { performance_score: 91, fcp_ms: 900, lcp_ms: 1800, tbt_ms: 10, cls: 0 };
    m.attempts = [{ started_at: at, finished_at: at, outcome: 'succeeded', error_code: null }]; }
  const f = await connect({ responses: [{ body: done }, { body: draft() }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'get_scan_status', arguments: { type: 'pagespeed', execution_id: execution } }));
    assert.equal(new URL(f.stub.calls[0].url).pathname, `/wp-json/tamrank/v2/scans/executions/${execution}`);
    assert.equal(out.state, 'completed'); assert.match(out.explanation, /^Done\./);
    assert.deepEqual(out.targets[0].devices.map(d => [d.strategy, d.result.performance_score]), [['mobile', 91], ['desktop', 91]]);
    const plan = value(await f.client.callTool({ name: 'get_scan_status', arguments: { type: 'pagespeed', proposal_id: id } }));
    assert.equal(plan.proposal_id, id); assert.equal(plan.pages.length, 2);
  } finally { await f.close(); }
}
// Mixed or partial shapes are refused before anything is sent or authorized.
{
  const f = await connect({ responses: [] }, { capabilities: caps() });
  try {
    for (const args of [{ type: 'pagespeed', post_ids: [7], proposal_id: id }, { type: 'pagespeed', proposal_id: id },
      { type: 'pagespeed', post_ids: [7, 7] }, { type: 'pagespeed', urls: ['https://site.example.invalid/'] },
      { type: 'pagespeed', post_ids: Array.from({ length: 26 }, (_, i) => i + 1) },
      { type: 'pagespeed', proposal_id: id, confirmation: { plan_hash: planHash, confirmed: true, acknowledgements: pagespeedAcks } }]) {
      const out = await f.client.callTool({ name: 'start_scan', arguments: args });
      assert.equal(out.isError, true, JSON.stringify(args));
    }
    const out = await f.client.callTool({ name: 'get_scan_status', arguments: { type: 'pagespeed', proposal_id: id, execution_id: execution } });
    assert.equal(out.isError, true);
    assert.equal(f.stub.calls.length, 0); assert.equal(f.stub.events.filter(e => e.type === 'authorize').length, 0);
  } finally { await f.close(); }
}
// A start the authorizer refuses (another connection's plan) sends nothing.
{
  const f = await connect({ responses: [], decisions: { start_scan: { ok: false, code: 'scan_not_owned', message: 'This plan belongs to another connection. Nothing was sent.', retryable: false } } },
    { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: approve }));
    assert.equal(out.code, 'scan_not_owned'); assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
console.log('hosted golf3: ok');
