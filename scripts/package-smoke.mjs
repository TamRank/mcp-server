import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {legacyToolInventory} from '../src/legacy-tool-inventory.js';
import {workflowIdentity} from '../src/workflow-identity.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));

assert.equal(manifest.name,'@tam-rank/mcp-server');
assert.equal(manifest.version,workflowIdentity.version);
assert.equal(manifest.main,'./index-workflow.js');
assert.equal(manifest.bin?.['tamrank-mcp'],'./index-workflow.js');
assert.equal(legacyToolInventory().length,42);
await access(resolve(root,'index-workflow.js'));
await access(resolve(root,'src/workflow-tools.js'));

console.log(`PASS: ${manifest.name}@${manifest.version} packaged runtime is complete`);
