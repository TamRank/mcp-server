/** Golf 2b hosted: list_changes, live_check and targeted index checks. Synthetic VPS seam only. */
import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

const set = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const check = 'idx_' + 'c'.repeat(24);
const value = out => JSON.parse(out.content[0].text);
const scopes = ['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write'];
const caps = (extra = {}) => { const c = fullCaps(); c.reads.get_outcomes = { available: true };
  return { ...c, live_check: { contract_version: 1, available: true }, index_checks: { contract_version: 1, available: true }, ...extra }; };
const wpError = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const rows = { contract_version: 2, items: [{ post_id: 7, post_title: 'Pricing', summary: 'Meta title', changes: [{ field: 'meta_title' }],
  effect_status: 'pending', change_set_id: set, monitor_after: '2026-10-31', created_at: '2026-10-14 10:00:00', outcome: {} }],
  pagination: { page: 1, per_page: 25, total: 3, total_pages: 2, has_more: true } };
const live = { contract_version: 1, url: 'https://site.example.invalid/pricing/', checked_at: '2026-10-14T12:00:00+00:00', freshness: 'live',
  status: 200, final_url: 'https://site.example.invalid/pricing/', redirects: [], stopped: null,
  live: { title: 'Pricing', meta_description: null, meta_robots: null, canonical: 'https://site.example.invalid/pricing/', x_robots_tag: null },
  stored: { title: 'Pricing', meta_description: null, canonical: null, noindex: false },
  matches: { title: true, meta_description: null, canonical: true, canonical_compared_with: 'permalink', noindex: true },
  limits: { live_checks: { limit: 60, used: 3, remaining: 57, window: 'rolling_hour' } }, post_id: 7 };
const started = { contract_version: 1, check_id: check, status: 'running', urls: 2, sent_to_google: 1, answered_from_recent_cache: 1,
  results: [{ url: 'https://site.example.invalid/a/', post_id: 7, index_status: 'indexed', checked_at: '2026-10-14T11:00:00Z' },
    { url: 'https://site.example.invalid/b/', post_id: 8, index_status: null, checked_at: null }],
  quota: { limit: 1000, used: 1, remaining: 999, charged: 1, resets_at: '2026-10-15T07:00:00+00:00' }, note: 'Google is checking.' };

