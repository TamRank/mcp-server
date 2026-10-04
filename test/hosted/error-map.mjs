import assert from 'node:assert/strict';
import { isSitePlanRefusal, isSiteReadRefusal, mapHostedOutcome } from '../../src/hosted/error-map.js';

const cases = [
  [402, 'pro_required', 'site_entitlement_required'],
  [401, 'agent_token_revoked', 'site_reconnect_required'],
  [401, 'agent_token_expired', 'site_reconnect_required'],
  [401, 'agent_token_invalid', 'site_reconnect_required'],
  [401, 'agent_token_missing', 'upstream_auth_unavailable'],
  [403, 'agent_scope_insufficient', 'site_scope_insufficient'],
  [403, 'workflow_operator_unavailable', 'site_owner_unavailable'],
  [409, 'workflow_profile_required', 'site_profile_required'],
  [409, 'workflow_upgrade_required', 'site_upgrade_required'],
  [401, 'cloud_link_pending', 'site_link_unavailable'],
  [401, 'cloud_link_revoked', 'site_reconnect_required'],
];
for (const [status, code, expected] of cases) {
  for (const kind of ['read', 'write']) assert.deepEqual(mapHostedOutcome({ status, code, kind, validWpEnvelope: true }),
    { code: expected, retryable: false, outcome_unknown: false });
}
for (const status of [0, 401, 403, 404, 500, 503]) {
  for (const validWpEnvelope of [false, true]) {
    assert.deepEqual(mapHostedOutcome({ status, code: 'unknown', validWpEnvelope, kind: 'write' }),
      { code: 'site_unavailable', retryable: false, outcome_unknown: true });
    // A 404 read in a valid envelope is the site's own refusal, not an outage (see below).
    assert.deepEqual(mapHostedOutcome({ status, code: 'unknown', validWpEnvelope }), status === 404 && validWpEnvelope
      ? { code: 'unknown', retryable: false, outcome_unknown: false } : { code: 'site_unavailable', retryable: true, outcome_unknown: false });
  }
}
// Reads refused by the site with its own code keep that code; writes, WordPress' rest_*, auth statuses and credential codes do not.
for (const [status, code] of [[400, 'workflow_invalid_query'], [404, 'workflow_work_unavailable'], [409, 'workflow_work_changed'],
  [410, 'signal_gone'], [422, 'change_invalid']]) {
  assert.deepEqual(mapHostedOutcome({ status, code, validWpEnvelope: true }), { code, retryable: false, outcome_unknown: false });
  assert.equal(isSiteReadRefusal({ status, code, validWpEnvelope: true }), true);
  assert.deepEqual(mapHostedOutcome({ status, code, validWpEnvelope: false }), { code: 'site_unavailable', retryable: true, outcome_unknown: false });
  assert.deepEqual(mapHostedOutcome({ status, code, validWpEnvelope: true, kind: 'write' }), { code: 'site_unavailable', retryable: false, outcome_unknown: true });
}
for (const [status, code] of [[404, 'rest_no_route'], [403, 'rest_forbidden'], [400, 'rest_invalid_param'], [401, 'workflow_x'],
  [402, 'workflow_x'], [403, 'workflow_x'], [407, 'workflow_x'], [408, 'workflow_x'], [425, 'workflow_x'], [404, 'agent_token_revoked'], [404, 'cloud_link_revoked'],
  [404, 'pro_required'], [500, 'workflow_store_unavailable'], [503, 'workflow_store_unavailable'], [404, undefined]]) {
  assert.deepEqual(mapHostedOutcome({ status, code, validWpEnvelope: true }), { code: 'site_unavailable', retryable: true, outcome_unknown: false }, `${status}:${code}`);
  assert.equal(isSiteReadRefusal({ status, code, validWpEnvelope: true }), false);
}
assert.deepEqual(mapHostedOutcome({ status: 401, code: 'agent_token_revoked', validWpEnvelope: false }),
  { code: 'site_unavailable', retryable: true, outcome_unknown: false });
assert.deepEqual(mapHostedOutcome({ status: 429, retryAfter: 20, validWpEnvelope: true }),
  { code: 'rate_limited', retryable: true, outcome_unknown: false, retry_after: 20 });
assert.equal(Object.hasOwn(mapHostedOutcome({ status: 429, retryAfter: 3601, validWpEnvelope: true }), 'retry_after'), false);
const planRefusal = { status: 404, code: 'change_plan_target_unavailable', validWpEnvelope: true,
  kind: 'write', method: 'POST', path: '/changes/executions' };
for (const path of ['/changes/executions', '/changes/proposals']) {
  assert.equal(isSitePlanRefusal({ ...planRefusal, path }), true);
  assert.deepEqual(mapHostedOutcome({ ...planRefusal, path }),
    { code: 'change_plan_target_unavailable', retryable: false, outcome_unknown: false });
}
for (const changes of [
  { path: '/changes/executions/' + 'a'.repeat(36) + '/execute' },
  { path: '/work-items' }, { method: 'GET' }, { status: 403 },
  { code: 'rest_no_route' }, { validWpEnvelope: false },
]) {
  assert.equal(isSitePlanRefusal({ ...planRefusal, ...changes }), false);
  assert.deepEqual(mapHostedOutcome({ ...planRefusal, ...changes }),
    { code: 'site_unavailable', retryable: false, outcome_unknown: true },
    'No other route, method, code, status or envelope becomes a definitive write refusal');
}
console.log('PASS: hosted mapping, known WP errors, site read refusals passed through, ERR02 unknown JSON/HTML, uncertain writes; no persistent actions.');
