/** Fix C (19 Oct): a speed question finds TamRank in tools/list. start_scan and diagnose_page carry the words a user
 *  asks with (page speed test, Core Web Vitals, performance score, PageSpeed Insights / Lighthouse) and point away from
 *  calling the PageSpeed Insights API directly. They name only what a result carries (performance score, FCP, LCP, TBT,
 *  CLS: validResult, scan-receipt-recovery) and say INP is not available; INP is a field metric, never in a lab run.
 *  Synthetic VPS seam only; nothing is sent. */
import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

const support = { available: true, plan_available: true, read_available: true, max_targets: 25, devices: ['mobile', 'desktop'] };
const caps = (extra = {}) => ({ ...fullCaps(), pagespeed_execution: support,
  scan_limits: { pagespeed_per_url_per_day: 20, pagespeed_full_scans_per_day: 1, schema_scans_at_once: 1 }, ...extra });
const noInp = /INP is not available: it is a field measurement, not part of a Lighthouse lab run/;
const words = [/page speed test/, /Core Web Vitals/, /performance score, FCP, LCP, TBT and CLS/, noInp, /performance score/, /Google PageSpeed Insights \/ Lighthouse/,
  /[Uu]se this instead of calling the PageSpeed Insights API yourself; if a site has no key, get_capabilities says how to add one\./];

// PageSpeed offered: both descriptions in the listing carry every word; the two-step flow text is unchanged.
{
  const f = await connect({ responses: [] }, { capabilities: caps({ index_checks: { contract_version: 1, available: true } }) });
  try {
    const tools = new Map((await f.client.listTools()).tools.map(t => [t.name, t]));
    for (const name of ['start_scan', 'diagnose_page']) {
      const text = tools.get(name).description;
      for (const w of words) assert.match(text, w, `${name} lacks ${w}`);
      // INP appears only in the sentence that says it is not available: no result field promises it.
      assert.doesNotMatch(text.replace(noInp, ''), /INP/, `${name} promises INP`);
    }
    assert.match(tools.get('start_scan').description, /^Only when the user asks\. Index check: .* PageSpeed: /);
    assert.match(tools.get('start_scan').description, /makes a plan and measures nothing/);
    // PRO with legacy_cache_writes true also fills the PageSpeed overview; an older PRO does not. The text promises neither
    // chat-only results nor results that always appear in wp-admin.
    assert.match(tools.get('start_scan').description, /With a recent TamRank PRO the results also appear in the PageSpeed overview in wp-admin\./);
    assert.doesNotMatch(tools.get('start_scan').description, /only (in|to) (the )?chat|not (saved|stored|shown)|always (appear|shown)/i);
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
console.log('PASS: start_scan and diagnose_page list page speed test, performance score, FCP, LCP, TBT, CLS (Core Web Vitals), PageSpeed Insights / Lighthouse, and say INP is not available.');