// Listing follows the site: nothing advertised, nothing listed and nothing sent.
{
  const f = await connect({ responses: [] });
  try {
    const names = (await f.client.listTools()).tools.map(t => t.name);
    for (const name of ['list_changes', 'live_check', 'start_scan', 'get_scan_status']) assert.equal(names.includes(name), false, name);
    assert.doesNotMatch(f.client.getInstructions(), /index checks/);
    const out = await f.client.callTool({ name: 'live_check', arguments: { post_id: 7 } });
    assert.equal(out.isError, true); assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
// Advertised: listed, with plain descriptions and the scopes each needs.
{
  const f = await connect({ responses: [] }, { capabilities: caps(), scopes, offeredScopes: [...scopes, 'scans:execute'] });
  try {
    const tools = new Map((await f.client.listTools()).tools.map(t => [t.name, t]));
    assert.match(tools.get('list_changes').description, /every user connected to this site/);
    assert.match(tools.get('list_changes').description, /edits made directly in WordPress are not/);
    assert.equal(tools.get('list_changes').annotations.readOnlyHint, true);
    assert.deepEqual(tools.get('live_check')._meta.securitySchemes, [{ type: 'oauth2', scopes: ['site:read'] }]);
    assert.equal(tools.get('start_scan').annotations.readOnlyHint, false);
    assert.equal(tools.get('start_scan').annotations.destructiveHint, false);
    assert.equal(tools.get('start_scan').annotations.idempotentHint, undefined);
    assert.deepEqual(Object.keys(tools.get('start_scan').inputSchema.properties).sort(), ['type', 'urls']);
    // A grant without scans:execute is asked for it, keeping what it has.
    assert.deepEqual(tools.get('start_scan')._meta.securitySchemes, [{ type: 'oauth2', scopes: [...scopes, 'scans:execute'] }]);
    assert.match(f.client.getInstructions(), /except index checks \(start_scan type index, only when asked\)/);
  } finally { await f.close(); }
}
// list_changes: the outcomes rows, per page and since a date, newest first, cut to what changed.
{
  const f = await connect({ responses: [{ body: rows }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'list_changes', arguments: { url: 'https://site.example.invalid/pricing/', since: '2026-10-01', limit: 1 } }));
    const url = new URL(f.stub.calls[0].url);
    assert.equal(url.pathname, '/wp-json/tamrank/v2/outcomes'); assert.equal(f.stub.calls[0].method, 'GET');
    assert.equal(url.searchParams.get('url'), 'https://site.example.invalid/pricing/');
    assert.equal(url.searchParams.get('created_from'), '2026-10-01 00:00:00'); assert.equal(url.searchParams.get('per_page'), '1');
    assert.deepEqual(out.items[0], { post_id: 7, page_title: 'Pricing', change_set_id: set, changed: 'Meta title', fields: ['meta_title'],
      changed_at: '2026-10-14T08:00:00Z', undone_at: null, result_in_search: 'pending' });
    assert.equal(out.next_cursor, '2'); assert.equal(out.total, 3); assert.match(out.coverage, /Edits made directly in WordPress are not/);
    assert.deepEqual(f.stub.events.find(e => e.type === 'authorize').toolName, 'list_changes');
  } finally { await f.close(); }
}
// get_outcomes passes post_id on to the site.
{
  const f = await connect({ responses: [{ body: rows }] }, { capabilities: caps() });
  try {
    await f.client.callTool({ name: 'get_outcomes', arguments: { post_id: 7 } });
    assert.equal(new URL(f.stub.calls[0].url).searchParams.get('post_id'), '7');
  } finally { await f.close(); }
}
// live_check: the site fetches; the answer (contract 1) is shown with the room left this hour.
{
  const f = await connect({ responses: [{ body: live }] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'live_check', arguments: { post_id: 7 } }));
    const url = new URL(f.stub.calls[0].url);
    assert.equal(url.pathname, '/wp-json/tamrank/v2/live-check'); assert.equal(url.searchParams.get('post_id'), '7');
    assert.equal(out.status, 200); assert.equal(out.live_checks_left_this_hour, 57); assert.equal(out.limits, undefined);
    assert.equal(out.contract_version, undefined);
  } finally { await f.close(); }
  const empty = await connect({ responses: [] }, { capabilities: caps() });
  try {
    const out = await empty.client.callTool({ name: 'live_check', arguments: {} });
    assert.equal(value(out).message, 'live_check needs url or post_id; nothing was sent.'); assert.equal(empty.stub.calls.length, 0);
  } finally { await empty.close(); }
}
// The hourly limit and a refused host: the site's decision, said in plain words, no retry.
{
  const f = await connect({ responses: [wpError(429, 'live_check_limit_reached', 'Live checks used.', { retry_at: '2026-10-14T13:05:00+00:00', retry_after_seconds: 300, limit: 60 }),
    wpError(400, 'live_check_host_refused', 'Only addresses of this site can be checked. Nothing was fetched.')] }, { capabilities: caps() });
  try {
    const limited = value(await f.client.callTool({ name: 'live_check', arguments: { url: 'https://site.example.invalid/a/' } }));
    assert.equal(limited.code, 'live_check_limit_reached');
    assert.equal(limited.message, 'Live checks by an AI assistant are used up for this hour on this site (60 per hour). Nothing was fetched. There is room again from 2026-10-14T13:05:00+00:00.');
    assert.equal(limited.automatic_retry, false); assert.equal(limited.retry_after_seconds, 300);
    const refused = value(await f.client.callTool({ name: 'live_check', arguments: { url: 'https://other.example/a/' } }));
    assert.equal(refused.code, 'live_check_host_refused'); assert.match(refused.message, /Only addresses of this site/);
  } finally { await f.close(); }
}
// start_scan / get_scan_status: an index check of own URLs, POSTed as exactly {urls}.
{
  const f = await connect({ responses: [{ body: started }, { body: { ...started, status: 'completed', quota: undefined, sent_to_google: undefined,
    answered_from_recent_cache: undefined } }] }, { capabilities: caps(), scopes: [...scopes, 'scans:execute'], offeredScopes: [...scopes, 'scans:execute'] });
  try {
    const urls = ['https://site.example.invalid/a/', 'https://site.example.invalid/b/'];
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls } }));
    assert.equal(f.stub.calls[0].method, 'POST'); assert.equal(new URL(f.stub.calls[0].url).pathname, '/wp-json/tamrank/v2/index-checks');
    assert.deepEqual(JSON.parse(Buffer.from(f.stub.calls[0].bodyBytes).toString()), { urls });
    assert.equal(out.check_id, check); assert.equal(out.status, 'running'); assert.equal(out.todays_room.remaining, 999);
    assert.match(out.explanation, /same check_id/);
    const done = value(await f.client.callTool({ name: 'get_scan_status', arguments: { type: 'index', check_id: check } }));
    assert.equal(new URL(f.stub.calls[1].url).pathname, `/wp-json/tamrank/v2/index-checks/${check}`);
    assert.equal(done.status, 'completed'); assert.equal(done.results[0].index_status, 'indexed');
    const tooMany = await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls: Array.from({ length: 51 }, (_, i) => `https://site.example.invalid/${i}/`) } });
    assert.equal(tooMany.isError, true); assert.equal(f.stub.calls.length, 2, '51 URLs: nothing sent');
    const pagespeed = await f.client.callTool({ name: 'start_scan', arguments: { type: 'pagespeed', urls } });
    assert.equal(pagespeed.isError, true); assert.equal(f.stub.calls.length, 2, 'only index checks here');
  } finally { await f.close(); }
}
// Refusals of a start are the site's decision before any work: no "may have started".
{
  const f = await connect({ responses: [
    wpError(429, 'index_check_daily_limit_reached', 'Used.', { limit: 1000, used: 1000, remaining: 0, requested: 2, retry_at: '2026-10-15T07:00:00+00:00', retry_after_seconds: 3600 }),
    wpError(409, 'gsc_property_mismatch', 'The connected Search Console property does not match this site, so a check would only return errors. Reconnect the right property first.'),
    { status: 500, body: '<html>' }] }, { capabilities: caps(), scopes: [...scopes, 'scans:execute'] });
  try {
    const urls = ['https://site.example.invalid/a/'];
    const daily = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls } }));
    assert.equal(daily.code, 'index_check_daily_limit_reached');
    assert.equal(daily.message, 'Index checks started by an AI assistant are used up for today on this site (1000 per day). Nothing was checked. There is room again from 2026-10-15T07:00:00+00:00. The site\'s own index scan is not affected.');
    const mismatch = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls } }));
    assert.equal(mismatch.code, 'gsc_property_mismatch');
    assert.equal(mismatch.message, 'The website turned this down. The connected Search Console property does not match this site, so a check would only return errors. Reconnect the right property first.');
    const unclear = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls } }));
    assert.match(unclear.message, /may or may not have started/); assert.equal(unclear.automatic_retry, false);
  } finally { await f.close(); }
}
// The site advertises index checks as unavailable for this token: refused here, nothing sent.
{
  const f = await connect({ responses: [] }, { capabilities: caps({ index_checks: { contract_version: 1, available: false } }) });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls: ['https://site.example.invalid/a/'] } }));
    assert.equal(out.code, 'workflow_operation_unavailable'); assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
