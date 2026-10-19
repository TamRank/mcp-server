/** Fix C (19 Oct): a speed question finds TamRank in tools/list. start_scan and diagnose_page carry the words a user
 *  asks with (page speed test, Core Web Vitals, LCP/CLS/INP, performance score, PageSpeed Insights / Lighthouse) and
 *  point away from calling the PageSpeed Insights API directly. Synthetic VPS seam only; nothing is sent. */
import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

const support = { available: true, plan_available: true, read_available: true, max_targets: 25, devices: ['mobile', 'desktop'] };
const caps = (extra = {}) => ({ ...fullCaps(), pagespeed_execution: support,
  scan_limits: { pagespeed_per_url_per_day: 20, pagespeed_full_scans_per_day: 1, schema_scans_at_once: 1 }, ...extra });
const words = [/page speed test/, /Core Web Vitals/, /LCP/, /CLS/, /INP/, /performance score/, /Google PageSpeed Insights \/ Lighthouse/,
  /[Uu]se this instead of calling the PageSpeed Insights API yourself; if a site has no key, get_capabilities says how to add one\./];

// PageSpeed offered: both descriptions in the listing carry every word; the two-step flow text is unchanged.
{
  const f = await connect({ responses: [] }, { capabilities: caps({ index_checks: { contract_version: 1, available: true } }) });
  try {
    const tools = new Map((await f.client.listTools()).tools.map(t => [t.name, t]));
    for (const name of ['start_scan', 'diagnose_page']) for (const w of words) assert.match(tools.get(name).description, w, `${name} lacks ${w}`);
    assert.match(tools.get('start_scan').description, /^Only when the user asks\. Index check: .* PageSpeed: /);
    assert.match(tools.get('start_scan').description, /makes a plan and measures nothing/);
    assert.equal(f.stub.calls.length, 0);
  } finally { await f.close(); }
}
// PageSpeed not offered: start_scan stays index-only and promises no speed test.
{
  const f = await connect({ responses: [] }, { capabilities: { ...fullCaps(), index_checks: { contract_version: 1, available: true } } });
  try {
    const start = (await f.client.listTools()).tools.find(t => t.name === 'start_scan');
    assert.doesNotMatch(start.description, /Core Web Vitals|page speed/);
  } finally { await f.close(); }
}
console.log('PASS: start_scan and diagnose_page list page speed test, Core Web Vitals (LCP, CLS, INP), performance score, PageSpeed Insights / Lighthouse.');
