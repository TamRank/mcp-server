/** Launch-readiness test of 20 Oct 2026 (tamrank.com, PRO 0.9.57): the mcp-server half of the fixes. Synthetic VPS seam only. */
import assert from 'node:assert/strict';
import { connect, fullCaps, id, hash, planArgs } from './factory-fixtures.mjs';

const value = out => JSON.parse(out.content[0].text);
const wp = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const call = async (responses, name, args, check, contextOptions = {}) => {
  const f = await connect({ responses }, contextOptions);
  try { return await check(await f.client.callTool({ name, arguments: args }), f.stub); } finally { await f.close(); }
};
const item = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const warningCodes = ['storage_change_not_seo_outcome', 'frontend_output_not_verified', 'url_is_wordpress_id_link',
  'per_item_commit_partial_result_possible', 'newer_changes_block_rollback'];
// The shape get_changes(kind=execution) returned live for an executed set, with synthetic ids.
const executed = () => ({ contract_version: 1, record: { state: 'executed', plan_persisted: true, approval_recorded: true,
  envelope: { plan_hash: hash, change_token: 'trce1.' + 'b'.repeat(64), plan: { change_set_id: id, policy_version: 'workflow-field-execution-1',
    binding: { blog_id: 1, installation_id: '11111111-1111-4111-8111-111111111111', operator_id: 1, site_origin: 'https://site.example.invalid', token_id: 3 },
    items: [{ item_id: item, operation: 'meta.update', target: { post_id: 315 }, url: 'https://site.example.invalid/?p=315',
      before: { meta_description: { exists: false, value: null } }, after: { meta_description: { exists: true, value: 'New' } },
      fields: { meta_description: { mode: 'set', value: 'New' } },
      dependencies: { content_hash: 'c'.repeat(64), settings_hash: 'd'.repeat(64), target_hash: 'e'.repeat(64), reader_contract: 'tamrank-meta-1', reader_present: true } }],
    required_acknowledgements: [], warning_codes: warningCodes } },
  registration: { execution_id: other(), state: 'executed', lease_until: 1792087462, payload_hash: 'f'.repeat(64), registered_at: 1792087342, finished_at: 1792087347,
    budget: { operation_count: 1, operator_limit: 30, version: 1, window_start: 1792087320 },
    attestation: { attested_by_token_id: 3, operator_id: 1, mode: 'chat_attested', human_verified: false, statement: 'user approved in chat' } },
  item_results: [{ item_id: item, state: 'applied', changed: true, attempts: 1, audit_id: 39, committed_at: 1792087342,
    delivery: { attempts: 1, last_attempt_at: 1792087343, error_code: null, status: 'delivered',
      result: { outcome_measurement: 'active', source_hash: 'a'.repeat(64), source_states: { index: { state: 'synchronized' } } } } }] } });
function other() { return 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; }
// Every fix is its own block, so a run names each one that fails instead of stopping at the first.
const failed = [];
const fix = async (name, run) => { try { await run(); } catch (err) { failed.push(`${name}: ${String(err.message).split('\n')[0]}`); } };

// 1. get_changes without kind reads the execution record (a plan is readable there in every state), not the draft.
await fix('fix 1 default kind', async () => {
await call([{ body: executed() }], 'get_changes', { change_set_id: id }, (out, stub) => {
  assert.equal(out.isError, undefined, out.content[0].text);
  assert.equal(new URL(stub.calls[0].url).pathname, `/wp-json/tamrank/v2/changes/executions/${id}`);
  assert.equal(stub.events.find(e => e.type === 'authorize').parsedArgs.kind, 'execution');
});
});

// 1. A draft read PRO 0.9.57 answers with change_store_integrity is not reported as damaged data.
await fix('fix 1 draft refusal', async () => {
await call([wp(409, 'change_store_integrity', 'The private proposal could not be stored or read.')], 'get_changes', { change_set_id: id, kind: 'draft' }, out => {
  const v = value(out);
  assert.equal(out.isError, true); assert.equal(v.code, 'change_draft_unavailable'); assert.equal(v.site_code, 'change_store_integrity');
  assert.doesNotMatch(v.message, /could not be stored|corrupt|integrity/i); assert.match(v.message, /not mean the plan or the website is damaged/);
  assert.match(v.assistant_note, /get_changes\(kind=execution\)/); assert.equal(v.retryable, false);
});
});

