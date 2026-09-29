import assert from 'node:assert/strict';
import { connect } from './factory-fixtures.mjs';

// A read the site refused with its own TamRank reason is not an outage. The
// caller gets that reason and is told not to retry; everything that is not
// such a reason keeps failing closed as site_unavailable.
const value = output => JSON.parse(output.content[0].text);
const wp = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const call = async (name, args, response) => {
  const fixture = await connect({ responses: [response] });
  try {
    const output = await fixture.client.callTool({ name, arguments: args });
    assert.equal(output.isError, true, JSON.stringify(output));
    assert.equal(fixture.stub.calls.length, 1); assert.equal(fixture.stub.recorded.length, 0);
    return { url: fixture.stub.calls[0].url, ...value(output) };
  } finally { await fixture.close(); }
};
const unavailable = { code: 'site_unavailable', message: 'Site refused the request (404). The site refused this workflow request.',
  retryable: true, outcome_unknown: false };

// Sam's claude.ai test, 29 sep: a dashboard group has no administration state.
{
  const { url, ...output } = await call('get_work_queue', { section: 'administration', work_id: 'grp_alt_images' },
    wp(404, 'workflow_work_unavailable', 'The work operation could not be completed.'));
  assert.equal(url, 'https://site.example.invalid/wp-json/tamrank/v2/work-items/grp_alt_images');
  assert.deepEqual(output, { code: 'workflow_work_unavailable',
    message: 'Site refused the request (404). This work item is in the queue but has no administration state; only picked-up research work and manual tasks have one. Read it with section targets instead.',
    retryable: false, outcome_unknown: false });
}
// The same code outside administration keeps the site's own text.
assert.deepEqual((({ url, ...o }) => o)(await call('get_work_queue', { work_id: 'grp_alt_images', section: 'targets' },
  wp(404, 'workflow_work_unavailable', 'The work operation could not be completed.'))),
  { code: 'workflow_work_unavailable', message: 'Site refused the request (404). The work operation could not be completed.',
    retryable: false, outcome_unknown: false });
// 400 and 409 domain refusals from the shared read path, not a work-items exception.
for (const [name, args, response] of [
  ['get_signals', { section: 'targets' }, wp(400, 'workflow_signal_id_required', 'A signal_id is required for this section.')],
  ['search_pages', { type: 'post' }, wp(400, 'workflow_invalid_type', 'The requested stored data is invalid, unavailable or exceeds the read budget.')],
  ['get_work_queue', { section: 'administration', work_id: 'manual_fixture' }, wp(409, 'workflow_work_changed', 'The work request was refused. Read the current work state before changing the request.')],
  ['get_page', { post_id: 1 }, wp(404, 'signal_subject_unavailable', 'Synthetic domain refusal.')],
]) {
  const { url, ...output } = await call(name, args, response);
  assert.deepEqual(output, { code: response.body.code, message: `Site refused the request (${response.status}). ${response.body.message}`,
    retryable: false, outcome_unknown: false }, name);
}
// No route, a WAF/HTML page, WordPress' own refusals and a mismatched envelope are no domain evidence.
for (const response of [
  wp(404, 'rest_no_route', 'No route was found matching the URL and request method.'),
  { status: 404, html: '<html><body>Not Found</body></html>' },
  { status: 404, body: { code: 'workflow_work_unavailable', message: 'Synthetic', data: { status: 200 } } },
  { status: 404, body: { code: 'workflow_work_unavailable', data: { status: 404 } } },
]) assert.deepEqual((({ url, ...o }) => o)(await call('get_work_queue', { section: 'administration', work_id: 'grp_alt_images' }, response)),
  response.html ? { ...unavailable, message: 'Site refused the request (404). The site returned an unavailable or incompatible workflow response.' } : unavailable);
for (const [status, code] of [[403, 'rest_forbidden'], [401, 'workflow_session_invalid'], [403, 'workflow_forbidden'],
  [404, 'agent_token_revoked'], [404, 'cloud_link_revoked'], [404, 'pro_required'], [400, 'rest_invalid_param']]) {
  assert.deepEqual((({ url, ...o }) => o)(await call('get_site_context', {}, wp(status, code, 'Synthetic'))),
    { ...unavailable, message: `Site refused the request (${status}). The site refused this workflow request.` }, `${status}:${code}`);
}
// Writes are out of scope: a refused write still reports an unknown outcome.
{
  const { url, ...output } = await call('update_work_item', { client_request_id: 'synthetic-work-001', operation: 'work.note',
    work_id: 'manual_fixture', expected_revision: 'a'.repeat(64), note: 'Synthetic note' },
    wp(404, 'workflow_work_unavailable', 'The work operation could not be completed.'));
  assert.deepEqual(output, { code: 'site_unavailable', message: 'Site refused the request (404). The site refused this workflow request.',
    retryable: false, outcome_unknown: true });
}
console.log('PASS: hosted reads pass TamRank domain refusals through (code, site text, not retryable); rest_*, HTML, auth statuses, mismatched envelopes and writes stay site_unavailable.');
