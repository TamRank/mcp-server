/** Every hosted tools/list schema, validated the way the two connector shapes see it (launch bug 22 Oct 2026).
 * Claude validates the model's arguments against the listed schema as is. ChatGPT adds one private argument
 * of its own while validating an open schema (not additionalProperties:false), also for a zero-argument tool;
 * it does not send that argument (the strict SDK schema accepted every ChatGPT call, 167 audit rows), and it
 * does not add one to a closed schema (16 closed tools called without a refusal). The multi-site router in
 * tamrank-api adds a required `site` to every tool; `withSiteArgument` below is a copy of that function
 * (src/mcp/hosted/multiSite.ts @ 12f5db0). Single-site and multi-site listings must both hold. */
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { connect, fullCaps, toolCases } from './factory-fixtures.mjs';

const SITE_PROPERTY = { type: 'string', maxLength: 300, description: 'Required. The site this call is for.' };
function withSiteArgument(tool) {
  const schema = tool.inputSchema ?? { type: 'object' };
  const required = Array.isArray(schema.required) ? schema.required.filter(name => name !== 'site') : [];
  return { ...tool, inputSchema: { ...schema, type: 'object', properties: { ...(schema.properties ?? {}), site: SITE_PROPERTY }, required: [...required, 'site'] } };
}
const CONNECTOR_ARG = { _connector_internal: { opaque: true } };
const fieldOps = ['meta.update','social.update','image_alt.update'], redirectOps = ['redirect.create','redirect.update','redirect.delete'];
// What a PRO site with every hosted part on advertises, so tools/list shows every hosted tool.
const allCaps = () => {
  const caps = fullCaps();
  caps.reads.get_outcomes = { available: true };
  caps.redirect_execution = { contract_version: 1, available: true, mixed_available: true, read_available: true, rollback_available: true,
    operations: [...fieldOps, ...redirectOps] };
  caps.specialist_reads = Object.fromEntries(['get_site_diagnostics','get_gsc_pages','get_redirects','get_images_missing_alt','get_topical_authority']
    .map(name => [name, { available: true }]));
  caps.live_check = { contract_version: 1, available: true };
  caps.index_checks = { contract_version: 1, available: true };
  caps.pagespeed_execution = { available: true, plan_available: true, read_available: true, max_targets: 25, devices: ['mobile', 'desktop'] };
  return caps;
};
// Arguments a model sends; each must be valid in every listing that offers the tool.
const calls = new Map(toolCases().map(([name, args]) => [name, [args]]));
for (const [name, args] of [['get_outcomes', { post_id: 7 }], ['list_changes', { limit: 1 }], ['live_check', { post_id: 7 }],
  ['start_scan', { type: 'index', urls: ['https://site.example.invalid/a/'] }], ['start_scan', { type: 'pagespeed', post_ids: [374] }],
  ['get_scan_status', { type: 'index', check_id: 'idx_' + 'c'.repeat(24) }], ['get_gsc_pages', {}], ['get_site_diagnostics', {}], ['get_redirects', {}], ['get_images_missing_alt', {}], ['get_topical_authority', {}]])
  calls.set(name, [...(calls.get(name) ?? []), args]);

const deep = (schema, visit, path = '$') => {
  if (!schema || typeof schema !== 'object') return;
  visit(schema, path);
  for (const [k, v] of Object.entries(schema)) {
    if (['properties', 'patternProperties', '$defs'].includes(k)) for (const [n, s] of Object.entries(v)) deep(s, visit, `${path}.${k}.${n}`);
    else if (['items', 'additionalProperties', 'propertyNames', 'not'].includes(k)) deep(v, visit, `${path}.${k}`);
    else if (['anyOf', 'oneOf', 'allOf'].includes(k) && Array.isArray(v)) v.forEach((s, i) => deep(s, visit, `${path}.${k}[${i}]`));
  }
};

let checks = 0;
const fixture = await connect({}, { capabilities: allCaps(), scopes: ['site:read','meta:write','audit:read','rollback','changes:write',
  'tasks:write','importance:write','redirects:write'] });
try {
  const { tools } = await fixture.client.listTools();
  const names = tools.map(tool => tool.name);
  assert.ok(names.length >= 22, `every hosted tool is listed (${names.join(', ')})`);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const exercised = new Set();
  for (const single of tools) {
    for (const [label, tool, extra] of [['single-site', single, {}], ['multi-site', withSiteArgument(single), { site: 'tamrank.com' }]]) {
      const schema = tool.inputSchema;
      // A property count is what both connector shapes trip over: the client's own argument and `site` each take a slot.
      deep(schema, (s, path) => { checks++;
        assert.equal(Object.hasOwn(s, 'maxProperties') && path === '$', false, `${label} ${tool.name}: no top-level maxProperties`); });
      const validate = ajv.compile(schema);
      const open = schema.additionalProperties !== false;
      for (const args of calls.get(single.name) ?? [{}]) {
        exercised.add(single.name);
        const claude = { ...args, ...extra };
        checks++; assert.equal(validate(claude), true, `Claude ${label} ${tool.name} ${JSON.stringify(claude)}: ${JSON.stringify(validate.errors)}`);
        if (open) {
          const chatgpt = { ...claude, ...CONNECTOR_ARG };
          checks++; assert.equal(validate(chatgpt), true, `ChatGPT ${label} ${tool.name} ${JSON.stringify(chatgpt)}: ${JSON.stringify(validate.errors)}`);
        }
      }
    }
  }
  assert.deepEqual(names.filter(name => !exercised.has(name)), [], 'every listed tool was validated with real arguments');

  // The 22 Oct bug, reproduced on the schema this package published before the fix.
  const before = withSiteArgument({ name: 'get_capabilities', inputSchema: { type: 'object', maxProperties: 1 } }).inputSchema;
  const old = ajv.compile(before);
  checks++; assert.equal(old({ site: 'tamrank.com' }), true, 'old schema: Claude form passed');
  checks++; assert.equal(old({ site: 'tamrank.com', ...CONNECTOR_ARG }), false, 'old schema: ChatGPT form failed');
  assert.equal(old.errors[0].keyword, 'maxProperties');

  // Server-side validation is unchanged: an argument the tool does not take is refused before any site request.
  for (const args of [{ execute: true }, CONNECTOR_ARG]) {
    const before = fixture.stub.calls.length;
    const rejected = await fixture.client.callTool({ name: 'get_capabilities', arguments: args });
    checks++; assert.equal(rejected.isError, true, `get_capabilities ${JSON.stringify(args)} refused`);
    checks++; assert.equal(fixture.stub.calls.length, before, 'nothing sent for an unknown argument');
  }
} finally { await fixture.close(); }
console.log(`PASS: hosted tools/list schemas hold for the Claude and ChatGPT connector shapes, single- and multi-site (${checks} checks).`);