// 1. A read of an unknown set says what the site answered, not "may or may not have been applied".
await fix('fix 1 read refusal', async () => {
await call([wp(404, 'change_execution_not_found', 'This change set is not available.')], 'get_changes', { change_set_id: id, kind: 'execution' }, out => {
  const v = value(out);
  assert.equal(v.code, 'change_execution_not_found'); assert.equal(v.message, 'The website answered: This change set is not available.');
});
});

// 2. Two items on one post (meta + social on 410): refused here, as PRO refuses it, with what repeats and how to split.
await fix('fix 2 one item per page', async () => {
{
  const args = { ...planArgs(), items: [
    { operation: 'meta.update', target: { post_id: 410 }, fields: { meta_title: { mode: 'set', value: 'Title' } } },
    { operation: 'social.update', target: { post_id: 410 }, fields: { social_title: { mode: 'set', value: 'OG title' } } }] };
  await call([], 'plan_changes', args, (out, stub) => {
    const v = value(out);
    assert.equal(out.isError, true); assert.equal(v.code, 'invalid_request'); assert.equal(stub.calls.length, 0);
    assert.match(v.message, /page or image 410 \(meta\.update and social\.update\)/);
    assert.match(v.message, /separate plan/); assert.doesNotMatch(v.message, /Invalid or unknown tool arguments/);
  });
}
});

// 6. A plan carries every warning code with a plain sentence.
await fix('fix 6 warnings in words', async () => {
{
  // meta_title and meta_description together in one item stay one valid item.
  const one = { ...planArgs(), items: [{ operation: 'meta.update', target: { post_id: 410 },
    fields: { meta_title: { mode: 'set', value: 'Title' }, meta_description: { mode: 'set', value: 'Description' } } }] };
  await call([{ body: { contract_version: 1, record: { state: 'planned', envelope: { plan: { change_set_id: id, policy_version: 'workflow-field-execution-1',
    warning_codes: warningCodes }, plan_hash: hash } } } }], 'plan_changes', one, out => {
    const v = value(out);
    assert.equal(out.isError, undefined, out.content[0].text);
    assert.deepEqual(v.warnings.map(w => w.code), warningCodes);
    for (const w of v.warnings) { assert.equal(typeof w.text, 'string'); assert.doesNotMatch(w.text, /cannot explain/, w.code); }
    assert.deepEqual(v.record.envelope.plan.warning_codes, warningCodes);
  });
}
});

// 4. A wrong field value names the field and the expected form.
await fix('fix 4 argument refusals', async () => {
for (const [name, args, field, form] of [
  ['get_outcomes', { since: 'gisteren' }, 'since', /YYYY-MM-DD/],
  ['list_changes', { since: 'yesterday' }, 'since', /YYYY-MM-DD/],
  ['get_changes', { change_set_id: '245221b9' }, 'change_set_id', /8-4-4-4-12/],
  ['get_page', { post_id: 'abc' }, 'post_id', /whole number|number/],
  ['get_signals', { signal_id: 1, bogus: true }, 'bogus', /unknown argument/],
]) await call([], name, args, (out, stub) => {
  const v = value(out);
  assert.equal(v.code, 'invalid_request', name); assert.equal(stub.calls.length, 0);
  assert.ok(v.message.includes(field), `${name}: ${v.message}`); assert.match(v.message, form, name);
  assert.doesNotMatch(v.message, /gisteren|yesterday|abc/, 'the value itself is never echoed');
}, { capabilities: { ...fullCaps(), reads: { ...fullCaps().reads, get_outcomes: { available: true } } } });
// Many long unknown argument names stay a short message (Greptile on PR #30).
const flood = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`unknown_${i}_${'x'.repeat(300)}`, true]));
await call([], 'get_signals', flood, out => {
  const v = value(out);
  assert.equal(v.code, 'invalid_request'); assert.ok(v.message.length <= 700, `length ${v.message.length}`);
  assert.match(v.message, /unknown arguments .*\(and 195 more\)/);
});
});

