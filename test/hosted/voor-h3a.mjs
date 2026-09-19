/** PRO's H2 "VOOR H3a" list (h2-final-report.md): one proof per point. Gaps were red before their fix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowClient } from '../../src/workflow-rest.js';
import { mapHostedOutcome } from '../../src/hosted/error-map.js';
import { createStubVps } from './stub-vps.mjs';
import { connect, fullCaps, executeArgs, nativeReply, planArgs, id } from './factory-fixtures.mjs';

const pretty = 'https://site.example.invalid/wp-json/tamrank/v2';
const executePath = `/changes/executions/${id}/execute`;
const value = output => JSON.parse(output.content[0].text);
const sent = call => JSON.parse(new TextDecoder().decode(call.bodyBytes));
const wp = (status, code, data = {}) => ({ status, body: { code, message: 'Synthetic', data: { status, ...data } } });
const hosted = responses => {
  const stub = createStubVps({ responses });
  return { stub, client: new WorkflowClient({ rest_base_url: pretty, rest_style: 'pretty', hosted: true, transport: stub.transport }) };
};
const refusal = async (promise, expected) => {
  const error = await promise.then(() => assert.fail('expected a refusal'), e => e);
  assert.deepEqual({ code: error.code, ...error.data }, expected);
};

test('1: agent.name is the grant label, client{name,version} is MCP clientInfo, clientLabel never reaches PRO', async () => {
  const fixture = await connect({ responses: [{ body: nativeReply('executed') }] });
  try {
    assert.equal((await fixture.client.callTool({ name: 'execute_change_set', arguments: executeArgs() })).isError, undefined);
    const { confirmation } = sent(fixture.stub.calls[0]);
    assert.deepEqual(confirmation.agent, { name: fixture.ctx.auditContext.grantLabel });
    assert.match(confirmation.agent.name, /^grant:[a-f0-9-]{36}$/);
    assert.deepEqual(confirmation.client, { name: 'Synthetic MCP client', version: '2.4' });
    assert.equal(new TextDecoder().decode(fixture.stub.calls[0].bodyBytes).includes(fixture.ctx.auditContext.clientLabel), false);
  } finally { await fixture.close(); }
});

test('3: a read that capabilities do not advertise is neither listed nor dispatched', async () => {
  const caps = fullCaps(); delete caps.reads.get_signals;
  const fixture = await connect({ responses: [{ body: { contract_version: 2 } }] }, { capabilities: caps });
  try {
    assert.equal((await fixture.client.listTools()).tools.some(tool => tool.name === 'get_signals'), false);
    const output = await fixture.client.callTool({ name: 'get_signals', arguments: {} });
    assert.equal(value(output).code, 'workflow_operation_unavailable');
    assert.equal(fixture.stub.calls.length, 0); assert.equal(fixture.stub.recorded.length, 0);
  } finally { await fixture.close(); }
});

test('3: importance.update needs work_administration.importance.available === true', async () => {
  const args = { client_request_id: 'synthetic-importance-001', operation: 'importance.update', post_id: 1,
    expected_value: 'standard', value: 'money' };
  for (const importance of [undefined, { available: false }, { available: 'true' }, { available: true }]) {
    const caps = fullCaps();
    caps.work_administration = { available: true, operations: ['work.note', 'importance.update'], ...(importance ? { importance } : {}) };
    const fixture = await connect({ responses: [{ body: { contract_version: 2 } }] }, { capabilities: caps });
    try {
      const output = await fixture.client.callTool({ name: 'update_work_item', arguments: args });
      if (importance?.available === true) {
        assert.equal(output.isError, undefined); assert.equal(fixture.stub.calls.length, 1);
      } else {
        assert.equal(value(output).code, 'workflow_operation_unavailable'); assert.equal(fixture.stub.calls.length, 0);
      }
    } finally { await fixture.close(); }
  }
});

test('4: both WordPress REST forms come from rest_base_url, never from concatenated suffixes', async () => {
  for (const [style, base, url] of [
    ['query', 'https://site.example.invalid/sub/index.php?rest_route=/tamrank/v2',
      'https://site.example.invalid/sub/index.php?rest_route=%2Ftamrank%2Fv2%2Fpages%2F12&section=metadata'],
    ['pretty', 'https://site.example.invalid/sub/wp-json/tamrank/v2',
      'https://site.example.invalid/sub/wp-json/tamrank/v2/pages/12?section=metadata'],
  ]) {
    const fixture = await connect({ responses: [{ body: { contract_version: 2 } }] }, {}, ctx => {
      ctx.validatedInstallation.canonical_home_url = 'https://site.example.invalid/sub/';
      ctx.validatedInstallation.rest_base_url = base; ctx.validatedInstallation.rest_style = style;
    });
    try {
      assert.equal((await fixture.client.callTool({ name: 'get_page', arguments: { post_id: 12, section: 'metadata' } })).isError, undefined);
      assert.equal(fixture.stub.calls[0].url, url);
    } finally { await fixture.close(); }
  }
});

test('5: each confirmed WP error maps exactly through the hosted client; a wrong status is no evidence', async () => {
  for (const [status, code, expected] of [
    [401, 'agent_token_missing', 'upstream_auth_unavailable'], [401, 'agent_token_invalid', 'site_reconnect_required'],
    [401, 'agent_token_expired', 'site_reconnect_required'], [401, 'agent_token_revoked', 'site_reconnect_required'],
    [401, 'cloud_link_pending', 'site_link_unavailable'], [401, 'cloud_link_revoked', 'site_reconnect_required'],
    [402, 'pro_required', 'site_entitlement_required'], [403, 'agent_scope_insufficient', 'site_scope_insufficient'],
    [403, 'workflow_operator_unavailable', 'site_owner_unavailable'], [409, 'workflow_profile_required', 'site_profile_required'],
    [409, 'workflow_upgrade_required', 'site_upgrade_required'],
    [403, 'agent_token_revoked', 'site_unavailable'], [401, 'pro_required', 'site_unavailable'],
  ]) {
    const { client, stub } = hosted([wp(status, code)]);
    await refusal(client.get('/site/context'), { code: expected, retryable: expected === 'site_unavailable', outcome_unknown: false });
    assert.equal(stub.calls.length, 1);
  }
});

test('5: retry_after is read only from a valid WP 429 JSON body', async () => {
  for (const [response, expected] of [
    [wp(429, 'rate_limit_exceeded', { retry_after: 30 }), { retry_after: 30 }],
    [wp(429, 'change_execution_rate_limited', { retry_after: 45, remaining: 0 }), { retry_after: 45 }],
    [{ ...wp(429, 'rate_limit_exceeded'), headers: { 'retry-after': '30' } }, {}],
    [wp(429, 'rate_limit_exceeded', { retry_after: 3601 }), {}], [wp(429, 'rate_limit_exceeded', { retry_after: '30' }), {}],
  ]) {
    const { client } = hosted([response]);
    await refusal(client.get('/site/context'), { code: 'rate_limited', retryable: true, outcome_unknown: false, ...expected });
  }
});

test('5: a 429 without a valid WP envelope fails closed', async () => {
  assert.deepEqual(mapHostedOutcome({ status: 429, code: 'rate_limit_exceeded', validWpEnvelope: false, kind: 'write', retryAfter: 30 }),
    { code: 'site_unavailable', retryable: false, outcome_unknown: true });
  for (const response of [{ status: 429, html: '<html>Too Many Requests</html>' },
    { status: 429, body: { data: { retry_after: 3600 } } },
    { status: 429, body: { code: 'rate_limit_exceeded', message: 'Synthetic', data: { status: 503, retry_after: 30 } } }]) {
    let { client, stub } = hosted([response]);
    await refusal(client.post('/work-items', {}), { code: 'site_unavailable', retryable: false, outcome_unknown: true });
    assert.equal(stub.calls.length, 1);
    ({ client } = hosted([response]));
    await refusal(client.get('/site/context'), { code: 'site_unavailable', retryable: true, outcome_unknown: false });
  }
});

test('6: recorder failure is retryable and releases no change-set ID or result', async () => {
  for (const [name, args, body, code] of [
    ['plan_changes', planArgs(), nativeReply(), 'proposal_binding_failed'],
    ['rollback_change_set', { change_set_id: id, client_request_id: 'synthetic-rollback-001', item_ids: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] },
      nativeReply('planned', 'workflow-field-rollback-1'), 'proposal_binding_failed'],
    ['execute_change_set', executeArgs(), nativeReply('executed'), 'result_recording_failed'],
    ['get_changes', { change_set_id: id, kind: 'execution' }, nativeReply('executed'), 'result_recording_failed'],
  ]) {
    const fixture = await connect({ responses: [{ body }], recorderFailure: name });
    try {
      const output = await fixture.client.callTool({ name, arguments: args });
      assert.equal(output.isError, true);
      assert.deepEqual(Object.keys(value(output)).sort(), ['code', 'message', 'retryable']);
      assert.equal(value(output).code, code); assert.equal(value(output).retryable, true);
      assert.equal(JSON.stringify(output).includes(id), false);
    } finally { await fixture.close(); }
  }
});
