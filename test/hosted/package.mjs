import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hosted from '@tam-rank/mcp-server/hosted';
import { discoverWorkflows } from '@tam-rank/mcp-server/discovery';
const root = new URL('../../', import.meta.url);
assert.deepEqual(Object.keys(hosted).sort(), ['createWorkflowServer','discoverWorkflows']);
assert.equal(typeof hosted.createWorkflowServer, 'function');
assert.equal(hosted.discoverWorkflows, discoverWorkflows);
const pkg = JSON.parse(await readFile(new URL('package.json',root),'utf8'));
assert.equal(pkg.version,'0.4.0-beta.1');
assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'],'1.29.0');
assert(pkg.files.includes('HOSTED-MCP.md'));
assert(!pkg.files.includes('docs/hosted-mcp/'));
assert.equal(await readFile(new URL('HOSTED-MCP.md',root),'utf8'),
  await readFile(new URL('docs/hosted-mcp/h3a-library-contract.md',root),'utf8'));
console.log('PASS: public hosted/discovery exports import without starting stdio, internal builder private, bundled handoff matches source, version/SDK unchanged.');