// Greptile PR #20 P1: an accepted start with an unreadable answer stays uncertain (outcome_unknown wins over the status).
{
  const f = await connect({ responses: [{ body: { contract_version: 2, check_id: check, status: 'running', results: [] } }] },
    { capabilities: caps(), scopes: [...scopes, 'scans:execute'] });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls: ['https://site.example.invalid/a/'] } }));
    assert.match(out.message, /may or may not have started/); assert.doesNotMatch(out.message, /turned this down/);
  } finally { await f.close(); }
}
// Greptile PR #20 P2: mcp_limit_unavailable on a start is a refusal with its reason (one shared list), not "may have started".
{
  const f = await connect({ responses: [wpError(503, 'mcp_limit_unavailable', 'The limit counter could not be read, so nothing was started.')] },
    { capabilities: caps(), scopes: [...scopes, 'scans:execute'] });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls: ['https://site.example.invalid/a/'] } }));
    assert.equal(out.code, 'mcp_limit_unavailable'); assert.match(out.message, /^The website turned this down\. The limit counter/);
  } finally { await f.close(); }
}
// Greptile PR #20 P2: a malformed live answer is never shown as a live check.
{
  const bad = [{ ...live, live: 5 }, { ...live, live: null }, { ...live, redirects: [5] }, { ...live, status: '200' },
    { ...live, stopped: 'exploded' }, { ...live, live: { ...live.live, title: 7 } }, { ...live, matches: { ...live.matches, title: 'yes' } }];
  const f = await connect({ responses: bad.map(body => ({ body })) }, { capabilities: caps() });
  try {
    for (const body of bad) {
      const out = await f.client.callTool({ name: 'live_check', arguments: { post_id: 7 } });
      assert.equal(out.isError, true, JSON.stringify(body).slice(0, 120));
    }
  } finally { await f.close(); }
  const stopped = await connect({ responses: [{ body: { ...live, live: null, stored: null, status: null, stopped: 'timeout', stopped_reason: 'No answer within 5 seconds.', extra: 'x' } }] }, { capabilities: caps() });
  try {
    const out = value(await stopped.client.callTool({ name: 'live_check', arguments: { post_id: 7 } }));
    assert.equal(out.stopped, 'timeout'); assert.equal(out.live, null); assert.equal(out.extra, undefined, 'only documented fields');
  } finally { await stopped.close(); }
}
// Greptile PR #20 P1 (second round): a grant without scans:execute gets the upgrade challenge, not a bare refusal.
{
  const meta = 'https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp';
  const challenge = `Bearer resource_metadata="${meta}", scope="${[...scopes, 'scans:execute'].join(' ')}", error="insufficient_scope", error_description="Additional permission required"`;
  const f = await connect({ responses: [], decisions: { start_scan: { ok: false, code: 'insufficient_scope', message: 'This needs permission to start index checks.',
    retryable: false, wwwAuthenticate: challenge } } }, { capabilities: caps(), scopes, offeredScopes: [...scopes, 'scans:execute'], resourceMetadataUrl: meta });
  try {
    const out = await f.client.callTool({ name: 'start_scan', arguments: { type: 'index', urls: ['https://site.example.invalid/a/'] } });
    assert.equal(value(out).code, 'insufficient_scope'); assert.deepEqual(out._meta?.['mcp/www_authenticate'], [challenge]);
    assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
console.log('PASS: hosted list_changes, live_check and index checks: listed when advertised, exact routes, plain limit messages, start refusals not uncertain.');
