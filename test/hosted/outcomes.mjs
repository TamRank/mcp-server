/** Hosted get_outcomes and the age of the capabilities copy. Synthetic VPS seam only. */
import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

const set = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const value = out => JSON.parse(out.content[0].text);
const withOutcomes = (extra = {}) => { const caps = fullCaps(); caps.reads.get_outcomes = { available: true }; return { ...caps, ...extra }; };
const reply = { contract_version: 2, items: [{ post_id: 7, post_title: 'Pricing', summary: 'Meta title', changes: [{ field: 'meta_title' }],
  effect_status: 'pending', change_set_id: set, monitor_after: '2026-10-31', created_at: '2026-10-14 10:00:00', outcome: { state: 'pending' } }],
  pagination: { page: 1, per_page: 25, total: 1, total_pages: 1, has_more: false } };

// Listed only when the site advertises it; a plain-language description that says when to use it.
{
  const absent = await connect({ responses: [] });
  try {
    const { tools } = await absent.client.listTools();
    assert.equal(tools.some(t => t.name === 'get_outcomes'), false, 'not advertised: not listed');
    const out = await absent.client.callTool({ name: 'get_outcomes', arguments: {} });
    assert.equal(out.isError, true); assert.equal(absent.stub.calls.length, 0, 'not advertised: nothing sent');
  } finally { await absent.close(); }
  const f = await connect({ responses: [{ body: reply }] }, { capabilities: withOutcomes() });
  try {
    const tool = (await f.client.listTools()).tools.find(t => t.name === 'get_outcomes');
    assert.ok(tool, 'advertised: listed');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['site:read'] }]);
    assert.match(tool.description, /clicks, impressions, CTR and average position/);
    assert.match(tool.description, /14 days plus 3 days/);
    const out = value(await f.client.callTool({ name: 'get_outcomes', arguments: { change_set_id: set, since: '2026-10-01' } }));
    assert.equal(out.items[0].first_result_expected, '2026-10-31');
    const url = new URL(f.stub.calls[0].url);
    assert.equal(url.pathname, '/wp-json/tamrank/v2/outcomes'); assert.equal(f.stub.calls[0].method, 'GET');
    assert.equal(url.searchParams.get('change_set_id'), set); assert.equal(url.searchParams.get('created_from'), '2026-10-01 00:00:00');
    const authorized = f.stub.events.find(e => e.type === 'authorize');
    assert.deepEqual(authorized, { type: 'authorize', toolName: 'get_outcomes', parsedArgs: { change_set_id: set, since: '2026-10-01' } });
    assert.equal(f.stub.recorded[0].toolName, 'get_outcomes'); assert.deepEqual(f.stub.recorded[0].result, out);
  } finally { await f.close(); }
}
// The authorizer still decides: a refusal sends nothing.
{
  const f = await connect({ responses: [], decisions: { get_outcomes: { ok: false, code: 'operation_unavailable', message: 'Not available.', retryable: false } } },
    { capabilities: withOutcomes() });
  try {
    const out = await f.client.callTool({ name: 'get_outcomes', arguments: {} });
    assert.equal(out.isError, true); assert.equal(value(out).code, 'operation_unavailable'); assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
// get_capabilities: the saved copy says when it was read, and its age is counted per call.
{
  const asOf = new Date(Date.now() - 95000).toISOString();
  const f = await connect({ responses: [{ body: fullCaps() }] }, { capabilities: withOutcomes({ as_of: asOf }) });
  try {
    const out = value(await f.client.callTool({ name: 'get_capabilities', arguments: {} }));
    assert.equal(out.as_of, asOf); assert.ok(out.cache_age_s >= 95 && out.cache_age_s < 150, String(out.cache_age_s));
    // The site is still asked (unchanged behaviour), but the answer shown is the session's copy with its age.
    assert.equal(out.mcp_bridge_compatibility, undefined); assert.equal(out.reads.get_outcomes.available, true);
    const caps = (await f.client.listTools()).tools.find(t => t.name === 'get_capabilities');
    assert.match(caps.description, /as_of and cache_age_s/);
  } finally { await f.close(); }
  const old = await connect({ responses: [{ body: fullCaps() }] });
  try {
    const out = value(await old.client.callTool({ name: 'get_capabilities', arguments: {} }));
    assert.equal(Object.hasOwn(out, 'cache_age_s'), false, 'an API without as_of: no age invented');
  } finally { await old.close(); }
}
// The fuller hosted descriptions keep every rule the short local ones carry (review of PR #19).
{
  const caps = withOutcomes({ work_administration: { available: true, operations: ['work.note'] } });
  const f = await connect({ responses: [] }, { capabilities: caps });
  try {
    const tools = new Map((await f.client.listTools()).tools.map(t => [t.name, t.description]));
    for (const [name, rule] of [['update_work_item', /Notes replace the saved text; empty clears/], ['update_work_item', /revision/],
      ['plan_changes', /acknowledge_deletion=true/], ['plan_changes', /original library URL/], ['plan_changes', /source_url\/redirect_id, all fields set/],
      ['diagnose_page', /available_windows/], ['diagnose_page', /unknown, not zero/], ['get_work_queue', /action_origin/],
      ['execute_change_set', /outcome_measurement/], ['execute_change_set', /acknowledgements/], ['get_signals', /evidence, not tasks/]])
      assert.match(tools.get(name) ?? '', rule, name);
  } finally { await f.close(); }
}
console.log('PASS: hosted get_outcomes is listed only when advertised, read-only under site:read, authorized and recorded; get_capabilities reports its age.');
