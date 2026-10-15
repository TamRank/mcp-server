/** Golf 2b (14 Oct 2026): earlier changes as a list, a live check of one page, and a targeted index check.
 * The site does every fetch and enforces every limit (PRO TamRank_Workflow_MCP_Limits); this module only
 * shapes the calls and says a refusal in plain words. Nothing here fetches a URL itself. */
import { z } from 'zod';

const integer = v => Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const isoMoment = v => typeof v === 'string' && v.length <= 40 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9]{2}:?[0-9]{2})$/.test(v)
  && Number.isFinite(Date.parse(v)) ? v : undefined;

/** Routes whose answers carry contract_version 1 (the golf 2 PRO contract), on exactly these methods. */
export function liveCheckRoute(method, path) {
  return (method === 'GET' && (path === '/live-check' || /^\/index-checks\/idx_[a-f0-9]{24}$/.test(path)))
    || (method === 'POST' && path === '/index-checks');
}

// The site refuses these before any work, with its own reason. They are a decision, never an outage.
export const LIMIT_CODES = new Set(['live_check_limit_reached', 'index_check_daily_limit_reached', 'index_check_too_many_urls',
  'pagespeed_url_limit_reached', 'pagespeed_full_scan_limit_reached', 'schema_scan_already_running']);
export const INDEX_START_REFUSALS = new Set(['index_check_invalid', 'index_check_too_many_urls', 'index_check_unknown_url',
  'gsc_not_connected', 'gsc_property_mismatch', 'index_check_daily_limit_reached', 'index_check_backend_unavailable', 'mcp_limit_unavailable']);

/** Only bounded numbers, one moment and the refused addresses cross the error boundary; never arbitrary site data. */
export function limitDetails(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const key of ['limit', 'used', 'remaining', 'requested', 'max_urls']) if (integer(data[key]) !== undefined) out[key] = data[key];
  const after = integer(data.retry_after_seconds) ?? integer(data.retry_after);
  if (after !== undefined && after <= 7 * 86400) out.retry_after_seconds = after;
  if (isoMoment(data.retry_at)) out.retry_at = data.retry_at;
  if (Array.isArray(data.refused_urls)) out.refused_urls = data.refused_urls.filter(u => typeof u === 'string' && u.length <= 2048).slice(0, 50);
  if (Array.isArray(data.blocked_urls)) out.blocked_urls = data.blocked_urls.filter(u => typeof u === 'string' && u.length <= 2048).slice(0, 50);
  return out;
}

const when = d => d.retry_at ? ` There is room again from ${d.retry_at}.` : d.retry_after_seconds ? ` There is room again in about ${Math.max(1, Math.ceil(d.retry_after_seconds / 60))} minutes.` : '';
/** The plain-language message for a limit refusal, or undefined for any other code. Written here, not taken from the site. */
export function limitMessage(code, d = {}) {
  if (code === 'live_check_limit_reached')
    return `Live checks by an AI assistant are used up for this hour on this site${d.limit ? ` (${d.limit} per hour)` : ''}. Nothing was fetched.${when(d)}`;
  if (code === 'index_check_daily_limit_reached')
    return `Index checks started by an AI assistant are used up for today on this site${d.limit ? ` (${d.limit} per day)` : ''}. Nothing was checked.${when(d)} The site's own index scan is not affected.`;
  if (code === 'index_check_too_many_urls')
    return `At most ${d.max_urls ?? 50} pages can be checked at once. Nothing was checked; split the list.`;
  if (code === 'pagespeed_url_limit_reached')
    return `PageSpeed was already measured the maximum number of times today for ${d.blocked_urls?.length ? 'these pages' : 'this page'}. Nothing was measured.${when(d)}`;
  if (code === 'pagespeed_full_scan_limit_reached')
    return `A full PageSpeed scan already ran in the last 24 hours on this site. Nothing was started.${when(d)}`;
  if (code === 'schema_scan_already_running')
    return 'A structured data scan is already running on this site. Wait until it has finished; nothing was started.';
  return undefined;
}

