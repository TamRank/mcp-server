/** Validate the complete owned PHP matrix without exposing its record payloads. */
import assert from 'node:assert/strict';
import {validSchemaExecutionResponse} from '../src/schema-execution.js';
assert.equal(process.env.TAMRANK_SCHEMA_PUBLIC_READ_TEST,'1');
let input='';for await(const chunk of process.stdin)input+=chunk;
const records=JSON.parse(input);assert.ok(Array.isArray(records)&&records.length>0);
for(const [n,record] of records.entries())assert.ok(validSchemaExecutionResponse({contract_version:1,record},
  record.envelope.plan.change_set_id,record.envelope.plan_hash),
  `Native projection ${n}: ${record.state}/${record.envelope.plan.kind}/${record.envelope.plan.items.map(i=>i.operation).join(',')}`);
process.stdout.write(JSON.stringify({ok:true,records:records.length}));
