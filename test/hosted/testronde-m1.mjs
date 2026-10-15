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

// M1: the site says the work item does not exist; it decided that before writing anything.
for (const code of ['manual_task_unavailable', 'workflow_work_unavailable']) {
  await run([wp(404, code, 'The work request was refused. Read the current work state before changing the request.')], 'update_work_item',
    { client_request_id: 'synthetic-work-001', operation: 'work.note', work_id: 'manual_does_not_exist', expected_revision: 'a'.repeat(64), note: 'x' },
    out => {
      const v = value(out);
      assert.equal(v.code, 'workflow_work_not_found', code);
      assert.equal(v.retryable, false); assert.equal(v.outcome_unknown, false);
      assert.match(v.message, /Nothing was changed/);
      assert.doesNotMatch(v.message, /did not go through|No reason was given/);
    });
}
// M1: any other refused write still has an unknown outcome.
await run([wp(409, 'workflow_work_changed', 'Synthetic')], 'update_work_item',
  { client_request_id: 'synthetic-work-001', operation: 'work.note', work_id: 'manual_fixture', expected_revision: 'a'.repeat(64), note: 'x' },
  out => { const v = value(out); assert.equal(v.code, 'site_unavailable'); assert.equal(v.outcome_unknown, true); });

console.log('PASS: testronde 15 okt M1: unknown work item on a write is not found, not uncertain.');