const pageId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const checkId = z.string().regex(/^idx_[a-f0-9]{24}$/);

/** start_scan / get_scan_status as a connection without the PageSpeed and schema machinery has them: index only. */
export function indexCheckDefinitions(siteUrl) {
  return {
    start_scan: { description: 'Index check now: up to 50 own URLs.', indexCheck: 'start', path: () => '/index-checks',
      schema: { type: z.literal('index'), urls: z.array(siteUrl).min(1).max(50) } },
    get_scan_status: { description: 'Result of an index check by check_id.', indexCheck: 'status', path: a => '/index-checks/' + a.check_id,
      schema: { type: z.literal('index'), check_id: checkId } },
  };
}

// Where a stored status came from (testronde 15 Oct 2026: a cached answer was shown as a fresh check). A PRO that
// knows sends source and from_cache; anything else stays null, which the explanation calls unknown, never fresh.
const INDEX_SOURCES = ['url_inspection', 'search_console_impressions'];
const result = r => r && typeof r === 'object' ? { url: typeof r.url === 'string' ? r.url : null, post_id: integer(r.post_id) ?? null,
  index_status: typeof r.index_status === 'string' ? r.index_status : null, checked_at: typeof r.checked_at === 'string' ? r.checked_at : null,
  source: INDEX_SOURCES.includes(r.source) ? r.source : null, from_cache: typeof r.from_cache === 'boolean' ? r.from_cache : null } : null;
/** What the times and sources of these results mean, only for the cases that occur. */
function provenanceNote(results) {
  const notes = [];
  if (results.some(r => r.source === 'url_inspection'))
    notes.push('For source url_inspection, checked_at is when Google gave that answer, not when this check was asked.');
  if (results.some(r => r.from_cache === true))
    notes.push('A page with from_cache true was answered from an earlier check (at most 48 hours old): no new request went to Google for it.');
  if (results.some(r => r.source === 'search_console_impressions'))
    notes.push('A page with source search_console_impressions is marked indexed because it had impressions in Search Console; Google was not asked about it.');
  if (results.some(r => r.index_status !== null && r.source === null))
    notes.push('For a page without a source the site did not say where its status came from: its checked_at may be when the site saved it. Do not present it as a fresh check.');
  return notes.join(' ');
}
/** The site's answer to a start or status read, as shown. Unknown shapes are refused by the caller. */
export function indexCheckView(data) {
  if (data?.contract_version !== 1 || typeof data.check_id !== 'string' || !/^idx_[a-f0-9]{24}$/.test(data.check_id)
    || !['running', 'completed', 'expired'].includes(data.status) || !Array.isArray(data.results)) return null;
  const quota = data.quota && typeof data.quota === 'object' ? { limit: integer(data.quota.limit) ?? null, used: integer(data.quota.used) ?? null,
    remaining: integer(data.quota.remaining) ?? null, resets_at: isoMoment(data.quota.resets_at) ?? null } : undefined;
  const explanation = data.status === 'running' ? 'Google is still checking these pages. Read the status again in a minute or two with the same check_id.'
    : data.status === 'expired' ? 'TamRank lost track of this check before Google answered. The results below are what was known; start a new check only if the user asks.'
    : 'Done. Each page shows its index status, when it was established (checked_at) and where it came from (source).';
  const results = data.results.map(result).filter(Boolean);
  const note = provenanceNote(results);
  return { check_id: data.check_id, status: data.status, explanation: note ? explanation + ' ' + note : explanation, urls: integer(data.urls) ?? data.results.length,
    ...(integer(data.sent_to_google) !== undefined ? { sent_to_google: data.sent_to_google } : {}),
    ...(integer(data.answered_from_recent_cache) !== undefined ? { answered_from_recent_cache: data.answered_from_recent_cache } : {}),
    results, ...(quota ? { todays_room: quota } : {}) };
}

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => v === null || typeof v === 'string';
const STOPPED = ['timeout', 'request_failed', 'too_many_redirects', 'redirect_leaves_site'];
const pick = (o, keys, ok) => keys.every(k => ok(o[k])) ? Object.fromEntries(keys.map(k => [k, o[k]])) : null;
/** A live check as shown: what the page serves now next to what TamRank has saved. Only the documented
 * fields, each with its documented type; any other shape is refused by the caller, never shown as a result. */
