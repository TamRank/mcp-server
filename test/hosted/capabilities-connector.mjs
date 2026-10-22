import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { connect } from './factory-fixtures.mjs';

const fixture = await connect();
try {
  const listed = (await fixture.client.listTools()).tools.find(tool => tool.name === 'get_capabilities');
  assert.ok(listed, 'Hosted capabilities tool is listed');
  const validate = new Ajv2020({ strict: false }).compile(listed.inputSchema);
  assert.equal(validate({}), true, 'Normal zero-argument call remains advertised');
  assert.equal(validate({ _connector_internal: { opaque: true } }), true,
    'One connector-added, opaque argument does not make discovery invalid');
  // No property count: the multi-site router adds `site` next to the connector's own argument (22 Oct 2026).
  assert.equal(Object.hasOwn(listed.inputSchema, 'maxProperties'), false, 'No property count is advertised');
  const rejected = await fixture.client.callTool({ name: 'get_capabilities', arguments: { execute: true } });
  assert.equal(rejected.isError, true, 'The SDK/handler still rejects unknown caller arguments');
  assert.equal(fixture.stub.calls.length, 0, 'No site request was sent for an unknown caller argument');
} finally { await fixture.close(); }
console.log('PASS: hosted get_capabilities advertises an open schema but rejects unknown caller arguments.');
