import assert from 'node:assert/strict';
import { mapHostedOutcome } from '../../src/hosted/error-map.js';

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
    assert.deepEqual(mapHostedOutcome({ status, code: 'unknown', validWpEnvelope }),
      { code: 'site_unavailable', retryable: true, outcome_unknown: false });
  }
}
assert.deepEqual(mapHostedOutcome({ status: 401, code: 'agent_token_revoked', validWpEnvelope: false }),
  { code: 'site_unavailable', retryable: true, outcome_unknown: false });
assert.deepEqual(mapHostedOutcome({ status: 429, retryAfter: 20, validWpEnvelope: true }),
  { code: 'rate_limited', retryable: true, outcome_unknown: false, retry_after: 20 });
assert.equal(Object.hasOwn(mapHostedOutcome({ status: 429, retryAfter: 3601, validWpEnvelope: true }), 'retry_after'), false);
console.log('PASS: hosted mapping, known WP errors, ERR02 unknown JSON/HTML, uncertain writes; no persistent actions.');
