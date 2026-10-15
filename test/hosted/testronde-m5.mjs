import assert from 'node:assert/strict';
import { connect } from './factory-fixtures.mjs';
import { workflowDefinitions } from '../../src/workflow-tools.js';

// Bugs from the hosted test round of 15 Oct 2026 (B1, M1, M2, M5, C4), each against the stub site.
const value = output => JSON.parse(output.content[0].text);
const wp = (status, code, message, data = {}) => ({ status, body: { code, message, data: { status, ...data } } });
const changed = () => wp(409, 'workflow_read_changed', 'The work evidence changed during the read.');
const run = async (responses, name, args, check, contextOptions = {}) => {
  const f = await connect({ responses }, contextOptions);
  try { return await check(await f.client.callTool({ name, arguments: args }), f.stub); } finally { await f.close(); }
};

// M5: descriptions promise no periods or refreshes this connection cannot deliver.
{
  const f = await connect({ responses: [] }, { capabilities: { ...(await import('./factory-fixtures.mjs')).fullCaps(),
    specialist_reads: { get_gsc_pages: { available: true } } } });
  try {
    const { tools } = await f.client.listTools();
    const text = Object.fromEntries(tools.map(t => [t.name, t.description]));
    assert.ok(text.diagnose_page, 'diagnose_page listed');
    assert.match(text.diagnose_page, /cannot refresh/);
    { assert.ok(text.get_gsc_pages, "get_gsc_pages listed");
      assert.doesNotMatch(text.get_gsc_pages, /over 7, 28 or 90 days/);
      assert.match(text.get_gsc_pages, /period_not_in_snapshot/);
      assert.match(text.get_gsc_pages, /cannot refresh/);
    }
    // No description sends the agent to a tool this connection does not list.
    const known = new Set([...Object.keys(workflowDefinitions()), 'list_sites', 'refresh_snapshot', 'start_investigation']);
    for (const [name, description] of Object.entries(text))
      for (const word of description.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || [])
        if (known.has(word) && !text[word] && word !== 'list_sites')
          assert.match(description, new RegExp(`(?:where ${word} is listed|${word} where listed)`), `${name} points to unlisted ${word}`);
  } finally { await f.close(); }
}

console.log('PASS: testronde 15 okt M5: descriptions promise no refresh and no unlisted tool.');
