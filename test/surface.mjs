/**
 * Surface meter — what a client pays to be connected, before it asks anything.
 *
 * Spawns the server over the real stdio transport and measures the three fixed
 * costs of a session: the `serverInfo` block in the initialize result, the server
 * `instructions` string, and the whole `tools/list` payload.
 *
 * Character counts are taken on the COMPACT JSON of the payload as it travels over
 * the wire (JSON.stringify without indentation) — the same shape the client parses.
 *
 * Usage:
 *   TAMRANK_PAT=… TAMRANK_SITE_URL=… node test/surface.mjs [--json out.json]
 *
 * Exits non-zero when a budget is exceeded, so it can gate a change.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Budgets (V1.1). Override with env for experiments. */
const BUDGET = {
  // Calibrated on the 42-tool V1.1 surface: a bottom of argument schemas plus SDK
  // boilerplate (~470 chars per tool before a word of description) leaves the rest
  // for prose, so this number moves with the tool count, not with the writing.
  toolsList: Number(process.env.SURFACE_MAX_TOOLS_LIST) || 24000,
  description: Number(process.env.SURFACE_MAX_DESCRIPTION) || 400,
  instructions: Number(process.env.SURFACE_MAX_INSTRUCTIONS) || 1500,
};

const jsonArgIndex = process.argv.indexOf('--json');
const jsonOut = jsonArgIndex > -1 ? process.argv[jsonArgIndex + 1] : null;

const compact = (v) => JSON.stringify(v);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'index.js')],
  cwd: root,
  env: { ...process.env },
  stderr: 'inherit',
});

const client = new Client({ name: 'tamrank-surface', version: '1.0.0' });
await client.connect(transport);

const serverInfo = client.getServerVersion();
const instructions = client.getInstructions() || '';
const { tools } = await client.listTools();

const serverInfoChars = compact(serverInfo).length;
const instructionsChars = instructions.length;
const toolsListChars = compact({ tools }).length;

const rows = tools
  .map((t) => ({
    name: t.name,
    description: (t.description || '').length,
    schema: compact(t.inputSchema || {}).length,
    total: compact(t).length,
  }))
  .sort((a, b) => b.description - a.description);

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log('\nTOOL DESCRIPTIONS (chars, longest first)');
console.log(`${pad('tool', 28)}${num('descr', 7)}${num('schema', 8)}${num('entry', 8)}`);
for (const r of rows) {
  const flag = r.description > BUDGET.description ? '  <-- over budget' : '';
  console.log(`${pad(r.name, 28)}${num(r.description, 7)}${num(r.schema, 8)}${num(r.total, 8)}${flag}`);
}

const overLong = rows.filter((r) => r.description > BUDGET.description);
const hasDataUri = compact(serverInfo).includes('data:');

console.log('\nFIXED SESSION COST');
console.log(`  tools                ${tools.length}`);
console.log(`  tools/list           ${toolsListChars} chars   (budget ${BUDGET.toolsList})`);
console.log(`  serverInfo           ${serverInfoChars} chars   (data: URI present: ${hasDataUri})`);
console.log(`  instructions         ${instructionsChars} chars   (budget ${BUDGET.instructions})`);
console.log(`  handshake total      ${serverInfoChars + instructionsChars} chars`);
console.log(`  longest description  ${rows[0] ? rows[0].description : 0} chars   (budget ${BUDGET.description})`);
console.log(`  descriptions over    ${overLong.length}${overLong.length ? ' — ' + overLong.map((r) => r.name).join(', ') : ''}`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    measured_at: new Date().toISOString(),
    counts: {
      tools: tools.length,
      tools_list_chars: toolsListChars,
      server_info_chars: serverInfoChars,
      instructions_chars: instructionsChars,
      server_info_has_data_uri: hasDataUri,
    },
    budgets: BUDGET,
    per_tool: rows,
    server_info: serverInfo,
    instructions,
    tools,
  }, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}

const failures = [];
if (toolsListChars > BUDGET.toolsList) failures.push(`tools/list ${toolsListChars} > ${BUDGET.toolsList}`);
if (overLong.length) failures.push(`${overLong.length} description(s) over ${BUDGET.description}`);
if (instructionsChars > BUDGET.instructions) failures.push(`instructions ${instructionsChars} > ${BUDGET.instructions}`);
if (hasDataUri) failures.push('serverInfo still carries a data: URI');

await client.close();

if (failures.length) {
  console.log(`\nSURFACE OVER BUDGET:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nSURFACE OK');
process.exit(0);
