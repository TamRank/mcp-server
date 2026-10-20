/** Round 2 of the launch test (taskbeheer live test, 20 Oct 2026, PRO 0.9.57): the mcp-server half. Synthetic VPS seam only. */
import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

const value = out => JSON.parse(out.content[0].text);
const wp = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const caps = () => { const c = fullCaps(); c.work_administration = { available: true, operations: ['work.note', 'work.pickup', 'importance.update'],
  manual: { available: true, operations: ['work.note'] }, importance: { available: true } }; return c; };
const call = async (responses, name, args, check) => {
  const f = await connect({ responses }, { capabilities: caps() });
  try { return await check(await f.client.callTool({ name, arguments: args }), f.stub); } finally { await f.close(); }
};
const note = { client_request_id: 'synthetic-work-001', operation: 'work.note', work_id: 'manual_fixture', expected_revision: 'a'.repeat(64), note: 'Synthetic note' };
const importance = { client_request_id: 'synthetic-work-002', operation: 'importance.update', post_id: 5, expected_value: 'standard', value: 'important' };
const pickup = { client_request_id: 'synthetic-pickup-1', operation: 'work.pickup', signal_id: 7, snapshot_hash: 'b'.repeat(64),
  target_keys: ['c'.repeat(64)], research_operation: 'investigate.near_win', title: 'Investigate the robots post' };
const failed = [];
const fix = async (name, run) => { try { await run(); } catch (err) { failed.push(`${name}: ${String(err.message).split('\n')[0]}`); } };

// P1-5. A refusal of an outdated request is a decision of the site: nothing was changed, so reading again is right and repeating is wrong.
for (const [args, code] of [[note, 'workflow_work_changed'], [importance, 'importance_value_changed'],
  [{ ...pickup, client_request_id: 'synthetic-pickup-2' }, 'signal_pickup_snapshot_changed'], [{ ...note, client_request_id: 'synthetic-work-003' }, 'pickup_note_origin_changed']]) {
  await fix(`P1-5 ${code}`, async () => {
    await call([wp(409, code, 'The work request was refused. Read the current work state before changing the request.')], 'update_work_item', args, out => {
      const v = value(out);
      assert.equal(out.isError, true); assert.equal(v.code, 'work_item_changed', JSON.stringify(v));
      assert.equal(v.outcome_unknown, false); assert.equal(v.retryable, false);
      assert.match(v.message, /This item changed since you read it; read get_work_queue\/get_page again before retrying/);
      assert.doesNotMatch(v.message, /did not go through|No reason was given/);
      assert.match(v.assistant_note, /same client_request_id|new client_request_id|fresh/i);
    });
  });
}
// Other 409s of the same route keep their meaning: a request ID reused with another payload says nothing about the work.
await fix('P1-5 other 409 unchanged', async () => {
  await call([wp(409, 'workflow_request_conflict', 'x')], 'update_work_item', note, out => {
    const v = value(out); assert.equal(v.code, 'site_unavailable'); assert.equal(v.outcome_unknown, true);
  });
});
// A refusal on another route is not this one.
await fix('P1-5 only POST /work-items', async () => {
  await call([wp(409, 'workflow_work_changed', 'x')], 'get_work_queue', { section: 'administration', work_id: 'manual_fixture' }, out => {
    assert.equal(value(out).code, 'workflow_work_changed');
  });
});

