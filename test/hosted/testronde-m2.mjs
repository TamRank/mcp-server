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

// M2: when the site answered and decided, the message does not suggest a network failure.
for (const [name, args, response] of [
  ['get_page', { post_id: 999999 }, wp(404, 'workflow_page_not_found', 'This page is not available.')],
  ['get_signals', { signal_id: 99999 }, wp(404, 'workflow_signal_not_found', 'This signal is not available.')],
  ['get_work_queue', { work_id: 'does_not_exist' }, wp(404, 'workflow_work_not_found', 'This work item is not in the current queue.')],
]) await run([response], name, args, out => {
  const v = value(out);
  assert.equal(v.code, response.body.code);
  assert.equal(v.message, `The website answered: ${response.body.message}`, name);
});
// M2: a real outage keeps saying the request did not go through.
await run([{ status: 503, html: '<html>down</html>' }], 'get_page', { post_id: 1 }, out =>
  assert.match(value(out).message, /^The request to the website did not go through\./));

console.log('PASS: testronde 15 okt M2: a site answer is not called a failed request.');
