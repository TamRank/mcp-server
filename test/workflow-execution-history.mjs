/** Closed historical display/bridge regression; native ownership is tested in PHP. */
import assert from 'node:assert/strict';
import {validHistoricalExecution} from '../src/execution-history.js';
import {validExecutionResponse} from '../src/field-execution.js';
import {validRedirectExecutionResponse} from '../src/redirect-execution.js';
import {validRecoveryResult,fieldRecoveryAcks} from '../src/field-recovery.js';
import {validRedirectRecoveryResult} from '../src/redirect-execution.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',itemId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',executionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  originalId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',hash='a'.repeat(64),now=1800000000;
const caps={field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,operations:['meta.update']},
  redirect_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,mixed_available:true,operations:['redirect.create','redirect.delete','meta.update']}};
let response,calls=[],checks=0;const check=(v,label)=>{checks++;assert.ok(v,label);};
const registry=()=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,h)},
  {async get(path){calls.push(['GET',path]);return response;},async post(path,body){calls.push(['POST',path,body]);return response;}},{capabilities:caps});return tools;};
function fixture(redirect=false,inverse=false){
  const before={meta_title:{exists:true,value:'Old title'}},after={meta_title:{exists:true,value:'New title'}};
  const row={id:1,source_url:'/old',target_url:'/new',redirect_type:'301',match_type:'exact',active:1,auto_generated:0,created_at:'2026-01-01 00:00:00'};
  const operation=redirect?(inverse?'redirect.delete':'redirect.create'):'meta.update';
  const acks=redirect&&inverse?['redirect_deletion']:[];
  const h={contract_version:1,kind:'field_execution_history',change_set_id:id,change_kind:inverse?'rollback':'forward',
    source_policy:`workflow-${redirect?'redirect':'field'}-${inverse?'rollback':'execution'}-1`,original_plan_hash:hash,
    site:{installation_id:originalId,blog_id:1,site_origin:'https://owned.invalid'},attribution:{removed_at:now+10},created_at:now,expires_at:now+86400,
    state:'executed',action_id:null,approval_recorded:true,execution_available:false,
    ...(inverse?{reverses:{change_set_id:originalId,plan_hash:'b'.repeat(64),execution_id:originalId,action_id:null}}:{origin:{kind:'user_request',reference:'owned-history',summary:'Reviewed change'}}),
    items:[{item_id:itemId,operation,target:redirect?(inverse?{original_redirect_id:1}:{source_url:'/old'}):{post_id:1},
      ...(redirect?{}:{url:'https://owned.invalid/page'}),before:redirect?(inverse?row:null):before,after:redirect?(inverse?null:row):after,
      ...(inverse?{original_item_id:originalId,original_order:0,audit_id:3,...(redirect?{original_operation:'redirect.create'}:{})}:
        {fields:redirect?{target_url:{mode:'set',value:'/new'}}:{meta_title:{mode:'set',value:'New title'}}}),
      result:{version:1,execution_id:executionId,item_id:itemId,state:'applied',attempts:1,committed_at:now+1,audit_id:4,changed:true,invalidation:'delivered',
        ...(redirect?{redirect_result:{redirect_id:1,before:inverse?row:null,after:inverse?null:row}}:{})}}],
    execution:{execution_id:executionId,state:'executed',registered_at:now,lease_until:now+120,finished_at:now+1,
      attestation:{mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'user approved in chat',acknowledgements:acks,
        provenance_asserted:true,human_verified:false,attribution_removed_at:now+10},budget:{version:1,window_start:now,operation_count:1,operator_limit:30}}};
  return {contract_version:1,record:{state:'executed',history:h,approval_recorded:true,execution_available:false,
    projection:{contract:'execution_history_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'}}};
}
for(const redirect of [false,true])for(const inverse of [false,true]){
  response=fixture(redirect,inverse);const tools=registry(),args={change_set_id:id,
    change_token:(redirect?(inverse?'trxr1.':'trcx1.'):(inverse?'trcr1.':'trce1.'))+'f'.repeat(64),
    confirmation:{plan_hash:hash,confirmed:true,...(redirect?{acknowledgements:inverse?['redirect_deletion']:[]}:{})}};
  const validator=redirect?validRedirectExecutionResponse:validExecutionResponse;
  check(validator(response,id,hash),'Native-shaped historical family');
  for(const [name,input]of[['get_changes',{kind:'execution',change_set_id:id}],['execute_change_set',args]]){
    const reply=await tools.get(name)(input);check(!reply.isError,`${redirect}/${inverse}/${name}: ${reply.content[0].text}`);
    checks++;assert.deepEqual(JSON.parse(reply.content[0].text),response);
  }
  check(calls.length===2,'One request per operation, no automatic retry');calls=[];
  const mutations=[v=>{v.record.history_record={record:{history:v.record.history,security:{owner_key:'private-canary'}}};delete v.record.history;},
    v=>{v.record.envelope={};},v=>{v.record.history.security={private:'private-canary'};},
    v=>{v.record.history.items[0].item_hash='b'.repeat(64);},v=>{v.record.history.items[0].historical_row={private:'private-canary'};},
    v=>{v.record.history.execution.attestation.client={name:'private-canary'};},v=>{v.record.history.execution.attestation.operator_id=1;},
    v=>{v.record.history.items[0].result.payload_hash='b'.repeat(64);},v=>{v.record.history.items[0].result.delivery={private:'private-canary'};},
    v=>{v.record.history.execution_available=true;},v=>{v.record.execution_available=true;},v=>{v.record.state='running';},
    v=>{v.record.history.items[0].result.item_id=originalId;},v=>{v.record.history.items[0].result.execution_id=originalId;},
    v=>{v.record.history.items.push(structuredClone(v.record.history.items[0]));},v=>{v.record.history.execution.budget.operation_count=2;},
    v=>{v.record.history.execution.attestation.plan_hash='0'.repeat(64);},v=>{v.record.history.items[0].result.invalidation='pending';},
    v=>{v.record.history.items[0].fields={bad:'x'.repeat(1048576)};}];
  if(!redirect)mutations.push(v=>{v.record.history.items[0].before.private='private-canary';});
  for(const mutate of mutations){response=fixture(redirect,inverse);mutate(response);check(!validator(response,id,hash),'Reject private/malformed history');
    for(const name of ['get_changes','execute_change_set']){const reply=await tools.get(name)(name==='get_changes'?{kind:'execution',change_set_id:id}:args);
      check(reply.isError,'Bridge rejects invalid historical response');check(!reply.content[0].text.includes('private-canary'),'Private response not echoed');}}
  response=fixture(redirect,inverse);check(!validator(response,originalId,hash),'Wrong set rejected');check(!validator(response,id,'0'.repeat(64)),'Wrong original hash rejected');calls=[];
}
for(const redirect of [false,true]){
  const recovered=fixture(redirect),h=recovered.record.history,e=h.execution,skipped=fixture(false).record.history.items[0];
  skipped.item_id=originalId;skipped.target.post_id=2;
  skipped.result={version:1,execution_id:e.execution_id,item_id:originalId,state:'skipped',attempts:0,stopped_at:now+2,reason:'interrupted'};
  h.items.push(skipped);h.state='partial';recovered.record.state='partial';e.state='partial';e.budget.operation_count=2;
  e.stop={item_id:originalId,reason:'interrupted',at:now+2};
  e.recovery={version:redirect?2:1,...(redirect?{policy_version:'workflow-redirect-recovery-1',recovery_mode:'stop_pending'}:{}),
    plan_hash:'e'.repeat(64),at:now+2,attestation:{...e.attestation,plan_hash:'e'.repeat(64),acknowledgements:fieldRecoveryAcks}};
  const proposal={plan_hash:'e'.repeat(64),plan:{change_set_id:id,original_plan_hash:hash,source_policy:h.source_policy,recovery_mode:'stop_pending',items:[{stored_state:'applied'},{stored_state:'pending'}]}};
  check(validHistoricalExecution(recovered),'Complete historical recovery retains a safe, readable receipt');
  check((redirect?validRedirectRecoveryResult:validRecoveryResult)(recovered,proposal),'Exact historical recovery result is still supported');
  e.recovery.attestation.client={name:'private-canary'};check(!validHistoricalExecution(recovered),'Recovery client attribution cannot leak back into minimal history');
}
for(const inverse of [false,true]){
  const retired=fixture(false,inverse),h=retired.record.history;delete h.origin;
  Object.assign(h,{kind:'unused_execution_history',state:'retired',execution:null,approval_recorded:false,payload_available:false,retirement:{at:now+86400+1209600},
    items:h.items.map(i=>({item_id:i.item_id,operation:i.operation}))});
  Object.assign(retired.record,{state:'retired',approval_recorded:false});
  check(validHistoricalExecution(retired,id,hash),'Unused proposal remains visible without payload or private proof');
  h.retirement.by={operator_id:1};check(!validHistoricalExecution(retired),'Maintenance identity is not included in the minimal retired view');
}
console.log(`PASS: ${checks} field/redirect historical display and exact-replay bridge checks; native ownership tested separately.`);
