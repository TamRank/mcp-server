/** Golf 2b on the local bridge: list_changes, live_check and index checks; inert registry and a stub transport, no WordPress. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerWorkflowTools } from '../src/workflow-tools.js';
import { buildWorkflowServer } from '../src/workflow-server.js';
import { WorkflowClient } from '../src/workflow-rest.js';
import { clampToToolProfile } from '../src/workflow-profile.js';
import { indexCheckView } from '../src/live-checks.js';

const parse = out => JSON.parse(out.content[0].text);
const check = 'idx_' + 'd'.repeat(24);
let calls = [], reply = null, failure = null;
// The site's zone comes from the outcome-report summary, once per session (list_changes shows UTC with Z).
const fake = { get: async (path, query) => { if (path === '/reports/outcomes/summary') return { contract_version: 2, site_timezone: 'Europe/Amsterdam' };
  calls.push({ method: 'GET', path, query }); if (failure) throw failure; return structuredClone(reply); },
  post: async (path, body) => { calls.push({ method: 'POST', path, body }); if (failure) throw failure; return structuredClone(reply); } };
const registry = (capabilities, profile = 'core', extra = {}) => { const tools = new Map();
  registerWorkflowTools({ registerTool: (n, c, h) => tools.set(n, { c, h }) }, fake, { profile, capabilities, ...extra }); return tools; };

// Core: list_changes and live_check are reads; start_scan is not in a plain core profile.
{
  const tools = registry({ reads: { get_outcomes: { available: true } }, live_check: { available: true } });
  assert.equal(tools.get('list_changes').c.annotations.readOnlyHint, true);
  assert.equal(tools.get('live_check').c.annotations.readOnlyHint, true);
  assert.equal(tools.has('start_scan'), false);
  reply = { contract_version: 2, items: [], pagination: { page: 1, per_page: 25, total: 0, total_pages: 0, has_more: false } };
  const out = parse(await tools.get('list_changes').h({ post_id: 7, since: '2026-10-01' }));
  assert.deepEqual(calls.pop(), { method: 'GET', path: '/outcomes', query: { post_id: 7, created_from: '2026-10-01 00:00:00' } });
  assert.deepEqual(out.items, []); assert.equal(out.next_cursor, null); assert.match(out.coverage, /directly in WordPress/);
  // An explicit false from the site refuses locally; nothing is sent.
  const off = registry({ reads: { get_outcomes: { available: false } }, live_check: { available: false } });
  assert.equal((await off.get('list_changes').h({})).isError, true); assert.equal((await off.get('live_check').h({ post_id: 1 })).isError, true);
  assert.equal(calls.length, 0);
}
// Clamped stdio (workflow-v2-1): the golf 2b blocks survive the clamp; index checks are listed only when offered.
{
  const raw = { contract_version: 2, full_v2_compatible: false, mcp_bridge_compatibility: 'workflow-v2-1',
    reads: { get_capabilities: { available: true }, get_outcomes: { available: true } },
    live_check: { contract_version: 1, available: true, scope: 'site:read', hosts: 'this_site_only', limits: { per_hour: 60 } },
    index_checks: { contract_version: 1, available: true, scope: 'scans:execute', limits: { max_urls_per_request: 50 } },
    scan_limits: { pagespeed_per_url_per_day: 20 }, scan_proposals: { available: true } };
  const clamped = clampToToolProfile(raw);
  assert.deepEqual(clamped.live_check, { contract_version: 1, available: true, limits: { per_hour: 60 } });
  assert.equal(clamped.index_checks.available, true); assert.equal(clamped.scan_proposals, undefined);
  const list = async caps => { const server = buildWorkflowServer(fake, { profile: 'core', capabilities: caps, profileClamp: true, preflight: { ok: true } });
    const client = new Client({ name: 'golf2b', version: '1' }); const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try { return { names: (await client.listTools()).tools.map(t => t.name), instructions: client.getInstructions() }; } finally { await client.close(); } };
  const on = await list(clamped);
  for (const name of ['list_changes', 'live_check', 'start_scan', 'get_scan_status']) assert.ok(on.names.includes(name), name);
  assert.match(on.instructions, /except index checks/);
  const off = await list(clampToToolProfile({ ...raw, index_checks: { contract_version: 1, available: false } }));
  assert.equal(off.names.includes('start_scan'), false); assert.doesNotMatch(off.instructions, /except index checks/);
}
// Specialist: start_scan takes urls for type index and posts exactly {urls}; get_scan_status reads a check_id.
{
  const tools = registry({ index_checks: { available: true } }, 'specialist');
  reply = { contract_version: 1, check_id: check, status: 'completed', urls: 1, sent_to_google: 0, answered_from_recent_cache: 1,
    results: [{ url: 'https://example.test/a/', post_id: 3, index_status: 'indexed', checked_at: '2026-10-14T10:00:00Z' }] };
  const started = parse(await tools.get('start_scan').h({ type: 'index', urls: ['https://example.test/a/'] }));
  assert.deepEqual(calls.pop(), { method: 'POST', path: '/index-checks', body: { urls: ['https://example.test/a/'] } });
  assert.equal(started.status, 'completed'); assert.match(started.explanation, /Done/);
  await tools.get('get_scan_status').h({ type: 'index', check_id: check });
  assert.deepEqual(calls.pop(), { method: 'GET', path: '/index-checks/' + check, query: undefined });
  for (const args of [{ type: 'pagespeed', urls: ['https://example.test/a/'] }, { type: 'index', urls: ['https://example.test/a/'], mode: 'preview' }])
    assert.equal((await tools.get('start_scan').h(args)).isError, true, JSON.stringify(args));
  assert.equal((await tools.get('get_scan_status').h({ type: 'pagespeed', check_id: check })).isError, true);
  assert.equal(calls.length, 0, 'invalid shapes send nothing');
  // Not offered by the site: refused without a request.
  const none = registry({ index_checks: { available: false } }, 'specialist');
  assert.equal(parse(await none.get('start_scan').h({ type: 'index', urls: ['https://example.test/a/'] })).code, 'workflow_operation_unavailable');
  assert.equal(calls.length, 0);
}
// Greptile PR #20 P2: specialist start_scan (it can start an index check) never claims idempotence.
assert.equal(registry({}, 'specialist').get('start_scan').c.annotations.idempotentHint, undefined);
// Greptile PR #20 P1 (stdio): the site's own refusal code is a refusal; an unreadable accepted answer stays uncertain.
{
  const tools = registry({ index_checks: { available: true } }, 'specialist');
  const urls = ['https://example.test/a/'];
  failure = Object.assign(new Error('Could not be started at TamRank right now.'), { status: 502, code: 'index_check_backend_unavailable', data: undefined });
  assert.match(parse(await tools.get('start_scan').h({ type: 'index', urls })).message, /^The website turned this down/);
  failure = Object.assign(new Error('The TamRank plugin on this website does not match this connection.'), { status: 409, code: 'workflow_upgrade_required', data: undefined });
  assert.match(parse(await tools.get('start_scan').h({ type: 'index', urls })).message, /may or may not have started/);
  failure = null; calls = [];
}
// The real stdio client: contract 1 on the golf 2 routes, and limit details survive for a plain message.
{
  const answers = [];
  const transport = { request: async ({ method, url }) => { const next = answers.shift(); calls.push({ method, url });
    return { status: next.status, headers: {}, bodyBytes: new TextEncoder().encode(JSON.stringify(next.body)) }; } };
  const client = new WorkflowClient({ rest_base_url: 'http://localhost:8080/wp-json/tamrank/v2', transport });
  const tools = registry({ live_check: { available: true } }, 'core', {});
  answers.push({ status: 200, body: { contract_version: 1, url: 'http://localhost:8080/a/', status: 200, redirects: [], stopped: null,
    live: { title: 'A' }, stored: null, matches: {}, limits: { live_checks: { limit: 60, used: 1, remaining: 59 } }, post_id: 3 } });
  const shown = await client.get('/live-check', { post_id: 3 });
  assert.equal(shown.contract_version, 1);
  answers.push({ status: 200, body: { contract_version: 1, items: [] } });
  await assert.rejects(client.get('/outcomes'), e => e.code === 'workflow_upgrade_required', 'contract 1 only on the golf 2 routes');
  answers.push({ status: 429, body: { code: 'live_check_limit_reached', message: 'Used.', data: { status: 429, limit: 60, retry_at: '2026-10-14T13:00:00+00:00', retry_after_seconds: 120, secret: 'x' } } });
  failure = await client.get('/live-check', { post_id: 3 }).catch(e => e);
  assert.deepEqual(failure.data, { retry_after_seconds: 120, limit: 60, retry_at: '2026-10-14T13:00:00+00:00' });
  const out = parse(await tools.get('live_check').h({ post_id: 3 }));
  assert.equal(out.message, 'Live checks by an AI assistant are used up for this hour on this site (60 per hour). Nothing was fetched. There is room again from 2026-10-14T13:00:00+00:00.');
  assert.equal(out.secret, undefined); failure = null;
}
// Testronde 15 Oct 2026: a cached answer was shown as a fresh check. source and from_cache pass through, the
// explanation says what checked_at means, and a result without a source is never called fresh.
{
  const base = { contract_version: 1, check_id: check, status: 'completed', urls: 3, sent_to_google: 1, answered_from_recent_cache: 2 };
  const view = indexCheckView({ ...base, results: [
    { url: 'https://example.test/a/', post_id: 3, index_status: 'indexed', checked_at: '2026-10-14T09:22:05Z', source: 'url_inspection', from_cache: true },
    { url: 'https://example.test/b/', post_id: 4, index_status: 'indexed', checked_at: '2026-10-15T09:45:30Z', source: 'url_inspection', from_cache: false },
    { url: 'https://example.test/c/', post_id: 5, index_status: 'indexed', checked_at: '2026-10-13T06:00:00Z', source: 'search_console_impressions', from_cache: false }] });
  assert.deepEqual(view.results.map(r => [r.checked_at, r.source, r.from_cache]), [
    ['2026-10-14T09:22:05Z', 'url_inspection', true], ['2026-10-15T09:45:30Z', 'url_inspection', false],
    ['2026-10-13T06:00:00Z', 'search_console_impressions', false]]);
  assert.match(view.explanation, /checked_at is when Google gave that answer, not when this check was asked/);
  assert.match(view.explanation, /from_cache true was answered from an earlier check \(at most 48 hours old\): no new request went to Google/);
  assert.match(view.explanation, /search_console_impressions is marked indexed because it had impressions in Search Console; Google was not asked/);
  assert.doesNotMatch(view.explanation, /did not say where its status came from/);
  // An older PRO (0.9.48) sends neither: both stay null and the explanation refuses to call the time fresh.
  const old = indexCheckView({ ...base, results: [{ url: 'https://example.test/a/', post_id: 3, index_status: 'indexed', checked_at: '2026-10-15T09:45:04Z' }] });
  assert.deepEqual(old.results[0], { url: 'https://example.test/a/', post_id: 3, index_status: 'indexed', checked_at: '2026-10-15T09:45:04Z', source: null, from_cache: null, inspected_url: null, property: null });
  assert.match(old.explanation, /did not say where its status came from: its checked_at may be when the site saved it\. Do not present it as a fresh check\./);
  assert.doesNotMatch(old.explanation, /from_cache true/);
  assert.doesNotMatch(old.explanation, /inspected_url/);
  // Which URL and property Google answered: passed through per page, on a cache hit the values of the original inspection.
  const asked = indexCheckView({ ...base, results: [
    { url: 'https://example.test/a/', post_id: 3, index_status: 'indexed', checked_at: '2026-10-14T09:22:05Z', source: 'url_inspection', from_cache: true,
      inspected_url: 'https://www.example.test/a/', property: 'sc-domain:example.test' },
    { url: 'http://example.test/b', post_id: 4, index_status: 'crawled', checked_at: '2026-10-15T09:45:30Z', source: 'url_inspection', from_cache: false,
      inspected_url: 'http://example.test/b', property: 'https://example.test/' }] });
  assert.deepEqual(asked.results.map(r => [r.inspected_url, r.property, r.from_cache]), [
    ['https://www.example.test/a/', 'sc-domain:example.test', true], ['http://example.test/b', 'https://example.test/', false]]);
  assert.match(asked.explanation, /inspected_url is the exact URL Google was asked about and property the Search Console property it was asked under/);
  // Unknown values are not passed on as if the site had said them.
  const odd = indexCheckView({ ...base, results: [{ url: 'https://example.test/a/', index_status: 'indexed', checked_at: null, source: 'guess', from_cache: 'yes' }] });
  assert.equal(odd.results[0].source, null); assert.equal(odd.results[0].from_cache, null);
  const oddAsked = indexCheckView({ ...base, results: [{ url: 'https://example.test/a/', index_status: 'indexed', checked_at: null, inspected_url: 7, property: 'x'.repeat(513) },
    { url: 'https://example.test/b/', index_status: 'indexed', checked_at: null, inspected_url: '', property: null }] });
  assert.deepEqual(oddAsked.results.map(r => [r.inspected_url, r.property]), [[null, null], [null, null]]);
  // A still-running page without a status gets no provenance note.
  const running = indexCheckView({ ...base, status: 'running', results: [{ url: 'https://example.test/a/', index_status: null, checked_at: null }] });
  assert.equal(running.explanation, 'Google is still checking these pages. Read the status again in a minute or two with the same check_id.');
}
console.log('PASS: local list_changes, live_check and index checks: exact routes and shapes, clamp keeps only the golf 2b blocks, contract 1 only on its routes, plain limit messages, index provenance (source, from_cache, checked_at meaning, inspected_url, property).');
