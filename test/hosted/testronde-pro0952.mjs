import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

// PRO 0.9.52 (fix/index-herkomst-page-url @ 1d1cd4b) answers the testronde of 15 Oct with new fields.
// TamRank passes each one on unchanged and its description tells the assistant what it means.
const value = out => JSON.parse(out.content[0].text);
const caps = () => ({ ...fullCaps(), specialist_reads: { get_gsc_pages: { available: true, scope: 'selected_gsc_property_analytics_only',
  stored_window_only: true, periods: [28], max_page_size: 50 } } });
const read = async (name, args, body) => {
  const f = await connect({ responses: [{ body: { contract_version: 2, ...body } }] }, { capabilities: caps() });
  try { const out = await f.client.callTool({ name, arguments: args }); assert.equal(out.isError, undefined, JSON.stringify(out)); return value(out); }
  finally { await f.close(); }
};
const descriptions = async () => {
  const f = await connect({ responses: [] }, { capabilities: caps() });
  try { return Object.fromEntries((await f.client.listTools()).tools.map(t => [t.name, t.description])); } finally { await f.close(); }
};
const text = await descriptions();
// Each point reports on its own, so a run against the code before the fix shows which ones fail.
const failed = [];
const point = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed.push(name); console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

// (1) diagnose_page overview: not_applicable + overview_lists_sections_only pass on, and the description says why.
await point('1 diagnose_page overview not_applicable', async () => {
  const body = { diagnosis_status: 'not_applicable', facts: [], sections: ['gsc', 'index', 'metadata'],
    data_quality: { reason: 'overview_lists_sections_only', coverage: 'The overview only lists the evidence sections.' } };
  const out = await read('diagnose_page', { post_id: 416 }, body);
  assert.equal(out.diagnosis_status, 'not_applicable'); assert.deepEqual(out.data_quality, body.data_quality);
  assert.match(text.diagnose_page, /overview only lists the sections/);
  assert.match(text.diagnose_page, /not_applicable/);
});

// (2a) 409 workflow_read_changed: the site's changed_sources reach the assistant (and retryable stays true).
await point('2a 409 changed_sources + retryable', async () => {
  const changed = sources => ({ status: 409, body: { code: 'workflow_read_changed', message: 'The work evidence changed during the read. Restart the read.',
    data: { status: 409, retryable: true, changed_sources: sources } } });
  const f = await connect({ responses: [changed(['posts', 'options']), changed(['options', '404_urls'])] }, { capabilities: caps() });
  try {
    const out = value(await f.client.callTool({ name: 'get_work_queue', arguments: {} }));
    assert.equal(out.code, 'workflow_read_changed'); assert.equal(out.retryable, true);
    // PRO's own row names (class-tamrank-work-source.php stamp_rows), including 404_urls.
    assert.deepEqual(out.changed_sources, ['options', '404_urls'], 'the sources of the last attempt');
  } finally { await f.close(); }
  // Anything that is not a short list of plain names is dropped, never half passed.
  for (const odd of [['Posts Table'], 'posts', [1], Array(20).fill('x')]) {
    const g = await connect({ responses: [changed(odd), changed(odd)] }, { capabilities: caps() });
    try { assert.equal(value(await g.client.callTool({ name: 'get_work_queue', arguments: {} })).changed_sources, undefined, JSON.stringify(odd)); }
    finally { await g.close(); }
  }
});
// (2b) search_pages: q_match per item and query_scope pass on; the description no longer says title text only.
await point('2b search_pages q_match/query_scope', async () => {
  const out = await read('search_pages', { q: 'Content' }, { items: [{ post_id: 1, q_match: 'title' }, { post_id: 2, q_match: 'content' }],
    query_scope: 'title_or_content' });
  assert.equal(out.items[1].q_match, 'content'); assert.equal(out.query_scope, 'title_or_content');
  assert.doesNotMatch(text.search_pages, /by title text/);
  assert.match(text.search_pages, /q_match/);
});
// (2c) get_work_queue: likely_bot_probe per 404 target and likely_bot_probe_count pass on and are explained.
await point('2c get_work_queue likely_bot_probe', async () => {
  const out = await read('get_work_queue', { work_id: 'grp_404', section: 'targets' },
    { targets: [{ url: 'https://site.example.invalid/.vite/manifest.json', likely_bot_probe: true }], likely_bot_probe_count: 1 });
  assert.equal(out.targets[0].likely_bot_probe, true); assert.equal(out.likely_bot_probe_count, 1);
  assert.match(text.get_work_queue, /likely_bot_probe/);
});
// (2d) get_gsc_pages: available_periods passes on; capabilities periods pass on; both named in the description.
await point('2d get_gsc_pages available_periods + capabilities periods', async () => {
  const out = await read('get_gsc_pages', {}, { status: 'insufficient_evidence', items: [], available_periods: [28],
    data_quality: { reason: 'period_not_in_snapshot' } });
  assert.deepEqual(out.available_periods, [28]);
  assert.match(text.get_gsc_pages, /available_periods/);
  const f = await connect({ responses: [{ body: caps() }] }, { capabilities: caps() });
  try { assert.deepEqual(value(await f.client.callTool({ name: 'get_capabilities', arguments: {} })).specialist_reads.get_gsc_pages.periods, [28]); }
  finally { await f.close(); }
});
// (2e) get_site_context: tone_label (the English label of the stored tone) passes on and is the one to use.
await point('2e get_site_context tone_label', async () => {
  const out = await read('get_site_context', {}, { brand: { tone: 'professioneel', tone_label: 'professional' } });
  assert.equal(out.brand.tone_label, 'professional');
  assert.match(text.get_site_context, /tone_label/);
});
// (3) get_gsc_pages: only the stored 28-day window, no promise of 7 or 90.
await point('3 get_gsc_pages description: 28 days only', () => {
  assert.match(text.get_gsc_pages, /28 days/);
  assert.doesNotMatch(text.get_gsc_pages, /7, 28 or 90/);
  assert.doesNotMatch(text.get_gsc_pages, /\b(?:7|90) days\b/);
});
assert.deepEqual(failed, [], 'failed points');

console.log('PASS: PRO 0.9.52 fields pass on unchanged (overview not_applicable, changed_sources, q_match/query_scope, likely_bot_probe, available_periods/periods, tone_label) and are named in the descriptions; get_gsc_pages says 28 days only.');
