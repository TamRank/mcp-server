/** Pure hosted classification. Persistent link/grant decisions belong to H3b. */
import { LIMIT_CODES, INDEX_START_REFUSALS } from '../live-checks.js';
// A read the site refused with its own reason: pass that reason on, never an outage to retry.
// `code` must be the site's own code, unchanged: the caller passes nothing when it had to replace it.
// Excluded 4xx statuses, which never count as a refusal:
// - 401, 402, 403, 407: auth/payment; credential codes only count at their exact mapped status below.
// - 408 (timeout), 425 (too early), 429 (rate limit): transient, the read stays retryable.
// rest_* is WordPress itself (no route, forbidden), not a TamRank decision.
const NOT_A_REFUSAL = [401, 402, 403, 407, 408, 425, 429];
const PLAN_ROUTES = new Set(['/changes/proposals', '/changes/executions']);
export function isSiteReadRefusal({ status = 0, code, validWpEnvelope = false, kind = 'read' } = {}) {
  return kind === 'read' && validWpEnvelope === true && status >= 400 && status < 500 && !NOT_A_REFUSAL.includes(status)
    && typeof code === 'string' && !/^(rest|agent|cloud|pro)_/.test(code);
}

// These two POST routes only prepare a draft. The PRO planner resolves the
// target before inserting a set, so this exact validated refusal proves that
// no proposal was created. The same code on execute/recovery remains uncertain.
// A PageSpeed plan (golf 3) measures nothing and PRO stores it in one transaction: any validated
// refusal of the site's own (not auth, not a rate limit) means no plan was saved.
export function isSitePlanRefusal({ status = 0, code, validWpEnvelope = false, kind, method, path } = {}) {
  if (kind === 'write' && method === 'POST' && path === '/scans/executions/proposals')
    return isSiteReadRefusal({ status, code, validWpEnvelope, kind: 'read' });
  return kind === 'write' && method === 'POST' && PLAN_ROUTES.has(path)
    && status === 404 && validWpEnvelope === true && code === 'change_plan_target_unavailable';
}

// Limits the site enforces for AI assistants, and refusals of an index check start: the site
// decides these before any work (PRO golf 2), so they are no outage and nothing ran. One definition
// (live-checks.js) for both transports.
export function isSiteLimitRefusal({ status = 0, code, validWpEnvelope = false, method, path } = {}) {
  if (validWpEnvelope !== true || typeof code !== 'string') return false;
  if (LIMIT_CODES.has(code) && [400, 409, 429].includes(status)) return true;
  return method === 'POST' && path === '/index-checks' && INDEX_START_REFUSALS.has(code) && [400, 409, 429, 502, 503].includes(status);
}

// PRO resolves the work item (manual task or picked-up research) before it writes anything and answers
// 404 with one of these codes when it does not exist or is no longer open: nothing was changed.
const WORK_ITEM_MISSING = new Set(['manual_task_unavailable', 'workflow_work_unavailable']);
export function isWorkItemNotFound({ status = 0, code, validWpEnvelope = false, kind, method, path } = {}) {
  return kind === 'write' && method === 'POST' && path === '/work-items' && status === 404
    && validWpEnvelope === true && WORK_ITEM_MISSING.has(code);
}

export function mapHostedOutcome({ status = 0, code, validWpEnvelope = false, kind = 'read', method, path, retryAfter } = {}) {
  if (isSiteLimitRefusal({ status, code, validWpEnvelope, method, path }))
    return { code, retryable: false, outcome_unknown: false };
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
  if (isSitePlanRefusal({ status, code, validWpEnvelope, kind, method, path }))
    return { code, retryable: false, outcome_unknown: false };
  // The site's data changed between its two stamps of one read: nothing is wrong with the request, so reading again is fine.
  if (kind === 'read' && status === 409 && validWpEnvelope && code === 'workflow_read_changed')
    return { code, retryable: true, outcome_unknown: false };
  if (isSiteReadRefusal({ status, code, validWpEnvelope, kind })) return { code, retryable: false, outcome_unknown: false };
  if (isWorkItemNotFound({ status, code, validWpEnvelope, kind, method, path }))
    return { code: 'workflow_work_not_found', retryable: false, outcome_unknown: false };
  return { code: 'site_unavailable', retryable: kind === 'read', outcome_unknown: kind === 'write' };
}