export function liveCheckView(data) {
  if (data?.contract_version !== 1 || typeof data.url !== 'string' || !text(data.checked_at) || !text(data.final_url)
    || !(data.status === null || Number.isInteger(data.status)) || !(data.stopped === null || STOPPED.includes(data.stopped))
    || !text(data.stopped_reason ?? null) || !Array.isArray(data.redirects) || !(data.post_id == null || integer(data.post_id) !== undefined)) return null;
  const live = data.live === null || data.live === undefined ? null
    : plain(data.live) ? pick(data.live, ['title', 'meta_description', 'meta_robots', 'canonical', 'x_robots_tag'], v => v === undefined || text(v)) : false;
  const stored = data.stored === null || data.stored === undefined ? null
    : plain(data.stored) ? pick(data.stored, ['title', 'meta_description', 'canonical', 'canonical_if_unset'], v => v === undefined || text(v)) : false;
  const matches = plain(data.matches) ? pick(data.matches, ['title', 'meta_description', 'canonical', 'noindex'],
    v => v === undefined || v === null || typeof v === 'boolean') : null;
  const redirects = data.redirects.map(r => plain(r) && typeof r.url === 'string' && (r.status === null || Number.isInteger(r.status)) && text(r.location ?? null)
    ? { url: r.url, status: r.status, location: r.location ?? null } : null);
  // Without a stop reason the site fetched the page, so the page data must be there.
  if (live === false || stored === false || !matches || redirects.includes(null) || (data.stopped === null && !live)) return null;
  if (live && data.live.body_truncated !== undefined && typeof data.live.body_truncated !== 'boolean') return null;
  if (stored && data.stored.noindex !== undefined && typeof data.stored.noindex !== 'boolean') return null;
  if (!['stored', 'permalink', undefined].includes(data.matches.canonical_compared_with)) return null;
  const room = data.limits?.live_checks;
  return { url: data.url, checked_at: data.checked_at ?? null, freshness: 'live', status: data.status, final_url: data.final_url ?? null, redirects,
    stopped: data.stopped, stopped_reason: data.stopped_reason ?? null,
    live: live && { ...live, ...(data.live.body_truncated !== undefined ? { body_truncated: data.live.body_truncated } : {}) },
    stored: stored && { ...stored, ...(data.stored.noindex !== undefined ? { noindex: data.stored.noindex } : {}) },
    matches: { ...matches, ...(data.matches.canonical_compared_with ? { canonical_compared_with: data.matches.canonical_compared_with } : {}) },
    post_id: data.post_id ?? null,
    ...(plain(room) ? { live_checks_left_this_hour: integer(room.remaining) ?? null } : {}) };
}

// list_changes: the same site rows as get_outcomes, cut to "what changed where and when".
export function changesView(data, present) {
  const shown = present(data);
  if (!shown) return null;
  return { items: shown.items.map(i => ({ post_id: i.post_id, page_title: i.page_title, change_set_id: i.change_set_id, changed: i.changed,
    fields: i.fields, changed_at: i.changed_at, undone_at: i.rolled_back_at, result_in_search: i.status })),
    total: shown.total, next_cursor: shown.next_cursor, site_timezone: shown.site_timezone ?? null, ...(shown.times_note ? { times_note: shown.times_note } : {}),
    coverage: 'Only changes applied through a TamRank change plan approved in chat are listed. Edits made directly in WordPress are not.' };
}
