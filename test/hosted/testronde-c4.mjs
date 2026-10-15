import assert from 'node:assert/strict';
import { connect } from './factory-fixtures.mjs';

// Bugs from the hosted test round of 15 Oct 2026 (B1, M1, M2, M5, C4), each against the stub site.
const value = output => JSON.parse(output.content[0].text);
const wp = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const changed = () => wp(409, 'workflow_read_changed', 'The work evidence changed during the read.');
const run = async (responses, name, args, check, contextOptions = {}) => {
  const f = await connect({ responses }, contextOptions);
  try { return await check(await f.client.callTool({ name, arguments: args }), f.stub); } finally { await f.close(); }
};

const urlCaps = async () => { const caps = (await import('./factory-fixtures.mjs')).fullCaps();
  caps.reads.diagnose_page = { available: true, url_target: { available: true } }; return caps; };
// C4: a URL of another website: say so, instead of "invalid, unavailable or exceeds the read budget".
await run([wp(400, 'workflow_invalid_query', 'The requested stored data is invalid, unavailable or exceeds the read budget.')],
  'diagnose_page', { url: 'https://other.example.invalid/some-page/', section: 'index' }, out => {
    const v = value(out);
    assert.equal(v.code, 'workflow_url_not_on_site');
    assert.equal(v.retryable, false); assert.equal(v.outcome_unknown, false);
    assert.match(v.message, /other\.example\.invalid/); assert.match(v.message, /site\.example\.invalid/);
    assert.match(v.assistant_note, /list_sites/);
  }, { capabilities: await urlCaps() });
// C4: www. is the same site; a refusal there keeps the site's own reason.
await run([wp(400, 'workflow_invalid_query', 'Synthetic reason.')], 'diagnose_page',
  { url: 'https://www.site.example.invalid/x/', section: 'index' }, out => assert.equal(value(out).code, 'workflow_invalid_query'), { capabilities: await urlCaps() });

console.log('PASS: testronde 15 okt C4: a url of another site is named.');
