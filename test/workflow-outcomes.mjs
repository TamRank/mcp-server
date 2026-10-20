/** get_outcomes and get_capabilities freshness on the local bridge: inert registry, no WordPress. */
import assert from 'node:assert/strict';
import { registerWorkflowTools } from '../src/workflow-tools.js';

const set = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let calls = [], reply = null, zoneCalls = 0;
// The site's zone comes from the outcome-report summary (read once per session; times leave in UTC with Z).
const fake = { get: async (path, query) => { if (path === '/reports/outcomes/summary') { zoneCalls++; return { contract_version: 2, site_timezone: 'Europe/Amsterdam' }; }
  calls.push({ path, query }); return structuredClone(reply); },
  post: async () => { throw new Error('get_outcomes never writes'); } };
const registry = (capabilities = null) => { const tools = new Map();
  registerWorkflowTools({ registerTool: (n, c, h) => tools.set(n, { c, h }) }, fake, { profile: 'core', capabilities }); return tools; };
const parse = out => JSON.parse(out.content[0].text);
const row = (over = {}) => ({ id: 1, post_id: 7, post_title: 'Pricing', change_type: 'workflow', summary: 'Meta title',
  changes: [{ field: 'meta_title', old: 'Old', new: 'New' }, { field: 'meta_title' }], effect_status: 'pending', gsc_effect: null, gsc_baseline: null,
  action_id: null, change_set_id: set, monitor_after: '2026-10-31', rolled_back_at: null, measured_at: null, created_at: '2026-10-14 10:00:00',
  outcome: { state: 'pending', click_change_percent: null, site_click_change_percent: null, relative_to_site_percent: null, expected_alignment: 'inconclusive' }, ...over });
const page = (items, over = {}) => ({ contract_version: 2, items, pagination: { page: 1, per_page: 25, total: items.length, total_pages: 1, has_more: false, ...over } });

const tools = registry();
const tool = tools.get('get_outcomes');
assert.equal(tool.c.annotations.readOnlyHint, true, 'get_outcomes is a read');
assert.ok(!/workflow|legacy|hosted|specialist/i.test(tool.c.description));

// Filters map onto the site's own query names; since is a whole day on the site's own calendar, also with a known zone.
reply = page([row()]);
await tool.h({ change_set_id: set, status: 'pending', since: '2026-10-01', limit: 10, cursor: '2' });
assert.deepEqual(calls.pop(), { path: '/outcomes', query: { change_set_id: set, status: 'pending', created_from: '2026-10-01 00:00:00', per_page: 10, page: '2' } });
await tool.h({});
assert.deepEqual(calls.pop(), { path: '/outcomes', query: {} });
// One page (golf 2b, PRO filter): post_id or url, passed on unchanged.
await tool.h({ post_id: 7, url: 'https://example.test/a/' });
assert.deepEqual(calls.pop(), { path: '/outcomes', query: { post_id: 7, url: 'https://example.test/a/' } });

// Wrong arguments send nothing.
for (const args of [{ status: 'done' }, { since: '2026-13-01' }, { since: '2026-02-30' }, { since: 'yesterday' }, { cursor: 'abc' }, { cursor: '0' },
  { change_set_id: 'x' }, { post_id: 0 }, { url: 'ftp://x/' }, { limit: 51 }, { execute: true }]) {
  assert.equal((await tool.h(args)).isError, true, JSON.stringify(args)); assert.equal(calls.length, 0, JSON.stringify(args));
}
assert.match(parse(await tool.h({ cursor: 'abc' })).message, /next_cursor/);

