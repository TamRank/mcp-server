/** Validate actual owned WordPress projections; no fabricated replacement data. */
import assert from 'node:assert/strict';
import {validExecutionResponse} from '../src/field-execution.js';
import {validRedirectExecutionResponse} from '../src/redirect-execution.js';
let text='';for await(const chunk of process.stdin){text+=chunk;assert.ok(Buffer.byteLength(text)<1048576);}
const record=JSON.parse(text),h=record.history,response={contract_version:1,record};
const valid=h.source_policy.startsWith('workflow-redirect-')?validRedirectExecutionResponse:validExecutionResponse;
assert.ok(valid(response,h.change_set_id,h.original_plan_hash),'Actual native projection rejected: '+JSON.stringify({kind:h.kind,policy:h.source_policy,state:h.state,
  items:h.items.map(i=>({operation:i.operation,keys:Object.keys(i),resultKeys:i.result?Object.keys(i.result):[]}))}));
for(const mutate of [v=>{v.record.history_record={private:true};},v=>{v.record.history.security={private:true};},
  v=>{v.record.history.items[0].item_hash='0'.repeat(64);},v=>{v.record.execution_available=true;}]){
  const bad=structuredClone(response);mutate(bad);assert.equal(valid(bad,h.change_set_id,h.original_plan_hash),false);
}
process.stdout.write(JSON.stringify({ok:true,checks:5}));
