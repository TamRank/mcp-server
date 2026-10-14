import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { connect, toolCases, fullCaps } from './factory-fixtures.mjs';
import { WORKFLOW_INSTRUCTIONS } from '../../src/workflow-tools.js';

// Everything the assistant receives can end up in front of the user. Refusal messages are plain
// language only: no internal codenames, scope ids, tool or field names, HTTP statuses or Dutch values.
// Tool names and arguments the assistant needs go in assistant_note, descriptions or instructions,
// which may name tools and arguments but never internal codenames.
// hosted_site is a result field the assistant must read, so it is allowed; the word hosted is not.
const CODENAMES = /workflow|legacy|hosted(?!_site)|specialist|attest|entitlement|safe-beta|\bH\d\b|\b(?:laag|middel|hoog)\b/i;
const MESSAGE_ONLY = /\b(?:get|list|plan|execute|rollback|update|search|diagnose)_[a-z_]+\b|\b[a-z]+:(?:read|write|maintain|plan)\b|\(\d{3}\)|\btoken\b|\bcanonical\b|\/tamrank\/v\d|\b[a-z]+=[a-z_]+|\b(?:meta|social|image_alt|redirect|work|importance)\.[a-z_]+\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\broute\b/i;
const bad = (text, extra = true) => CODENAMES.test(text) || (extra && MESSAGE_ONLY.test(text));

// Proof that the patterns bind, on strings this library used to send.
for (const old of ['This mode is unavailable for hosted workflows; nothing was sent.',
  'Site refused the request (404). The site refused this workflow request.',
  'Work administration is unavailable or this token lacks the operation-specific permission. No mutation was sent.',
  'Read the same set with get_changes(kind=execution); no automatic retry or legacy fallback.',
  'Private scan planning requires explicit site support and scans:plan. Nothing was sent.',
  'Route escaped its installation.', 'Read this set with kind=execution. Do not repeat changes automatically.',
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
  // Golf 3 (pagespeed-hosted.js) returns its refusals as error: [code, message, details] for the caller's failure().
  for (const m of text.matchAll(/error:\s*\[\s*('[^']*'|[^,()\[]+),\s*('[^'\n]*'|`[^`\n]*`)/g)) {
    scanned++; if (bad(m[2].slice(1, -1))) offenders.push(`${file}: ${m[2]}`);
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
    .map(name => [name, { available: true }])), reads: { ...fullCaps().reads, get_outcomes: { available: true } },
  live_check: { contract_version: 1, available: true }, index_checks: { contract_version: 1, available: true },
  pagespeed_execution: { available: true, plan_available: true, read_available: true, route: '/scans/executions',
    proposal_policy: 'pagespeed-execution-proposal-1', max_targets: 25, attempts_per_device: 1, devices: ['mobile', 'desktop'],
    automatic_retries: 0, approval: 'chat_attested', scheduling: 'wp_cron', requires_cron_delivery: true,
    external_requests_reversible: false, results: 'private_scan_progress', legacy_cache_writes: false } };
const fixture = await connect({ responses: [] }, { capabilities: listed });
try {
  const instructions = fixture.client.getInstructions();
  assert.ok(!CODENAMES.test(instructions), `hosted instructions: ${instructions.match(CODENAMES)?.[0]}`);
  const { tools } = await fixture.client.listTools();
  assert.equal(tools.length, 22, tools.map(t => t.name).join());
  for (const tool of tools) {
    assert.ok(!CODENAMES.test(tool.description), `${tool.name}: ${tool.description}`);
    for (const [arg, schema] of Object.entries(tool.inputSchema.properties || {}))
      assert.ok(!CODENAMES.test(JSON.stringify(schema)), `${tool.name}.${arg}: ${JSON.stringify(schema)}`);
  }
} finally { await fixture.close(); }

// get_capabilities shows the site's abilities, not the bridge profile codename that gates the session.
{
  const f = await connect({ responses: [{ body: fullCaps() }] });
  try {
    const out = JSON.parse((await f.client.callTool({ name: 'get_capabilities', arguments: {} })).content[0].text);
    assert.equal(out.mcp_bridge_compatibility, undefined); assert.equal(out.contract_version, 2);
    assert.ok(!CODENAMES.test(JSON.stringify(out)), JSON.stringify(out).match(CODENAMES)?.[0]);
  } finally { await f.close(); }
}

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
// A rate limit says so in plain words instead of "no reason was given".
{
  const f = await connect({ responses: [{ status: 429, body: { code: 'rest_too_many', message: 'x', data: { status: 429, retry_after: 2 } } }] });
  try {
    const out = JSON.parse((await f.client.callTool({ name: 'get_site_context', arguments: {} })).content[0].text);
    assert.equal(out.code, 'rate_limited');
    assert.equal(out.message, 'The request to the website did not go through. The website asked TamRank to slow down. Try again shortly.');
  } finally { await f.close(); }
}
console.log(`PASS: ${scanned} refusal literals, instructions, every tool description and live refusals of ${toolCases().length} tools are free of internal names.`);
