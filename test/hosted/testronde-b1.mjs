import assert from 'node:assert/strict';
import { connect } from './factory-fixtures.mjs';

// Bugs from the hosted test round of 15 Oct 2026 (B1, M1, M2, M5, C4), each against the stub site.
const value = output => JSON.parse(output.content[0].text);
const wp = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const changed = () => wp(409, 'workflow_read_changed', 'The work evidence changed during the read.');
const run = async (responses, name, args, check, contextOptions = {}) => {
  const f = await connect({ responses }, contextOptions);
  try { return await check(await f.client.callTool({ name, arguments: args }), f.stub); } finally { await f.close(); }
};

// B1: the site's data changed during a first-page read. TamRank reads once more by itself.
await run([changed(), { status: 200, body: { contract_version: 2, items: [] } }], 'get_work_queue', {}, (out, stub) => {
  assert.equal(out.isError, undefined, JSON.stringify(out));
  assert.equal(stub.calls.length, 2, 'one automatic re-read');
  assert.equal(stub.recorded.length, 1);
});
// B1: changed twice in a row: no third call, but the agent may restart the read.
await run([changed(), changed()], 'get_work_queue', {}, (out, stub) => {
  assert.equal(out.isError, true); assert.equal(stub.calls.length, 2);
  const v = value(out);
  assert.equal(v.code, 'workflow_read_changed');
  assert.equal(v.retryable, true); assert.equal(v.outcome_unknown, false);
  assert.match(v.message, /Restart the read/);
  assert.doesNotMatch(v.message, /did not go through/);
});
// B1: on a later page the snapshot is gone: never re-read that page silently, restart from the first.
await run([changed()], 'get_signals', { cursor: 'opaque-next' }, (out, stub) => {
  assert.equal(stub.calls.length, 1, 'a cursor read is never repeated automatically');
  const v = value(out);
  assert.equal(v.code, 'workflow_read_changed'); assert.equal(v.retryable, true);
  assert.match(v.assistant_note, /without cursor/);
});
// B1: the same code on a write is not retried (there is none today, but a write never repeats by itself).
await run([wp(409, 'workflow_read_changed', 'Synthetic')], 'update_work_item', { client_request_id: 'synthetic-work-001',
  operation: 'work.note', work_id: 'manual_fixture', expected_revision: 'a'.repeat(64), note: 'x' }, (out, stub) => {
  assert.equal(stub.calls.length, 1);
});

console.log('PASS: testronde 15 okt B1: read_changed: one re-read on a first page, else retryable with restart.');
