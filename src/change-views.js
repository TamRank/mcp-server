/** What the assistant reads back about a change plan: plain warnings, no internal bookkeeping, and why a draft read failed. */

// Plain sentences for the warning codes PRO puts on a plan (forward, redirect and rollback plans, PRO 1.0.0-rc).
// The server instructions say to show ALL warnings; a code alone does not tell the user anything.
const WARNING_TEXT = {
  storage_change_not_seo_outcome: 'This changes what is stored on the website. It is not a promise of better rankings or more clicks.',
  stored_fields_restored_not_seo_outcome: 'Undoing puts the stored values back. It is not a promise about rankings or clicks.',
  stored_values_restored_not_seo_outcome: 'Undoing puts the stored values back. It is not a promise about rankings or clicks.',
  frontend_output_not_verified: 'TamRank has not checked that the visible page shows the new value; a theme, another plugin or a cache can still show something else.',
  url_is_wordpress_id_link: 'The page address shown is the WordPress id link (?p=…), not necessarily the public address.',
  per_item_commit_partial_result_possible: 'Each item is saved on its own. If something goes wrong halfway, some items may be changed and others not.',
  newer_changes_block_rollback: 'If someone changes the same field later, undoing this change is blocked for that field, to protect the newer edit.',
  attachment_alt_usage_not_verified: 'Where this image is used is not checked; the alt text changes wherever the image appears.',
  social_fallback_output_not_verified: 'TamRank has not checked which social preview other plugins or the theme output when these fields are empty or overridden.',
  redirect_runtime_not_verified: 'The redirect is stored but not tried out; TamRank has not visited the old address after saving.',
  redirect_target_response_not_verified: 'Whether the target address answers correctly is not checked.',
  redirect_frontend_policy_not_verified: 'Other redirect rules (server, hosting or another plugin) can still win over this one.',
  redirect_presave_recheck_required: 'The redirect rules are checked again just before saving; if they changed, the plan is refused and needs a new plan.',
  redirect_deletion: 'This deletes a redirect: visitors and search engines that use the old address no longer get sent on.',
  redirect_serves_error_status: 'This rule answers with an error status (410 or 451) instead of sending visitors to another page.',
  preexisting_unrelated_literal_loop: 'The site already has a redirect loop elsewhere that this plan does not touch.',
  active_regex_not_evaluated: 'The site has active pattern (regex) redirects; how they interact with this change was not worked out.',
  restored_redirect_ids_are_server_assigned: 'A restored redirect gets a new id from the website.',
  schema_ownership_not_verified: 'Whether another plugin also outputs structured data for this page is not checked.',
  schema_source_recheck_required: 'The structured data source is checked again before saving.',
  schema_site_wide_identity_sample_only: 'This site-wide change was checked on a sample page only.',
};
const UNKNOWN_WARNING = 'A warning from the website that TamRank cannot explain yet; show the code to the user and do not treat it as harmless.';

/** [{code,text}] for a plan's warning codes; null when the reply carries none. */
export function planWarnings(data) {
  const codes = [data?.record?.envelope?.plan?.warning_codes, data?.record?.history?.warning_codes, data?.warning_codes, data?.proposal?.warning_codes]
    .find(Array.isArray);
  if (!codes) return null;
  return codes.filter(c => typeof c === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(c)).map(code => ({ code, text: WARNING_TEXT[code] ?? UNKNOWN_WARNING }));
}
export const withWarnings = data => { const warnings = planWarnings(data); return warnings ? { ...data, warnings } : data; };

// Internal bookkeeping in an execution record: site binding, request leases, budgets, audit ids and the
// hashes PRO compares before writing. None of it helps the user and all of it invites guessing. What a later
// step needs stays: change_set_id, plan_hash, change_token, policy_version, item ids, states, before/after.
const INTERNAL = new Set(['binding', 'dependencies', 'lease_until', 'payload_hash', 'token_id', 'attested_by_token_id', 'operator_id',
  'audit_id', 'budget', 'source_hash', 'source_states', 'installation_id', 'blog_id', 'attempts', 'last_attempt_at']);
function withoutInternal(value) {
  if (Array.isArray(value)) return value.map(withoutInternal);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !INTERNAL.has(k)).map(([k, v]) => [k, withoutInternal(v)]));
}

const STATE_TEXT = {
  planned: 'Planned, not applied yet. It is applied only after the user approves exactly this plan in chat.',
  expired: 'This plan expired before it was applied. Nothing was changed by it; make a new plan if it is still wanted.',
  running: 'Being applied right now. Read it again in a few seconds; do not apply it again.',
  executed: 'Applied.',
  partial: 'Partly applied: some items were changed and others not.',
  failed: 'Not applied: the website refused or could not finish it.',
  cancelled: 'Cancelled before it was applied. Nothing was changed by it.',
  retired: 'This plan can no longer be applied.',
  attribution_purged: 'Applied; who approved it is no longer stored (privacy request).',
  attribution_retired: 'Applied; who approved it is no longer stored.',
};
const target = t => t?.post_id ? `page ${t.post_id}` : t?.attachment_id ? `image ${t.attachment_id}` : t?.redirect_id ? `redirect ${t.redirect_id}`
  : t?.source_url ? `redirect from ${t.source_url}` : t?.original_redirect_id ? `redirect ${t.original_redirect_id}` : 'an item';

/** get_changes(kind=execution): the record without internal fields, plus a short summary and the warnings in words. */
export function changeReadView(data) {
  const record = data.record, plan = record.envelope?.plan ?? record.history, items = Array.isArray(plan?.items) ? plan.items : [];
  const results = Array.isArray(record.item_results) ? record.item_results : items.map(i => i?.result).filter(Boolean);
  const applied = results.filter(r => r?.state === 'applied').length;
  const what = items.map(i => `${(i?.operation ?? 'change').replace(/\.update$/, '').replace('_', ' ')} on ${target(i?.target)}`);
  const summary = [STATE_TEXT[record.state] ?? `State: ${record.state}.`,
    items.length ? `${items.length} item${items.length === 1 ? '' : 's'}: ${what.slice(0, 10).join(', ')}${what.length > 10 ? ', …' : ''}.` : '',
    results.length && ['executed', 'partial', 'failed'].includes(record.state) ? `${applied} of ${items.length || results.length} applied.` : ''].filter(Boolean).join(' ');
  const warnings = planWarnings(data);
  const note = record.state === 'planned' ? 'To apply it: show every item, value and warning, get explicit chat approval, then execute_change_set with this change_token and plan_hash.'
    : record.state === 'running' ? 'Read this set again with get_changes(kind=execution); never call execute_change_set again for it.'
    : ['executed', 'partial'].includes(record.state) ? 'item_results per item says what was applied; rollback_change_set can prepare an undo for applied items.'
    : 'Nothing more can be done with this set; make a new plan with plan_changes if needed.';
  return { ...withoutInternal(data), summary, ...(warnings ? { warnings } : {}), assistant_note: note };
}

/** A draft read that PRO answered with change_store_integrity (PRO before fix/mcp-launch-fixes): not damage. */
export function draftReadRefusal(executionReadable) {
  return ['change_draft_unavailable', 'This plan could not be read in its draft form. That does not mean the plan or the website is damaged.',
    { retryable: false, site_code: 'change_store_integrity',
      assistant_note: executionReadable ? 'Read the same plan with get_changes(kind=execution): plans from plan_changes are readable there before and after they are applied.'
        : 'Make a new plan with plan_changes if you need its values again; do not report data damage.' }];
}
