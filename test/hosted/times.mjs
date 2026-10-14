/** Testronde 14 Oct 2026: every time in get_outcomes and list_changes is ISO-8601 UTC with Z, and get_outcomes
 * names the page URL. PRO keeps created_at/measured_at on the site's clock and rolled_back_at in UTC. */
import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';
import { naiveTimes } from './naive-times.mjs';
import { registerWorkflowTools } from '../../src/workflow-tools.js';
import { siteZone, siteSqlToIso, utcSqlToIso } from '../../src/site-time.js';
import { workflowDefinitions } from '../../src/workflow-tools.js';

const set = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const value = out => JSON.parse(out.content[0].text);
const caps = () => { const c = fullCaps(); c.reads.get_outcomes = { available: true }; return c; };
const row = (extra = {}) => ({ post_id: 7, post_title: 'Pricing', summary: 'Meta title', changes: [{ field: 'meta_title' }], change_set_id: set,
  effect_status: 'pending', monitor_after: '2026-10-31', created_at: '2026-10-14 10:00:00', outcome: { state: 'pending' }, ...extra });
const reply = items => ({ contract_version: 2, items, pagination: { page: 1, per_page: 25, total: items.length, total_pages: 1, has_more: false } });
async function call(tool, items, options = {}, args = {}) {
  const f = await connect({ responses: [{ body: reply(items) }], ...options }, { capabilities: caps() });
  try { return { out: value(await f.client.callTool({ name: tool, arguments: args })), stub: f.stub }; } finally { await f.close(); }
}

