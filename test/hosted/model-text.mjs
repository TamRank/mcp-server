import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { connect, toolCases, fullCaps } from './factory-fixtures.mjs';
import { WORKFLOW_INSTRUCTIONS } from '../../src/workflow-tools.js';

// Everything the assistant receives can end up in front of the user. Refusal messages are plain
// language only: no internal codenames, scope ids, tool or field names, HTTP statuses or Dutch values.
// Tool names and arguments the assistant needs go in assistant_note, descriptions or instructions,
// which may name tools and arguments but never internal codenames.
const CODENAMES = /workflow|legacy|hosted|specialist|attest|entitlement|safe-beta|\bgrant\b|\bH\d\b|\b(?:laag|middel|hoog)\b/i;
const MESSAGE_ONLY = /\b(?:get|list|plan|execute|rollback|update|search|diagnose)_[a-z_]+\b|\b[a-z]+:(?:read|write|maintain|plan)\b|\(\d{3}\)|\btoken\b|\bcanonical\b|\/tamrank\/v\d/i;
const bad = (text, extra = true) => CODENAMES.test(text) || (extra && MESSAGE_ONLY.test(text));

// Proof that the patterns bind, on strings this library used to send.
for (const old of ['This mode is unavailable for hosted workflows; nothing was sent.',
  'Site refused the request (404). The site refused this workflow request.',
  'Work administration is unavailable or this token lacks the operation-specific permission. No mutation was sent.',
  'Read the same set with get_changes(kind=execution); no automatic retry or legacy fallback.',
  'Private scan planning requires explicit site support and scans:plan. Nothing was sent.',
  'No automatic retries or legacy writers.', 'Chat attestation is an agent assertion'])
  assert.ok(bad(old), `pattern misses known old text: ${old}`);

// 1. Every literal refusal message in the library source (failure(code, message) and ApiError(…, message)).
// Argument corrections (invalid_request) may name arguments: they tell the assistant how to fix its own call.
const sources = [...readdirSync(new URL('../../src/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `src/${f}`),
  ...readdirSync(new URL('../../src/hosted/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `src/hosted/${f}`)]
  .filter(f => !['src/rest.js', 'src/tools.js'].includes(f)); // retired V1, not in the package
let scanned = 0;
const offenders = [];
for (const file of sources) {
  const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  for (const m of text.matchAll(/failure\(\s*('[^']*'|[^,()]+),\s*('[^'\n]*'|`[^`\n]*`)/g)) {
    const msg = m[2].slice(1, -1); if (!msg.includes(' ')) continue; // a code list, not a message
    scanned++;
    if (bad(msg, m[1] !== "'invalid_request'")) offenders.push(`${file}: ${msg}`);
  }
  for (const m of text.matchAll(/new ApiError\([^,]+,\s*[^,]+,\s*('[^'\n]*'|`[^`\n]*`)/g)) {
    scanned++; if (bad(m[1].slice(1, -1))) offenders.push(`${file}: ${m[1]}`);
  }
}
assert.ok(scanned >= 50, `source scan found only ${scanned} refusal literals`);
assert.deepEqual(offenders, [], 'refusal messages with internal names');

// 2. Instructions and every listed tool description (hosted and stdio wording) carry no codenames.
assert.ok(!CODENAMES.test(WORKFLOW_INSTRUCTIONS), WORKFLOW_INSTRUCTIONS.match(CODENAMES)?.[0]);
const listed = { ...fullCaps(),
  redirect_execution: { contract_version: 1, available: true, read_available: true, rollback_available: true,
    operations: ['redirect.create','redirect.update','redirect.delete'] },
  specialist_reads: Object.fromEntries(['get_site_diagnostics','get_gsc_pages','get_redirects','get_images_missing_alt','get_topical_authority']
    .map(name => [name, { available: true }])) };
const fixture = await connect({ responses: [] }, { capabilities: listed });
try {
  const instructions = fixture.client.getInstructions();
  assert.ok(!CODENAMES.test(instructions), `hosted instructions: ${instructions.match(CODENAMES)?.[0]}`);
  const { tools } = await fixture.client.listTools();
  assert.equal(tools.length, 17, tools.map(t => t.name).join());
  for (const tool of tools) {
    assert.ok(!CODENAMES.test(tool.description), `${tool.name}: ${tool.description}`);
    for (const [arg, schema] of Object.entries(tool.inputSchema.properties || {}))
      assert.ok(!CODENAMES.test(JSON.stringify(schema)), `${tool.name}.${arg}: ${JSON.stringify(schema)}`);
  }
} finally { await fixture.close(); }

// 3. Live refusals of every hosted tool when the site turns it down: the message stays plain.
for (const [name, args] of toolCases()) {
  for (const response of [{ status: 404, body: { code: 'rest_no_route', message: 'No route was found matching the URL and request method.', data: { status: 404 } } },
    { status: 503, html: '<html>down</html>' }]) {
    const f = await connect({ responses: [response] });
    try {
      const out = await f.client.callTool({ name, arguments: args });
      if (!out.isError) continue;
      const { message } = JSON.parse(out.content[0].text);
      assert.ok(!bad(message), `${name} ${response.status}: ${message}`);
    } finally { await f.close(); }
  }
}
console.log(`PASS: ${scanned} refusal literals, instructions, every tool description and live refusals of ${toolCases().length} tools are free of internal names.`);
