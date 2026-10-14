/** Golf 3 E2E against a local PRO site: the hosted PageSpeed module (src/pagespeed-hosted.js) over a direct REST
 * client with a site PAT. The hosted factory refuses loopback sites, so the transport here is the stdio one; the
 * plan → approval → start → status logic and its texts are exactly the hosted ones. PAT from the environment, never printed.
 * Usage: TAMRANK_SITE_URL=http://site.local TAMRANK_PAT=... [TAMRANK_REST_STYLE=query] node scripts/e2e-golf3-local.mjs <post_id>
 * One page on purpose: the second start of the same page is what proves the per-page limit. Multi-page plans: test/hosted/golf3.mjs. */
import { WorkflowClient } from '../src/workflow-rest.js';
import { hostedPageSpeed } from '../src/pagespeed-hosted.js';
import { pagespeedSupport } from '../src/pagespeed-scans.js';

const site = process.env.TAMRANK_SITE_URL, pat = process.env.TAMRANK_PAT;
if (!site || !pat) { console.error('TAMRANK_SITE_URL and TAMRANK_PAT are required.'); process.exit(2); }
const ids = process.argv.slice(2).map(Number);
if (ids.length !== 1 || !Number.isSafeInteger(ids[0]) || ids[0] < 1) { console.error('Give exactly one post ID.'); process.exit(2); }
const redact = text => text.split(pat).join('[pat]');
const client = new WorkflowClient({ siteUrl: site, pat, routeStyle: process.env.TAMRANK_REST_STYLE || 'pretty' });

// What the VPS does at session start (api capabilities.ts): the full contract checked, a public subset passed on.
const full = await client.get('/scans/executions/capabilities').catch(err => ({ error: err.code }));
const main = await client.get('/capabilities');
const pe = full?.pagespeed_execution;
const capabilities = { scan_limits: main.scan_limits,
  pagespeed_execution: pagespeedSupport(pe) ? { available: pe.available, plan_available: pe.plan_available, read_available: pe.read_available,
    max_targets: 25, devices: ['mobile', 'desktop'] } : undefined };
console.log('### PageSpeed discovery (public subset): ' + JSON.stringify(capabilities.pagespeed_execution ?? full) + '\n### scan_limits: ' + JSON.stringify(main.scan_limits));
const ctx = { client, capabilities, clientInfo: { name: 'golf3-e2e', version: '1' }, auditContext: { grantLabel: 'grant:e2e-local' } };
const call = async (canonical, args) => {
  const out = await hostedPageSpeed(canonical, args, ctx);
  const shown = out.error ? { code: out.error[0], message: out.error[1], ...(out.error[2] || {}) } : out.ok;
  console.log(`\n### ${canonical} ${JSON.stringify(args)}${out.error ? ' (isError)' : ''}\n${redact(JSON.stringify(shown, null, 1))}`);
  return shown;
};
const plan = await call('start_scan', { type: 'pagespeed', post_ids: [ids[0]] });
if (plan.proposal_id) {
  const approve = { type: 'pagespeed', proposal_id: plan.proposal_id, confirmation: { plan_hash: plan.plan_hash, confirmed: true } };
  const run = await call('start_scan', approve);
  await call('get_scan_status', { type: 'pagespeed', proposal_id: plan.proposal_id });
  if (run.execution_id) await call('get_scan_status', { type: 'pagespeed', execution_id: run.execution_id });
  // With a temporary per-page limit of 1 a day: a second plan of the same page is fine (plans measure nothing),
  // its start is refused by the site with the plain limit message.
  const second = await call('start_scan', { type: 'pagespeed', post_ids: [ids[0]] });
  if (second.proposal_id) await call('start_scan', { type: 'pagespeed', proposal_id: second.proposal_id,
    confirmation: { plan_hash: second.plan_hash, confirmed: true } });
}