// P1-6. The refusals of update_work_item name the rule that refused, never a bare invalid_request.
await fix('P1-6 near_win pickup passes', async () => {
  await call([{ body: { contract_version: 2 } }], 'update_work_item', pickup, (out, stub) => {
    assert.equal(out.isError, undefined, out.content[0].text);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(stub.calls[0].bodyBytes)), { ...pickup });
  });
});
await fix('P1-6 pickup refuses expected_revision', async () => {
  await call([], 'update_work_item', { ...pickup, expected_revision: 'a'.repeat(64) }, (out, stub) => {
    const v = value(out); assert.equal(out.isError, true); assert.equal(v.code, 'invalid_request');
    assert.match(v.message, /work\.pickup .*expected_revision/); assert.equal(stub.calls.length, 0);
  });
});
await fix('P1-6 pickup needs title', async () => {
  const { title, ...without } = pickup;
  await call([], 'update_work_item', without, out => { assert.match(value(out).message, /work\.pickup needs .*title/); });
});
await fix('P1-6 other operation needs work_id and revision', async () => {
  const { expected_revision, ...without } = note;
  await call([], 'update_work_item', without, out => { assert.match(value(out).message, /work_id and expected_revision/); });
});
await fix('P1-6 importance form', async () => {
  await call([], 'update_work_item', { ...importance, work_id: 'manual_fixture' }, out => { assert.match(value(out).message, /importance\.update/); });
});
await fix('P1-6 importance fields on a pickup get pickup advice', async () => {
  await call([], 'update_work_item', { ...pickup, post_id: 5 }, out => {
    const m = value(out).message; assert.match(m, /post_id belong to importance\.update only; remove it/);
    assert.match(m, /work\.pickup takes signal_id, snapshot_hash, target_keys, research_operation and title/); assert.doesNotMatch(m, /needs work_id|takes work_id/);
  });
  await call([], 'update_work_item', { ...note, value: 'important' }, out => { assert.match(value(out).message, /note takes work_id|work\.note takes work_id and expected_revision/); });
});
await fix('P1-6 local description names the importance form', async () => {
  const { registerWorkflowTools } = await import('../../src/workflow-tools.js');
  const registered = new Map();
  registerWorkflowTools({ registerTool: (name, config) => { registered.set(name, config); return { enabled: true }; } }, { get: async () => ({}), post: async () => ({}) },
    { capabilities: { work_administration: { available: true, operations: ['work.note'] } } });
  assert.match(registered.get('update_work_item').description, /importance\.update: post_id \+ expected_value \+ value, no work_id or expected_revision/);
});
await fix('P1-6 description states the rules', async () => {
  const f = await connect({}, { capabilities: caps() });
  try {
    const tool = (await f.client.listTools()).tools.find(t => t.name === 'update_work_item');
    assert.match(tool.description, /pickup needs title .*refuses expected_revision/);
    assert.match(tool.description, /work_id \+ expected_revision/);
  } finally { await f.close(); }
});

// P2. A pickup answer carries no internal flags; a replay says what it means.
const receipt = (replay = false) => ({ contract_version: 2, lane: 'work', operation: 'work.pickup', client_request_id: pickup.client_request_id, signal_id: 7,
  snapshot_hash: pickup.snapshot_hash, work_ids: ['pickup_' + 'd'.repeat(32)], selected_target_count: 1, created_target_count: replay ? 0 : 1,
  reused_target_count: replay ? 1 : 0, remaining_target_count: 0, source_selection_reused: replay, details_applied_to_new_work_only: true,
  website_changed: false, outcome: 'not_measured' });
await fix('P2 no internal fields', async () => {
  await call([{ body: receipt() }], 'update_work_item', pickup, out => {
    const v = value(out); assert.equal(out.isError, undefined);
    assert.equal(Object.hasOwn(v, 'source_selection_reused'), false); assert.equal(Object.hasOwn(v, 'details_applied_to_new_work_only'), false);
    assert.deepEqual(v.work_ids, ['pickup_' + 'd'.repeat(32)]); assert.equal(v.created_target_count, 1); assert.equal(v.assistant_note, undefined);
  });
});
await fix('P2 replay explained', async () => {
  await call([{ body: receipt(true) }], 'update_work_item', pickup, out => {
    const v = value(out);
    assert.equal(Object.hasOwn(v, 'source_selection_reused'), false); assert.equal(Object.hasOwn(v, 'details_applied_to_new_work_only'), false);
    assert.match(v.assistant_note, /already had work/); assert.match(v.assistant_note, /title|note|priority|deadline/);
  });
});
await fix('P2 other operations untouched', async () => {
  await call([{ body: { contract_version: 2, operation: 'work.note', website_changed: false, source_selection_reused: false } }], 'update_work_item', note, out => {
    assert.equal(value(out).source_selection_reused, false);
  });
});

if (failed.length) { console.error('FAIL:\n' + failed.join('\n')); process.exit(1); }
console.log('PASS: launch test round 2: outdated work requests map to work_item_changed (nothing changed, read again), update_work_item refusals name the rule, pickup answers hide internal flags.');