// 5. get_changes(kind=execution): no internal bookkeeping, a short summary, warnings in words; what later steps need stays.
await fix('fix 5 execution view', async () => {
await call([{ body: executed() }], 'get_changes', { change_set_id: id, kind: 'execution' }, (out, stub) => {
  const v = value(out), text = out.content[0].text;
  assert.equal(out.isError, undefined, text);
  for (const key of ['lease_until', 'token_id', 'operator_id', 'payload_hash', 'binding', 'dependencies', 'audit_id', 'budget', 'source_hash', 'source_states', 'installation_id'])
    assert.equal(text.includes(`"${key}"`), false, key);
  assert.equal(v.record.envelope.plan_hash, hash); assert.equal(v.record.envelope.change_token, 'trce1.' + 'b'.repeat(64));
  assert.equal(v.record.envelope.plan.items[0].item_id, item); assert.equal(v.record.item_results[0].state, 'applied');
  assert.equal(v.record.item_results[0].delivery.result.outcome_measurement, 'active');
  assert.match(v.summary, /^Applied\. 1 item: meta on page 315\. 1 of 1 applied\.$/);
  assert.equal(v.warnings.length, warningCodes.length); assert.match(v.assistant_note, /rollback_change_set/);
  // The VPS still finds the set, its hash, policy and state in what it records.
  const recorded = stub.recorded.find(r => r.toolName === 'get_changes').result.record;
  assert.equal(recorded.envelope.plan.change_set_id, id); assert.equal(recorded.envelope.plan_hash, hash);
  assert.equal(recorded.envelope.plan.policy_version, 'workflow-field-execution-1'); assert.equal(recorded.state, 'executed');
});
});

// 7. list_changes and get_outcomes return an opaque cursor bound to the filters, like the other reads.
await fix('fix 7 page cursor', async () => {
{
  const caps = fullCaps(); caps.reads.get_outcomes = { available: true };
  const rows = page => ({ contract_version: 2, items: [], pagination: { page, per_page: 1, total: 3, total_pages: 3, has_more: true } });
  const f = await connect({ responses: [{ body: rows(1) }, { body: rows(2) }] }, { capabilities: caps });
  try {
    const first = value(await f.client.callTool({ name: 'list_changes', arguments: { post_id: 7, limit: 1 } }));
    assert.match(first.next_cursor, /^pc1\.2\.[a-f0-9]{16}$/);
    const second = value(await f.client.callTool({ name: 'list_changes', arguments: { post_id: 7, limit: 1, cursor: first.next_cursor } }));
    assert.equal(new URL(f.stub.calls[1].url).searchParams.get('page'), '2'); assert.match(second.next_cursor, /^pc1\.3\./);
    const moved = await f.client.callTool({ name: 'list_changes', arguments: { post_id: 8, limit: 1, cursor: first.next_cursor } });
    assert.equal(moved.isError, true); assert.match(value(moved).message, /other filters/); assert.equal(f.stub.calls.length, 2);
    const elsewhere = await f.client.callTool({ name: 'get_outcomes', arguments: { post_id: 7, limit: 1, cursor: first.next_cursor } });
    assert.equal(elsewhere.isError, true, 'a list_changes cursor is not a get_outcomes cursor');
  } finally { await f.close(); }
}
});

if (failed.length) { console.error('FAIL:\n' + failed.join('\n')); process.exit(1); }
console.log('PASS: launch test 20 Oct: get_changes reads executions by default and explains a draft refusal, one-item-per-page refusal says how to split, argument refusals name the field and form, execution reads hide internals with a summary, warnings in words, filter-bound page cursors.');