// Pending: says when the first result is expected, in plain words.
{
  const out = parse(await tool.h({}));
  const [item] = out.items;
  assert.equal(item.status, 'pending'); assert.equal(item.first_result_expected, '2026-10-31');
  assert.match(item.explanation, /expected around 2026-10-31 \(14 days after the change plus 3 days/);
  assert.deepEqual(item.fields, ['meta_title']); assert.equal(item.before, null); assert.equal(item.changed, 'Meta title');
  assert.equal(out.next_cursor, null); assert.equal(out.total, 1);
}
// Measured: before/after with CTR, the site-wide trend, and no causal claim.
{
  reply = page([row({ effect_status: 'measured', measured_at: '2026-11-01 03:00:00', gsc_effect: { v: 1, window_days: 14, page_url: 'https://site.example.invalid/pricing/',
    before: { start: '2026-09-30', end: '2026-10-13', clicks: 20, impressions: 1000, position: 8.4 },
    after: { start: '2026-10-15', end: '2026-10-28', clicks: 30, impressions: 1200, position: 6.1 } },
    outcome: { state: 'measured', click_change_percent: 50, site_click_change_percent: 5, relative_to_site_percent: 45, expected_alignment: 'aligned' } })],
    { page: 1, total: 30, has_more: true });
  const out = parse(await tool.h({}));
  const [item] = out.items;
  assert.deepEqual(item.before, { from: '2026-09-30', to: '2026-10-13', clicks: 20, impressions: 1000, ctr_percent: 2, average_position: 8.4 });
  assert.deepEqual(item.after, { from: '2026-10-15', to: '2026-10-28', clicks: 30, impressions: 1200, ctr_percent: 2.5, average_position: 6.1 });
  assert.equal(item.click_change_percent, 50); assert.equal(item.relative_to_site_percent, 45); assert.equal(item.measured_at, '2026-11-01T02:00:00Z');
  assert.equal(item.page_url, 'https://site.example.invalid/pricing/'); assert.equal(item.first_result_expected, null);
  assert.match(item.explanation, /not proof/); assert.match(out.next_cursor, /^pc1\.2\.[a-f0-9]{16}$/);
}
// The other states explain themselves; an unknown status is shown as unknown, never as a status the site did not report.
for (const [status, text] of [['low_data', /Too little search traffic/], ['no_gsc', /Search Console was not connected/],
  ['rolled_back', /undone/], ['surprise', /could not tell the measurement status/], [undefined, /could not tell the measurement status/]]) {
  reply = page([row({ effect_status: status, monitor_after: null })]);
  const [item] = parse(await tool.h({})).items;
  assert.match(item.explanation, text, status); assert.equal(item.first_result_expected, null, status);
  if (!['low_data','no_gsc','rolled_back'].includes(status)) assert.equal(item.status, 'unknown', 'an unknown status is not passed off as a known one');
}
// Zero impressions: no CTR invented.
reply = page([row({ effect_status: 'low_data', gsc_effect: { before: { clicks: 0, impressions: 0, position: null }, after: { clicks: 0, impressions: 0, position: null } } })]);
assert.equal(parse(await tool.h({})).items[0].after.ctr_percent, null);
// An answer of the wrong shape is refused, not passed on.
for (const bad of [{ contract_version: 1, items: [], pagination: { page: 1 } }, { contract_version: 2, items: {} , pagination: { page: 1 } }, { contract_version: 2, items: [] }]) {
  reply = bad; const out = await tool.h({});
  assert.equal(out.isError, true); assert.ok(!/outcomes|workflow/i.test(parse(out).message));
}
calls = [];

// A site that explicitly turns the read off is refused locally.
assert.equal((await registry({ reads: { get_outcomes: { available: false } } }).get('get_outcomes').h({})).isError, true);
assert.equal(calls.length, 0);

// get_capabilities read live: as_of is now, the copy is zero seconds old.
reply = { contract_version: 2, reads: {} };
{
  const out = parse(await tools.get('get_capabilities').h({}));
  assert.ok(Math.abs(Date.now() - Date.parse(out.as_of)) < 60000); assert.equal(out.cache_age_s, 0); assert.equal(out.contract_version, 2);
}
console.log('PASS: get_outcomes maps filters, refuses bad arguments and answers, explains every status; get_capabilities says when it was read.');
