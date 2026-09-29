/** Pure hosted classification. Persistent link/grant decisions belong to H3b. */
// A read the site refused with its own reason: pass that reason on, never an outage to retry.
// `code` must be the site's own code, unchanged: the caller passes nothing when it had to replace it.
// Excluded 4xx statuses, which never count as a refusal:
// - 401, 402, 403, 407: auth/payment; credential codes only count at their exact mapped status below.
// - 408 (timeout), 425 (too early), 429 (rate limit): transient, the read stays retryable.
// rest_* is WordPress itself (no route, forbidden), not a TamRank decision.
const NOT_A_REFUSAL = [401, 402, 403, 407, 408, 425, 429];
export function isSiteReadRefusal({ status = 0, code, validWpEnvelope = false, kind = 'read' } = {}) {
  return kind === 'read' && validWpEnvelope === true && status >= 400 && status < 500 && !NOT_A_REFUSAL.includes(status)
    && typeof code === 'string' && !/^(rest|agent|cloud|pro)_/.test(code);
}

export function mapHostedOutcome({ status = 0, code, validWpEnvelope = false, kind = 'read', retryAfter } = {}) {
  const known = {
    '402:pro_required': 'site_entitlement_required',
    '401:agent_token_revoked': 'site_reconnect_required',
    '401:agent_token_expired': 'site_reconnect_required',
    '401:agent_token_invalid': 'site_reconnect_required',
    '401:agent_token_missing': 'upstream_auth_unavailable',
    '403:agent_scope_insufficient': 'site_scope_insufficient',
    '403:workflow_operator_unavailable': 'site_owner_unavailable',
    '409:workflow_profile_required': 'site_profile_required',
    '401:cloud_link_pending': 'site_link_unavailable',
    '401:cloud_link_revoked': 'site_reconnect_required',
  };
  // Any valid WP 429 refused before work. A proxy/HTML or mismatched 429 is no such evidence.
  if (status === 429 && validWpEnvelope) return { code: 'rate_limited', retryable: true, outcome_unknown: false,
    ...(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 3600 ? { retry_after: retryAfter } : {}) };
  const mapped = validWpEnvelope && (known[`${status}:${code}`]
    || (code === 'workflow_upgrade_required' ? 'site_upgrade_required' : undefined));
  if (mapped) return { code: mapped, retryable: false, outcome_unknown: false };
  if (isSiteReadRefusal({ status, code, validWpEnvelope, kind })) return { code, retryable: false, outcome_unknown: false };
  return { code: 'site_unavailable', retryable: kind === 'read', outcome_unknown: kind === 'write' };
}