// Conversion: zones WordPress reports, both sides of a clock change, garbage stays null.
{
  const ams = siteZone('Europe/Amsterdam');
  assert.equal(siteSqlToIso('2026-10-14 10:00:00', ams), '2026-10-14T08:00:00Z', 'summer time');
  assert.equal(siteSqlToIso('2026-12-01 10:00:00', ams), '2026-12-01T09:00:00Z', 'winter time');
  assert.equal(siteSqlToIso('2026-10-25 02:30:00', ams), '2026-10-25T01:30:00Z', 'repeated hour: the later offset, like PHP');
  const ny = siteZone('America/New_York');
  assert.equal(siteSqlToIso('2026-11-01 01:30:00', ny), '2026-11-01T06:30:00Z', 'repeated hour west of UTC: the later one too');
  assert.equal(siteSqlToIso('2026-03-08 02:30:00', ny), '2026-03-08T07:30:00Z', 'skipped hour: moved forward, like PHP');
  assert.equal(siteSqlToIso('2026-03-29 02:30:00', ams), '2026-03-29T01:30:00Z', 'skipped hour east of UTC');
  assert.equal(siteSqlToIso('2026-07-01 12:00:00', ny), '2026-07-01T16:00:00Z');
  assert.equal(siteSqlToIso('2026-10-14 10:00:00', siteZone('+05:30')), '2026-10-14T04:30:00Z');
  assert.equal(siteSqlToIso('2026-10-14 10:00:00', siteZone('UTC')), '2026-10-14T10:00:00Z');
  assert.equal(siteSqlToIso('2026-10-14 10:00:00', siteZone('-03:00')), '2026-10-14T13:00:00Z');
  for (const bad of [null, '', 'Mars/Olympus', '+25:00', 'x'.repeat(65), 7]) assert.equal(siteZone(bad), null, String(bad));
  assert.equal(siteSqlToIso('2026-10-14 10:00:00', null), null);
  for (const bad of ['2026-02-30 10:00:00', '2026-10-14T10:00:00', '0000-00-00 00:00:00', '']) assert.equal(siteSqlToIso(bad, ams), null, bad);
  assert.equal(utcSqlToIso('2026-10-14 10:00:00'), '2026-10-14T10:00:00Z');
  // A manual UTC offset (empty timezone_string): wp_timezone_string() gives '+00:00', as on tammarketing.nl (14 Oct 2026).
  assert.equal(siteSqlToIso('2026-10-14 10:00:00', siteZone('+00:00')), '2026-10-14T10:00:00Z');
}
// get_outcomes: site-clock and UTC columns both leave in UTC with Z; a time already zoned passes on in UTC.
{
  const { out, stub } = await call('get_outcomes', [
    row({ effect_status: 'rolled_back', measured_at: '2026-10-20 09:15:00', rolled_back_at: '2026-10-21 07:00:00' }),
    row({ created_at: '2026-10-14T10:00:00+02:00' })]);
  assert.equal(out.items[0].changed_at, '2026-10-14T08:00:00Z');
  assert.equal(out.items[0].measured_at, '2026-10-20T07:15:00Z');
  assert.equal(out.items[0].rolled_back_at, '2026-10-21T07:00:00Z', 'rolled_back_at is UTC already');
  assert.equal(out.items[1].changed_at, '2026-10-14T08:00:00Z');
  assert.deepEqual(naiveTimes(out), []);
  assert.equal(stub.zoneCalls.length, 1);
  assert.deepEqual([...new URL(stub.zoneCalls[0].url).searchParams.keys()].sort(), ['from', 'through']);
  // Review 14 Oct: the zone travels along, so the model can put a Z time back on the site's clock.
  assert.equal(out.site_timezone, 'Europe/Amsterdam');
  const changes = await call('list_changes', [row()]);
  assert.equal(changes.out.site_timezone, 'Europe/Amsterdam'); assert.equal(changes.out.items[0].changed_at, '2026-10-14T08:00:00Z');
}
// A manual offset: the zone is named as WordPress reports it, times still leave with Z.
{
  const { out } = await call('list_changes', [row()], { siteTimezone: '+00:00' });
  assert.equal(out.site_timezone, '+00:00'); assert.equal(out.items[0].changed_at, '2026-10-14T10:00:00Z'); assert.equal(out.times_note, undefined);
}
// Review 14 Oct: since is a date on the site's own calendar, sent as is, with or without a known zone; the
// descriptions say so. (A UTC day would miss 00:00-02:00 Amsterdam time, and without a zone mean something else.)
{
  for (const tool of ['get_outcomes', 'list_changes']) {
    const { stub } = await call(tool, [row()], {}, { since: '2026-10-01' });
    assert.equal(new URL(stub.calls[0].url).searchParams.get('created_from'), '2026-10-01 00:00:00', tool);
  }
  const f = await connect({}, { capabilities: caps() });
  try {
    const listed = new Map((await f.client.listTools()).tools.map(t => [t.name, t.description]));
    for (const tool of ['get_outcomes', 'list_changes']) assert.match(listed.get(tool), /since \(a date on the site's own calendar/, tool);
  } finally { await f.close(); }
  for (const tool of ['get_outcomes', 'list_changes']) assert.match(workflowDefinitions()[tool].description, /since \(site date\)/, tool);
}
// Without a readable zone: site-clock times are left out with a note, never guessed; since stays the site's day.
{
  const { out, stub } = await call('get_outcomes', [row({ rolled_back_at: '2026-10-21 07:00:00' })], { siteTimezone: null }, { since: '2026-10-01' });
  assert.equal(out.items[0].changed_at, null); assert.equal(out.items[0].rolled_back_at, '2026-10-21T07:00:00Z');
  assert.match(out.times_note, /time zone could not be read/); assert.equal(out.site_timezone, null);
  assert.equal(new URL(stub.calls[0].url).searchParams.get('created_from'), '2026-10-01 00:00:00');
  const changes = await call('list_changes', [row()], { siteTimezone: null });
  assert.equal(changes.out.items[0].changed_at, null); assert.match(changes.out.times_note, /time zone could not be read/);
}
// The zone is read once per session, also across tools.
{
  const f = await connect({ responses: [{ body: reply([row()]) }, { body: reply([row()]) }] }, { capabilities: caps() });
  try {
    await f.client.callTool({ name: 'get_outcomes', arguments: {} }); await f.client.callTool({ name: 'list_changes', arguments: {} });
    assert.equal(f.stub.zoneCalls.length, 1); assert.equal(f.stub.calls.length, 2);
  } finally { await f.close(); }
}
// Parallel first calls share one zone read (the hosted factory runs calls in turn; the local bridge need not).
{
  let zoneReads = 0;
  const fake = { get: async path => { if (path === '/reports/outcomes/summary') { zoneReads++; await new Promise(r => setTimeout(r, 20));
    return { site_timezone: 'Europe/Amsterdam' }; } return reply([row()]); }, post: async () => { throw new Error('no writes'); } };
  const tools = new Map();
  registerWorkflowTools({ registerTool: (n, c, h) => tools.set(n, { c, h }) }, fake, { profile: 'core', capabilities: { reads: { get_outcomes: { available: true } } } });
  const outs = await Promise.all([tools.get('get_outcomes').h({}), tools.get('list_changes').h({})]);
  assert.equal(zoneReads, 1, 'parallel: one zone read');
  for (const o of outs) assert.equal(JSON.parse(o.content[0].text).items[0].changed_at, '2026-10-14T08:00:00Z');
}
// Bevinding 2: the page URL, from the row when the site sends it, else from a measurement; never a non-URL.
{
  const { out } = await call('get_outcomes', [
    row({ page_url: 'https://site.example.invalid/pricing/' }),
    row({ effect_status: 'measured', gsc_effect: { page_url: 'https://site.example.invalid/about/' } }),
    row({ page_url: 'javascript:alert(1)' }),
    row()]);
  assert.deepEqual(out.items.map(i => i.page_url), ['https://site.example.invalid/pricing/', 'https://site.example.invalid/about/', null, null]);
}
console.log('times: ok');
