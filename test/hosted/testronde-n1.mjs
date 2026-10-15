import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';
import { mapHostedOutcome, isSiteReadRefusal } from '../../src/hosted/error-map.js';

// N1 (hertest 15 Oct): PRO 0.9.52 refuses a url outside the site's Search Console property with a 403,
// not the 400 workflow_invalid_query C4 was built on. That 403 is the site's decision; every other 403 is not.
const value = output => JSON.parse(output.content[0].text);
const run = async (responses, name, args, check, capabilities) => {
  const f = await connect({ responses }, capabilities ? { capabilities } : {});
  try { return await check(await f.client.callTool({ name, arguments: args }), f.stub); } finally { await f.close(); }
};
const urlCaps = () => { const caps = fullCaps(); caps.reads.diagnose_page = { available: true, url_target: { available: true } }; return caps; };
// The exact answer of PRO 0.9.52 (TamRank_Workflow_GSC_Url_Scope::check, WP_Error serialised by the REST server).
const outsideProperty = () => ({ status: 403, body: { code: 'workflow_url_outside_property',
  message: 'The exact URL is outside the selected Search Console property boundary. No measurement was read or fetched.',
  data: { status: 403 } } });

// The classification: only this status:code pair counts as the site's refusal.
assert.deepEqual(mapHostedOutcome({ status: 403, code: 'workflow_url_outside_property', validWpEnvelope: true }),
  { code: 'workflow_url_outside_property', retryable: false, outcome_unknown: false });
assert.equal(isSiteReadRefusal({ status: 403, code: 'workflow_url_outside_property', validWpEnvelope: true }), true);
assert.equal(isSiteReadRefusal({ status: 403, code: 'workflow_url_outside_property', validWpEnvelope: false }), false, 'needs a valid WP envelope');
assert.deepEqual(mapHostedOutcome({ status: 403, code: 'workflow_url_outside_property', validWpEnvelope: true, kind: 'write' }),
  { code: 'site_unavailable', retryable: false, outcome_unknown: true }, 'a write stays uncertain');
for (const [status, code] of [[401, 'workflow_url_outside_property'], [403, 'workflow_forbidden'], [403, 'rest_forbidden'], [403, 'workflow_x']])
  assert.equal(isSiteReadRefusal({ status, code, validWpEnvelope: true }), false, `${status}:${code}`);

// (1) diagnose_page with a url of the other site (the repro: tammarketing.nl asked about tamrank.com): both hosts, no retry.
for (const section of ['gsc', undefined]) await run([outsideProperty()], 'diagnose_page',
  { url: 'https://other.example.invalid/orphan-pages/', ...(section ? { section } : {}) }, out => {
    const v = value(out);
    assert.equal(out.isError, true);
    assert.equal(v.code, 'workflow_url_not_on_site');
    assert.equal(v.retryable, false); assert.equal(v.outcome_unknown, false);
    assert.match(v.message, /^The website answered: /);
    assert.match(v.message, /other\.example\.invalid/); assert.match(v.message, /site\.example\.invalid/);
    assert.doesNotMatch(v.message, /did not go through/);
    assert.match(v.assistant_note, /list_sites/);
  }, urlCaps());
// (1b) the same site but outside its property (www. is the same site): the site's own reason, no retry.
await run([outsideProperty()], 'diagnose_page', { url: 'https://www.site.example.invalid/x/', section: 'gsc' }, out => {
  const v = value(out);
  assert.equal(v.code, 'workflow_url_outside_property');
  assert.equal(v.retryable, false); assert.equal(v.outcome_unknown, false);
  assert.equal(v.message, `The website answered: ${outsideProperty().body.message}`);
}, urlCaps());

// (2) every other 403 behaves as before: a retryable outage that "did not go through", or its own mapped auth code.
for (const code of ['workflow_forbidden', 'rest_forbidden', 'workflow_x']) await run([{ status: 403, body: { code, message: 'Synthetic', data: { status: 403 } } }],
  'diagnose_page', { url: 'https://other.example.invalid/orphan-pages/', section: 'gsc' }, out => {
    const v = value(out);
    assert.equal(v.code, 'site_unavailable', code); assert.equal(v.retryable, true, code);
    assert.equal(v.message, 'The request to the website did not go through. No reason was given.', code);
  }, urlCaps());
await run([{ status: 403, body: { code: 'agent_scope_insufficient', message: 'Synthetic', data: { status: 403 } } }],
  'diagnose_page', { url: 'https://other.example.invalid/orphan-pages/', section: 'gsc' }, out => {
    const v = value(out);
    assert.equal(v.code, 'site_scope_insufficient'); assert.equal(v.retryable, false);
    assert.doesNotMatch(v.message, /^The website answered/);
  }, urlCaps());
// A 403 with this code but no valid WP envelope (a proxy page) is no site decision either.
await run([{ status: 403, body: { code: 'workflow_url_outside_property', message: 'Synthetic', data: { status: 200 } } }],
  'diagnose_page', { url: 'https://other.example.invalid/orphan-pages/', section: 'gsc' }, out => {
    const v = value(out);
    assert.equal(v.code, 'site_unavailable'); assert.equal(v.retryable, true);
  }, urlCaps());

// (3) get_gsc_pages offers only the period that exists (28); 7 and 90 are refused before anything is sent.
const gscCaps = () => ({ ...fullCaps(), specialist_reads: { get_gsc_pages: { available: true, scope: 'selected_gsc_property_analytics_only',
  stored_window_only: true, periods: [28], max_page_size: 50 } } });
{
  const f = await connect({ responses: [] }, { capabilities: gscCaps() });
  try {
    const tool = (await f.client.listTools()).tools.find(t => t.name === 'get_gsc_pages');
    const period = tool.inputSchema.properties.period;
    assert.deepEqual(period.enum ?? [period.const], [28], JSON.stringify(period));
    for (const p of [7, 90]) {
      const out = await f.client.callTool({ name: 'get_gsc_pages', arguments: { period: p } });
      assert.equal(out.isError, true, `period ${p}`);
    }
    assert.equal(f.stub.calls.length, 0, 'nothing was sent for a period that does not exist');
  } finally { await f.close(); }
}
await run([{ body: { contract_version: 2, items: [] } }], 'get_gsc_pages', { period: 28 }, (out, stub) => {
  assert.equal(out.isError, undefined, JSON.stringify(out)); assert.match(stub.calls[0].url, /period=28/);
}, gscCaps());

console.log('PASS: testronde 15 okt N1: a url outside the property is the site\'s answer; only 28 days are offered.');
