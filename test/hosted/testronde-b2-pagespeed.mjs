import assert from 'node:assert/strict';
import { connect, fullCaps } from './factory-fixtures.mjs';

// Testronde 15 Oct B2: PageSpeed off for a missing Google key. PRO says why (reason) and how the user switches it on
// (how_to_enable); TamRank passes both on unchanged and tells the agent to explain the steps. null for an older PRO.
const value = out => JSON.parse(out.content[0].text);
const how = { steps: ['Create a PageSpeed Insights API key in Google Cloud.', 'Paste it in TamRank > Settings > PageSpeed and save.'],
  where: 'TamRank > Settings > PageSpeed', admin_url: 'https://site.example.invalid/wp-admin/admin.php?page=tamrank-settings&tab=pagespeed' };
const support = { available: false, plan_available: true, read_available: true, max_targets: 25, devices: ['mobile', 'desktop'] };
const caps = ps => ({ ...fullCaps(), pagespeed_execution: ps });

// get_capabilities: passed on as is, and the description says to explain it.
{
  const c = caps({ ...support, reason: 'key_missing', how_to_enable: how });
  const f = await connect({ responses: [{ body: c }] }, { capabilities: c });
  try {
    const out = value(await f.client.callTool({ name: 'get_capabilities', arguments: {} }));
    assert.equal(out.pagespeed_execution.reason, 'key_missing');
    assert.deepEqual(out.pagespeed_execution.how_to_enable, how);
    const desc = (await f.client.listTools()).tools.find(t => t.name === 'get_capabilities').description;
    assert.match(desc, /how_to_enable: explain those steps to the user/);
  } finally { await f.close(); }
}
// Odd shapes are dropped to null, never half passed.
for (const bad of [{ steps: [1, 2] }, { 'Bad-Key': 'x' }, 'text', { steps: ['x'.repeat(5000)] }, {}]) {
  const c = caps({ ...support, reason: 'Key Missing!', how_to_enable: bad });
  const f = await connect({ responses: [{ body: c }] }, { capabilities: c });
  try {
    const out = value(await f.client.callTool({ name: 'get_capabilities', arguments: {} }));
    assert.equal(out.pagespeed_execution.reason, null); assert.equal(out.pagespeed_execution.how_to_enable, null, JSON.stringify(bad));
  } finally { await f.close(); }
}
// The refused plan carries the same help and an explicit note to explain it.
{
  const refusal = { status: 409, body: { code: 'scan_proposal_prerequisites', message: 'The scan proposal was refused; no scan was started.',
    data: { status: 409, reason: 'key_missing', how_to_enable: how } } };
  const f = await connect({ responses: [{ body: { contract_version: 2, preview_revision: 'a'.repeat(64) } }, refusal] },
    { capabilities: caps({ ...support, reason: 'key_missing', how_to_enable: how }) });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'pagespeed', post_ids: [374] } }));
    assert.equal(out.code, 'scan_proposal_prerequisites');
    assert.equal(out.reason, 'key_missing'); assert.deepEqual(out.how_to_enable, how);
    assert.match(out.assistant_note, /explain those steps to the user/);
  } finally { await f.close(); }
}
// Older PRO: the refusal stays as it was, without invented help.
{
  const refusal = { status: 409, body: { code: 'scan_proposal_prerequisites', message: 'The scan proposal was refused; no scan was started.', data: { status: 409 } } };
  const f = await connect({ responses: [{ body: { contract_version: 2, preview_revision: 'a'.repeat(64) } }, refusal] }, { capabilities: caps(support) });
  try {
    const out = value(await f.client.callTool({ name: 'start_scan', arguments: { type: 'pagespeed', post_ids: [374] } }));
    assert.equal(out.code, 'scan_proposal_prerequisites');
    assert.equal(out.how_to_enable ?? null, null); assert.equal(out.assistant_note, undefined);
  } finally { await f.close(); }
}
console.log('PASS: testronde B2: PageSpeed reason/how_to_enable passed on unchanged in capabilities and refusals, null for older PRO.');
