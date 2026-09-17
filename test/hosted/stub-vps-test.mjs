import assert from 'node:assert/strict';
import { createStubVps } from './stub-vps.mjs';
const request = () => ({ method: 'GET', url: 'https://site.example.invalid/wp-json/tamrank/v2/site/context',
  headers: { Accept: 'application/json' }, bodyBytes: new Uint8Array(), timeoutMs: 30000,
  responseByteLimit: 524288, signal: new AbortController().signal });
const stub = createStubVps({ responses: [{ body: { contract_version: 2, site: 'synthetic' } },
  { status: 401, html: '<html>synthetic upstream</html>' }, { failure: 'timeout' }, { failure: 'network' }],
  decisions: { execute_change_set: { ok: false, code: 'insufficient_scope', message: 'Synthetic deny', retryable: false } } });
assert.equal((await stub.authorizer.authorizeOperation('get_site_context', {})).ok, true);
assert.equal((await stub.authorizer.authorizeOperation('execute_change_set', { change_set_id: 'synthetic-id' })).code, 'insufficient_scope');
assert.equal(stub.calls.length, 0);
assert.equal(JSON.parse(new TextDecoder().decode((await stub.transport.request(request())).bodyBytes)).site, 'synthetic');
assert.equal((await stub.transport.request(request())).status, 401);
await assert.rejects(stub.transport.request(request()), { name: 'TimeoutError' });
await assert.rejects(stub.transport.request(request()), { name: 'TypeError' });
assert.equal(stub.calls.length, 4);
await stub.authorizer.recordValidatedResult('get_page', { post_id: 1 }, { contract_version: 2 });
assert.equal(stub.recorded.length, 1);
const failed = createStubVps({ recorderFailure: 'plan_changes' });
await assert.rejects(failed.authorizer.recordValidatedResult('plan_changes', {}, {}));
assert.equal(failed.recorded.length, 0);
const invalid = request(); invalid.timeoutMs = 30001;
await assert.rejects(stub.transport.request(invalid), /Invalid transport request/);
assert.equal(stub.calls.length, 4);
console.log('PASS: synthetic VPS seam shape, FIFO responses, denial, recorder failure, timeout/network/HTML fixtures.');
