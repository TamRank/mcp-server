/** Real private files + synthetic HTTP responses. No credentials, WordPress or Google. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, readFile, writeFile, readdir, chmod, stat, symlink, link, unlink, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspect } from 'node:util';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ScanReceiptStore, ScanReceiptError, MAX_SCAN_RECEIPTS } from '../src/scan-receipt-store.js';
import { WorkflowClient } from '../src/workflow-rest.js';
import { registerWorkflowTools } from '../src/workflow-tools.js';

const site = 'https://fixture.invalid/customer';
const execution = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const otherExecution = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const receipt = 'trsr1.' + Buffer.from('synthetic private result; NOT a server signature').toString('base64url') + '.' + 'a'.repeat(64);
const attempt = { execution_id: execution, measurement_id: 'b'.repeat(64), client_request_id: 'receipt-attempt-0001', expected_runtime_hash: 'c'.repeat(64) };
const input = { site_url: site, execution_id: execution, measurement_id: attempt.measurement_id, attempt_request_id: attempt.client_request_id,
  attempt_runtime_hash: attempt.expected_runtime_hash, result_receipt: receipt };
const context = { site_url: site, execution_id: execution };
const pat = 'tamrank_pat_synthetic_receipt_test_only';
const failure = { code: 'scan_attempt_uncertain', message: 'Private: ' + receipt + ' ' + pat,
  data: { result_receipt: receipt, receipt_contains_private_result: true } };
const response = (data = failure, status = 500) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const privateAbsent = value => { const text = inspect(value); assert.ok(!text.includes(receipt)); assert.ok(!text.includes(pat)); };
const storageError = error => error instanceof ScanReceiptError && !inspect(error).includes(receipt);

await test('private receipt files', async t => {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'tamrank-receipts-'));
  let n = 0;
  async function fixture() {
    const directory = join(scratch, String(++n)); await mkdir(directory, { mode: 0o700 });
    return { directory, store: new ScanReceiptStore({ directory }) };
  }
  try {
    await t.test('opaque bytes survive restart; exact retry does not change first timestamp', async () => {
      const { directory, store } = await fixture();
      assert.deepEqual(await readdir(directory), []); await store.checkReady(); assert.deepEqual(await readdir(directory), []);
      const saved = await store.save(input); assert.equal(saved.retained, true); assert.equal(saved.replayed, false); privateAbsent(saved);
      const file = join(directory, saved.receipt_reference + '.json'), first = await readFile(file, 'utf8');
      assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await stat(directory)).mode & 0o777, 0o700);
      const restarted = new ScanReceiptStore({ directory });
      assert.deepEqual((await restarted.load(saved.receipt_reference, context)).receipt, input);
      // Separate process, with no in-memory store state or recovery authority.
      await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
        `import assert from 'node:assert/strict'; import { ScanReceiptStore } from ${JSON.stringify(new URL('../src/scan-receipt-store.js', import.meta.url).href)};
        const store = new ScanReceiptStore({directory: process.argv[1]});
        assert.deepEqual((await store.load(process.argv[2], ${JSON.stringify(context)})).receipt, ${JSON.stringify(input)});`, directory, saved.receipt_reference]);
      assert.equal((await restarted.save(input)).replayed, true); assert.equal(await readFile(file, 'utf8'), first);
      assert.equal((await store.load(saved.receipt_reference, { ...context, site_url: site + '/' })).receipt.site_url, site);
      assert.deepEqual(await readdir(directory), [saved.receipt_reference + '.json']);
    });
    await t.test('strict bounded input; no unsigned result object, credentials or extra fields', async () => {
      const { directory, store } = await fixture();
      for (const bad of [null, [], {}, { ...input, result: {} }, { ...input, result_receipt: {} },
        { ...input, result_receipt: 'trsr1.' + 'a'.repeat(8192) + '.' + 'b'.repeat(64) },
        { ...input, result_receipt: 'malformed' }, { ...input, execution_id: '../other' },
        { ...input, measurement_id: 2 }, { ...input, attempt_request_id: 'short' },
        ...['http://fixture.invalid', 'https://user:secret@fixture.invalid', site + '?x=1', site + '#x'].map(site_url => ({ ...input, site_url }))])
        await assert.rejects(store.save(bad), storageError);
      assert.deepEqual(await readdir(directory), []);
    });
    await t.test('site subdirectory, scheme, origin and execution remain isolated', async () => {
      const { store } = await fixture(), saved = await store.save(input);
      for (const ctx of [{ ...context, execution_id: otherExecution },
        ...['https://other.invalid/customer', 'https://fixture.invalid/customer-two', 'http://fixture.invalid/customer'].map(site_url => ({ ...context, site_url }))])
        await assert.rejects(store.load(saved.receipt_reference, ctx), storageError);
      for (const ref of ['../outside', '', saved.receipt_reference + '/x', 1, null]) await assert.rejects(store.load(ref, context), storageError);
      assert.notEqual((await store.save({ ...input, site_url: 'https://fixture.invalid/another' })).receipt_reference, saved.receipt_reference);
      assert.notEqual((await store.save({ ...input, execution_id: otherExecution })).receipt_reference, saved.receipt_reference);
    });
    await t.test('missing/public/symlink directories are refused without creating or repairing them', async () => {
      assert.throws(() => new ScanReceiptStore({ directory: 'relative' }), storageError);
      const missing = join(scratch, 'missing'); await assert.rejects(new ScanReceiptStore({ directory: missing }).save(input), storageError);
      await assert.rejects(stat(missing), { code: 'ENOENT' });
      const { store, directory } = await fixture(); await chmod(directory, 0o755);
      await assert.rejects(store.save(input), storageError); assert.equal((await stat(directory)).mode & 0o777, 0o755);
      await chmod(directory, 0o700);
      const alias = join(scratch, 'alias'); await symlink(directory, alias);
      await assert.rejects(new ScanReceiptStore({ directory: alias }).save(input), storageError);
      assert.deepEqual(await readdir(directory), []);
    });
    await t.test('unsafe files, hardlinks, symlinks, oversized or corrupted bytes are never returned', async () => {
      const { directory, store } = await fixture(), saved = await store.save(input), file = join(directory, saved.receipt_reference + '.json');
      const original = await readFile(file);
      await chmod(file, 0o644); await assert.rejects(store.load(saved.receipt_reference, context), storageError); await chmod(file, 0o600);
      const extra = join(scratch, 'hardlink'); await link(file, extra);
      await assert.rejects(store.load(saved.receipt_reference, context), storageError); await unlink(extra);
      for (const bytes of ['{', 'x'.repeat(16385), JSON.stringify({ ...JSON.parse(original), format: 'tampered' }),
        JSON.stringify({ ...JSON.parse(original), receipt: { ...input, result_receipt: receipt.replace(/a$/, 'b') } }),
        JSON.stringify({ ...JSON.parse(original), stored_at: -1 }), JSON.stringify({ ...JSON.parse(original), extra: true })]) {
        await writeFile(file, bytes); await assert.rejects(store.load(saved.receipt_reference, context), storageError);
        await assert.rejects(store.save(input), storageError); assert.equal(await readFile(file, 'utf8'), bytes);
      }
      await writeFile(file, original); const outside = join(scratch, 'outside'); await writeFile(outside, original, { mode: 0o600 });
      await unlink(file); await symlink(outside, file);
      await assert.rejects(store.load(saved.receipt_reference, context), storageError);
      await assert.rejects(store.save(input), storageError); assert.deepEqual(await readFile(outside), original);
    });
    await t.test('a pending writer blocks new saves, not passive recovery; never steal its lock', async () => {
      const { directory, store } = await fixture(), saved = await store.save(input);
      const lock = join(directory, '.write-lock'); await writeFile(lock, 'synthetic interrupted save', { mode: 0o600 });
      await assert.rejects(store.checkReady(), { code: 'scan_receipt_storage_busy' });
      await assert.rejects(store.save(input), { code: 'scan_receipt_storage_busy' });
      assert.deepEqual((await store.load(saved.receipt_reference, context)).receipt, input);
      assert.equal(await readFile(lock, 'utf8'), 'synthetic interrupted save');
    });
    await t.test('concurrent writers cannot overwrite; refused caller can repeat only the local save', async () => {
      const { directory, store } = await fixture();
      const other = new ScanReceiptStore({ directory });
      const results = await Promise.allSettled([store.save(input), other.save(input)]);
      assert.ok(results.some(result => result.status === 'fulfilled'));
      for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'scan_receipt_storage_busy');
      assert.equal((await other.save(input)).replayed, true); assert.equal((await readdir(directory)).length, 1);
    });
    await t.test('fixed capacity preserves existing evidence and allows exact local read/replay', async () => {
      const { directory, store } = await fixture(); let first;
      for (let i = 0; i < MAX_SCAN_RECEIPTS; i++) {
        const saved = await store.save({ ...input, attempt_request_id: 'receipt-capacity-' + i }); if (!i) first = saved;
      }
      assert.equal((await readdir(directory)).length, MAX_SCAN_RECEIPTS);
      await assert.rejects(store.save(input), { code: 'scan_receipt_storage_full' });
      await assert.rejects(store.checkReady(), { code: 'scan_receipt_storage_full' });
      assert.equal((await store.save({ ...input, attempt_request_id: 'receipt-capacity-0' })).replayed, true);
      assert.equal((await store.load(first.receipt_reference, context)).receipt.result_receipt, receipt);
    });
    await t.test('failed file write returns a generic error and leaves no partial record', async () => {
      const { directory, store } = await fixture(), probe = await open(directory), proto = Object.getPrototypeOf(probe);
      await probe.close(); const original = proto.writeFile;
      proto.writeFile = async () => { throw new Error('private path ' + directory + ' ' + receipt); };
      try { await assert.rejects(store.save(input), error => storageError(error) && !inspect(error).includes(directory)); }
      finally { proto.writeFile = original; }
      assert.deepEqual(await readdir(directory), []); assert.equal((await store.save(input)).retained, true);
    });
    await t.test('lost durability acknowledgement reconciles the published file, without overwriting', async () => {
      const { directory, store } = await fixture(), probe = await open(directory), proto = Object.getPrototypeOf(probe);
      await probe.close(); const original = proto.sync;
      proto.sync = async function() { if ((await this.stat()).isDirectory()) throw new Error('synthetic fsync failure'); return original.call(this); };
      try { await assert.rejects(store.save(input), storageError); }
      finally { proto.sync = original; }
      const files = await readdir(directory); assert.equal(files.length, 1);
      const before = await readFile(join(directory, files[0]), 'utf8');
      assert.equal((await store.save(input)).replayed, true); assert.equal(await readFile(join(directory, files[0]), 'utf8'), before);
    });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

await test('transport capture and redaction', async t => {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'tamrank-receipt-transport-'));
  const originalFetch = globalThis.fetch; let n = 0, calls = [];
  async function fixture() {
    const directory = join(scratch, String(++n)); await mkdir(directory, { mode: 0o700 });
    const store = new ScanReceiptStore({ directory });
    return { directory, store, client: new WorkflowClient({ siteUrl: site, pat, receiptStore: store }) };
  }
  const capture = client => client.request('POST', '/fixture/attempt', { body: attempt, retainScanReceipt: true });
  function provider(callback = () => response()) {
    calls = [];
    globalThis.fetch = async (...args) => { calls.push(args); return callback(...args); };
  }
  try {
    await t.test('opt-in capture retains exact bytes before exposing only a safe error/reference', async () => {
      const { client, directory, store } = await fixture(); provider();
      let error; try { await capture(client); } catch (e) { error = e; }
      assert.equal(calls.length, 1); assert.equal(error.code, 'scan_attempt_uncertain'); privateAbsent(error);
      assert.deepEqual((await store.load(error.data.receipt_reference, context)).receipt, input);
      assert.equal(error.data.receipt_retained, true); assert.equal((await readdir(directory)).length, 1);
      assert.deepEqual(JSON.parse(calls[0][1].body), attempt); assert.equal(calls[0][1].headers.Authorization, 'Bearer ' + pat);
      assert.equal(calls[0][1].redirect, 'manual');
    });
    await t.test('configured storage alone does not capture; passive reads write nothing', async () => {
      const { client, directory } = await fixture(); provider();
      await assert.rejects(client.post('/fixture/attempt', attempt), error => { privateAbsent(error); assert.equal(error.data, undefined); return true; });
      provider(() => response({ contract_version: 2, runtime: { settlement: { result_receipt: receipt } }, ordinary: { clicks: 5 }, echo: receipt + ' ' + pat }, 200));
      const data = await client.get('/fixture/read'); privateAbsent(data); assert.equal(data.ordinary.clicks, 5);
      assert.equal(data.runtime.settlement.result_receipt, '[private receipt redacted]'); assert.deepEqual(await readdir(directory), []);
    });
    await t.test('MCP tool results never carry an echoed packet, token or a new receipt tool', async () => {
      const { client, directory } = await fixture(), tools = new Map(); provider();
      registerWorkflowTools({ registerTool: (name, config, handler) => tools.set(name, handler) }, client);
      const result = await tools.get('get_site_context')({}); privateAbsent(result); assert.equal(result.isError, true);
      assert.equal(tools.size, 12); assert.deepEqual(await readdir(directory), []);
    });
    await t.test('malformed private packet is withheld even when echoed without its usual prefix', async () => {
      const { client, directory } = await fixture();
      provider(() => response({ ...failure, message: 'opaque-secret-no-prefix', data: { ...failure.data, result_receipt: 'opaque-secret-no-prefix' } }));
      await assert.rejects(client.get('/fixture/read'), error => !inspect(error).includes('opaque-secret-no-prefix'));
      await assert.rejects(capture(client), { code: 'scan_receipt_retention_failed' });
      assert.deepEqual(await readdir(directory), []);
    });
    await t.test('bad configuration or unavailable/full/busy storage refuses before any HTTP call', async () => {
      const { client, directory } = await fixture(); provider();
      const noStore = new WorkflowClient({ siteUrl: site, pat });
      await assert.rejects(capture(noStore), { code: 'scan_receipt_configuration_invalid' });
      for (const body of [{ ...attempt, extra: true }, { ...attempt, execution_id: '../wrong' }, { ...attempt, measurement_id: undefined }])
        await assert.rejects(client.request('POST', '/fixture/attempt', { body, retainScanReceipt: true }), { code: 'scan_receipt_configuration_invalid' });
      await assert.rejects(client.request('GET', '/fixture/attempt', { body: attempt, retainScanReceipt: true }), { code: 'scan_receipt_configuration_invalid' });
      await chmod(directory, 0o755); await assert.rejects(capture(client), { code: 'scan_receipt_storage_not_ready' }); await chmod(directory, 0o700);
      await writeFile(join(directory, '.write-lock'), '', { mode: 0o600 }); await assert.rejects(capture(client), { code: 'scan_receipt_storage_not_ready' });
      assert.equal(calls.length, 0);
    });
    await t.test('failure after HTTP withholds raw storage errors and never claims a saved receipt', async () => {
      const { directory, store } = await fixture(); provider();
      const client = new WorkflowClient({ siteUrl: site, pat, receiptStore: { checkReady: () => store.checkReady(), save: async () => { throw new Error(receipt + ' ' + pat); } } });
      await assert.rejects(capture(client), error => { privateAbsent(error); assert.equal(error.code, 'scan_receipt_retention_failed'); assert.equal(error.data, undefined); return true; });
      assert.equal(calls.length, 1); assert.deepEqual(await readdir(directory), []);
    });
    await t.test('absent or invalid receipts do not create evidence or trigger retries', async () => {
      const { client, directory } = await fixture();
      for (const data of [{ code: 'scan_attempt_uncertain', message: 'Unknown', data: {} },
        { ...failure, data: { result_receipt: receipt } },
        { ...failure, data: { result_receipt: {}, receipt_contains_private_result: true } }]) {
        provider(() => response(data)); await assert.rejects(capture(client)); assert.equal(calls.length, 1);
      }
      assert.deepEqual(await readdir(directory), []);
    });
    await t.test('timeout, invalid JSON, redirect and response limit remain uncertain; no capture or retry', async () => {
      const { client, directory } = await fixture();
      for (const factory of [() => new Response('{bad', { status: 500 }), () => new Response('', { status: 302 }),
        () => new Response('x'.repeat(524289), { status: 500 }), () => { throw new Error('private network ' + pat); }]) {
        provider(factory); await assert.rejects(capture(client), error => { privateAbsent(error); return true; }); assert.equal(calls.length, 1);
      }
      provider((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(pat)))));
      const timed = new WorkflowClient({ siteUrl: site, pat, timeoutMs: 5, receiptStore: new ScanReceiptStore({ directory }) });
      await assert.rejects(capture(timed), { code: 'timeout' }); assert.equal(calls.length, 1); assert.deepEqual(await readdir(directory), []);
    });
    await t.test('retention follows the original site and exact outgoing attempt, not later object edits', async () => {
      const { client, store } = await fixture(), mutable = { ...attempt }; let error;
      provider(() => { mutable.execution_id = otherExecution; client.base = 'https://other.invalid'; client.pat = 'changed'; return response(); });
      try { await client.request('POST', '/fixture/attempt', { body: mutable, retainScanReceipt: true }); } catch (e) { error = e; }
      privateAbsent(error); assert.deepEqual((await store.load(error.data.receipt_reference, context)).receipt, input);
      assert.deepEqual(JSON.parse(calls[0][1].body), attempt); assert.ok(calls[0][0].href.startsWith(site + '/'));
    });
    await t.test('successful ordinary result does not save a second private copy', async () => {
      const { client, directory } = await fixture(); provider(() => response({ contract_version: 2, result: { performance_score: 50 } }, 200));
      assert.equal((await capture(client)).result.performance_score, 50); assert.equal(calls.length, 1); assert.deepEqual(await readdir(directory), []);
    });
  } finally { globalThis.fetch = originalFetch; await rm(scratch, { recursive: true, force: true }); }
});
