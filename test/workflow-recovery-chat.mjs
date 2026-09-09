import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {discoverRecovery,recoveryAcks} from '../src/scan-recovery-chat.js';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',ref='receipt_'+'a'.repeat(64);
const ctx={execution_id:id,receipt_reference:ref};
const input={...ctx,client_request_id:'chat-recovery-fixture',expected_runtime_hash:'b'.repeat(64),confirmation:{mode:'chat_attested',confirmed:true,
  review_hash:'c'.repeat(64),client:{name:'Test',version:null},agent:{name:'Test agent'},acknowledgements:recoveryAcks}};
const support={chat_review_contract:1,receipt_review_available:true,settlement_available:true};
function registry(options={}){const calls=[],tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},
  {get:async()=>{throw Error('Unexpected generic route');},post:async()=>{throw Error('Unexpected generic write');}},
  {profile:'specialist',capabilities:{scan_recovery:support},recovery:{reviewChat:async a=>{calls.push(['review',a]);return {review:{}};},
    settle:async a=>{calls.push(['settle',a]);return {view:'result_settlement'};}},...options});return {tools,calls};}
test('Receipt recovery uses the existing read and closure tools; never maintenance rights or provider dispatch',async()=>{
  const {tools,calls}=registry();assert.equal(tools.size,20);assert.equal(tools.get('get_scan_status').c.annotations.readOnlyHint,true);
  assert.equal(tools.get('close_scan').c.annotations.destructiveHint,true);
  assert.ok(!(await tools.get('get_scan_status').h(ctx)).isError);assert.ok(!(await tools.get('close_scan').h(input)).isError);
  assert.deepEqual(calls[0],['review',ctx]);assert.equal(calls[1][1].confirmation.review_hash,input.confirmation.review_hash);
  for(const profile of ['core','legacy'])assert.equal(registry({profile}).tools.has('close_scan'),false);
});
test('Private setup/current advertised grant is mandatory; unpaid maintenance cannot become recovery',async()=>{
  for(const option of [{recovery:null},{capabilities:null},{capabilities:{scan_recovery:{...support,chat_review_contract:0}}},
    {capabilities:{scan_recovery:{...support,settlement_available:false}}},{maintenanceOnly:true}]){
    const {tools,calls}=registry(option);assert.equal((await tools.get('close_scan').h(input)).isError,true);assert.equal(calls.length,0);
  }
});
test('No packet/force/URL override; review cannot close; exact recovery acknowledgements required',async()=>{
  const {tools,calls}=registry();
  for(const value of [{...ctx,confirmation:input.confirmation},{...ctx,proposal_id:id},{receipt_reference:ref},{...ctx,type:'pagespeed'}])
    assert.equal((await tools.get('get_scan_status').h(value)).isError,true);
  for(const value of [{...input,force:true},{...input,result_receipt:'private'},{...input,site_url:'https://other.invalid'},
    {...input,confirmation:{...input.confirmation,acknowledgements:[...recoveryAcks].reverse()}},
    {...input,confirmation:{...input.confirmation,confirmed:false}},{...input,confirmation:{...input.confirmation,agent:{name:'<bad>'}}}])
    assert.equal((await tools.get('close_scan').h(value)).isError,true);
  assert.equal(calls.length,0);
});
test('Discovery stays passive and opt-in, with no escalation after failed startup or unpaid mode',async()=>{
  const calls=[],client={get:async path=>{calls.push(path);return {scan_recovery:support};}};
  for(const options of [{},{preview:true,profile:'core',preflight:{ok:true}},{preview:true,profile:'specialist',preflight:{ok:false}},
    {preview:true,profile:'specialist',preflight:{ok:true},maintenanceOnly:true}])assert.equal(await discoverRecovery(client,options),null);
  assert.equal(calls.length,0);assert.deepEqual(await discoverRecovery(client,{preview:true,profile:'specialist',preflight:{ok:true}}),support);
  assert.deepEqual(calls,['/scans/recovery/capabilities']);
});
