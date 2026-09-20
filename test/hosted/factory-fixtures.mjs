import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWorkflowServer } from '../../src/hosted/factory.js';
import { createStubVps } from './stub-vps.mjs';

export const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const hash = 'a'.repeat(64);
export const fullCaps = () => ({ contract_version: 2, mcp_bridge_compatibility: 'safe-beta-1',
  reads: Object.fromEntries(['get_site_context','get_capabilities','get_work_queue','get_signals','search_pages','get_page','diagnose_page','get_outcomes']
    .map(name => [name, { available: true }])),
  field_execution: { contract_version: 1, available: true, read_available: true, rollback_available: true,
    operations: ['meta.update','social.update','image_alt.update'] },
  field_proposals: { contract_version: 2, available: true, read_available: true,
    operations: ['meta.update','social.update','image_alt.update'], origin_kinds: ['user_request'] },
  work_administration: { available: true, operations: ['work.note'], manual: { available: true, operations: ['work.note'] } },
});
export const planArgs = () => ({ client_request_id: 'synthetic-plan-001',
  origin: { kind: 'user_request', reference: 'synthetic', summary: 'Synthetic user instruction' },
  items: [{ operation: 'meta.update', target: { post_id: 1 }, fields: { meta_title: { mode: 'set', value: 'Synthetic title' } } }] });
export const executeArgs = () => ({ change_set_id: id, change_token: 'trce1.' + 'b'.repeat(64),
  confirmation: { plan_hash: hash, confirmed: true } });
export const nativeReply = (state = 'planned', policy = 'workflow-field-execution-1') => ({ contract_version: 1,
  record: { state, envelope: { plan: { change_set_id: id, policy_version: policy }, plan_hash: hash } } });
export const toolCases = () => [
  ['get_site_context', {}, { contract_version: 2 }],
  ['get_capabilities', {}, fullCaps()],
  ['get_work_queue', {}, { contract_version: 2 }],
  ['get_signals', {}, { contract_version: 2 }],
  ['search_pages', {}, { contract_version: 2 }],
  ['get_page', { post_id: 1 }, { contract_version: 2 }],
  ['diagnose_page', { post_id: 1 }, { contract_version: 2 }],
  ['get_outcomes', { change_set_id: id, status: 'measured' }, { contract_version: 1, items: [], pagination: { total: 0 } }],
  ['update_work_item', { client_request_id: 'synthetic-work-001', operation: 'work.note', work_id: 'manual_fixture',
    expected_revision: hash, note: 'Synthetic note' }, { contract_version: 2 }],
  ['plan_changes', planArgs(), nativeReply()],
  ['execute_change_set', executeArgs(), nativeReply('executed')],
  ['get_changes', { change_set_id: id, kind: 'execution' }, nativeReply('executed')],
  ['rollback_change_set', { change_set_id: id, client_request_id: 'synthetic-rollback-001', item_ids: [other] },
    nativeReply('planned', 'workflow-field-rollback-1')],
];
export function context(stub, { host = 'site.example.invalid', grant = '22222222-2222-4222-8222-222222222222', capabilities = fullCaps(),
  scopes = ['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write'] } = {}) {
  return {
    validatedInstallation: { installation_id: '11111111-1111-4111-8111-111111111111', blog_id: 2,
      canonical_home_url: `https://${host}/`, rest_base_url: `https://${host}/wp-json/tamrank/v2`,
      rest_style: 'pretty', link_id: 'fixture-link-a', generation: 1, workflow_profile: 'safe-beta-1' },
    grantContext: { grant_id: grant, account_id: 'fixture-account-a', client_id: 'fixture-client-a',
      scopes },
    filteredCapabilities: capabilities,
    auditContext: { grantLabel: `grant:${grant}`, clientLabel: 'OAuth fixture display', request_id: 'fixture-request-a' },
    transport: stub.transport, authorizer: stub.authorizer,
  };
}
export async function connect(options = {}, contextOptions = {}, prepare = () => {}) {
  const stub = createStubVps(options), ctx = context(stub, contextOptions); prepare(ctx);
  const server = createWorkflowServer(ctx);
  const client = new Client({ name: 'Synthetic MCP client', version: '2.4' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  return { stub, ctx, server, client, async close() { await client.close(); await server.close(); } };
}
