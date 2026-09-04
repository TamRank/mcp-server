/**
 * Phase-0 integration check against an isolated WordPress clone.
 *
 * Covers the V1.1 seams that only exist when the PRO REST branch and bridge
 * branch are loaded together: signals stay read-only, batch writes get one
 * review token and per-item audit ids, and rollback restores every value.
 *
 * Env: TAMRANK_PAT, TAMRANK_SITE_URL, TAMRANK_TEST_POSTS="216,217".
 */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TamRankClient } from '../src/rest.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const posts = String(process.env.TAMRANK_TEST_POSTS || '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

assert.equal(posts.length, 2, 'TAMRANK_TEST_POSTS must contain exactly two positive post ids');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'index.js')],
  cwd: root,
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'tamrank-phase0-integration', version: '1.0.0' });
const rest = new TamRankClient({
  siteUrl: process.env.TAMRANK_SITE_URL,
  pat: process.env.TAMRANK_PAT,
  timeoutMs: Number(process.env.TAMRANK_TIMEOUT) || 30000,
});

function parse(result) {
  const text = result.content?.map((item) => item.type === 'text' ? item.text : '').join('\n') || '';
  if (result.isError) {
    throw new Error(text || 'MCP tool returned an error');
  }
  const start = text.indexOf('{');
  assert.notEqual(start, -1, `No JSON object in MCP result: ${text.slice(0, 200)}`);
  return { data: JSON.parse(text.slice(start)), text };
}

async function call(name, args = {}) {
  return parse(await client.callTool({ name, arguments: args }));
}

async function revert(actionId) {
  const dry = (await call('rollback', { action_id: actionId })).data;
  const applied = (await call('rollback', {
    action_id: actionId,
    execute: true,
    change_token: dry.change_token,
  })).data;
  assert.equal(applied.mode, 'applied');
}

await client.connect(transport);
const pendingRollbacks = new Set();

try {
  const capabilities = await call('get_capabilities');
  assert.equal(capabilities.data.tier, 'pro');
  assert.ok(capabilities.text.length <= 2000, `compact capabilities exceeded 2,000 chars (${capabilities.text.length})`);
  assert.equal(Array.isArray(capabilities.data.features), false, 'bridge should opt into compact feature counts');
  assert.ok(Number.isInteger(capabilities.data.features?.total), 'compact feature summary is missing');

  const legacyCapabilities = await rest.get('/capabilities');
  assert.ok(Array.isArray(legacyCapabilities.features), 'REST default must preserve the original features[] contract');

  const firstSignals = (await call('get_signals', { limit: 20 })).data;
  assert.ok(Array.isArray(firstSignals.signals));
  assert.ok(firstSignals.signals.length > 0, 'isolated fixture should expose at least one open signal');
  for (const signal of firstSignals.signals) {
    assert.ok(!Object.hasOwn(signal, 'card'), 'translated card copy must not enter the agent contract');
    assert.ok(!Object.hasOwn(signal, 'fingerprint'), 'internal dedupe fingerprint must stay private');
  }
  const shownBefore = new Map(firstSignals.signals.map((signal) => [signal.id, signal.shown_count]));
  let lastSignals = firstSignals;
  for (let index = 0; index < 10; index += 1) {
    lastSignals = (await call('get_signals', { limit: 20 })).data;
  }
  for (const signal of lastSignals.signals) {
    if (shownBefore.has(signal.id)) {
      assert.equal(signal.shown_count, shownBefore.get(signal.id), `signal ${signal.id} was marked shown by a machine read`);
    }
  }

  const originals = [];
  for (const postId of posts) {
    const meta = (await call('get_meta', { post_id: postId })).data;
    originals.push(meta.meta?.meta_title ?? '');
  }

  const marker = `PHASE0 MCP ${Date.now()}`;
  const items = posts.map((postId, index) => ({
    post_id: postId,
    meta_title: `${marker} ${index + 1}`,
  }));

  const dry = (await call('update_meta_batch', { items })).data;
  assert.equal(dry.mode, 'dry_run');
  assert.equal(dry.items.length, 2);
  assert.ok(dry.change_token);

  const changedSet = items.map((item, index) => index === 1
    ? { ...item, meta_title: `${item.meta_title} changed after review` }
    : item);
  const mismatch = await client.callTool({
    name: 'update_meta_batch',
    arguments: {
      items: changedSet,
      execute: true,
      change_token: dry.change_token,
    },
  });
  const mismatchText = mismatch.content?.map((item) => item.type === 'text' ? item.text : '').join('\n') || '';
  assert.equal(mismatch.isError, true);
  assert.match(mismatchText, /change_token_mismatch/);
  for (let index = 0; index < posts.length; index += 1) {
    const untouched = (await call('get_meta', { post_id: posts[index] })).data;
    assert.equal(untouched.meta?.meta_title ?? '', originals[index], `mismatched token wrote post ${posts[index]}`);
  }

  const applied = (await call('update_meta_batch', {
    items,
    execute: true,
    change_token: dry.change_token,
  })).data;
  assert.equal(applied.mode, 'applied');
  assert.equal(applied.summary.applied, 2);
  assert.equal(applied.items.length, 2);
  for (const item of applied.items) {
    assert.ok(Number.isInteger(item.audit_id) && item.audit_id > 0);
    assert.equal(item.score?.persisted, true);
    pendingRollbacks.add(item.audit_id);
  }

  for (const actionId of [...pendingRollbacks]) {
    await revert(actionId);
    pendingRollbacks.delete(actionId);
  }

  for (let index = 0; index < posts.length; index += 1) {
    const restored = (await call('get_meta', { post_id: posts[index] })).data;
    assert.equal(restored.meta?.meta_title ?? '', originals[index], `post ${posts[index]} was not restored`);
  }

  console.log(`PHASE-0 INTEGRATION OK: ${firstSignals.signals.length} signal(s), 10 read-only repeats, rejected changed set, 2 batch writes and 2 rollbacks.`);
} finally {
  for (const actionId of [...pendingRollbacks]) {
    try {
      await revert(actionId);
    } catch (error) {
      console.error(`Cleanup rollback ${actionId} failed: ${error.message}`);
    }
  }
  await client.close();
}
