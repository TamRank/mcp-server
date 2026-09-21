import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const result=spawnSync(process.execPath,[fileURLToPath(new URL('./workflow-package.mjs',import.meta.url)),'--native-schema'],{
  env:{...process.env,TAMRANK_SCHEMA_CASE_FILTER:'public-specialist-query-full-25'},
  encoding:'utf8',timeout:30000,maxBuffer:1048576
});
assert.equal(result.error,undefined);
assert.equal(result.signal,null);
assert.equal(result.status,1);
assert.match(result.stderr,/A filtered diagnostic cannot count as complete native package acceptance/);
assert.ok(!result.stdout.includes('RUN INSTALLED:'));
assert.ok(!result.stdout.includes('PACKAGE OK:'));
console.log('PASS: filtered diagnostics cannot start or claim complete package acceptance.');
