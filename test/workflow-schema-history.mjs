/** Fast contract/bridge checks. Native WordPress/TLS is a separate suite. */
import assert from 'node:assert/strict';
import {validSchemaExecutionResponse} from '../src/schema-execution.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',itemId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',executionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  originalId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',hash='a'.repeat(64),now=1800000000;
function fixture(inverse=false){
  const acks=inverse?['replace_manual_schema']:[];
  const h={contract_version:1,kind:'field_execution_history',change_set_id:id,change_kind:inverse?'rollback':'forward',
    source_policy:inverse?'workflow-schema-rollback-1':'workflow-schema-execution-1',original_plan_hash:hash,
    site:{installation_id:originalId,blog_id:1,site_origin:'https://owned.invalid'},attribution:{removed_at:now+10},created_at:now,expires_at:now+86400,
    state:'executed',action_id:null,approval_recorded:true,execution_available:false,
    ...(inverse?{reverses:{change_set_id:originalId,plan_hash:'b'.repeat(64),execution_id:originalId,action_id:null}}:{origin:{kind:'user_request',reference:'owned-history',summary:'Reviewed schema'}}),
    items:[{item_id:itemId,operation:'schema.select',target:{post_id:1},url:'https://owned.invalid/page',before:{primary_type:'WebPage'},after:{primary_type:'Article'},
      ...(inverse?{original_item_id:originalId,original_order:0,audit_id:3,original_operation:'schema.select'}:{fields:{primary_type:'Article'}}),
      result:{version:1,execution_id:executionId,item_id:itemId,state:'applied',attempts:1,committed_at:now+1,audit_id:4,changed:true,invalidation:'delivered',
        schema_result:{policy:inverse?'native-schema-rollback-item-1':'native-schema-item-1',current_graph_hash:'c'.repeat(64),proposed_graph_hash:'d'.repeat(64),frontend_output_verified:false}}}],
    execution:{execution_id:executionId,state:'executed',registered_at:now,lease_until:now+120,finished_at:now+1,
      attestation:{mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'user approved in chat',acknowledgements:acks,
        provenance_asserted:true,human_verified:false,attribution_removed_at:now+10},budget:{version:1,window_start:now,operation_count:1,operator_limit:30}}};
  return {contract_version:1,record:{state:'executed',history:h,approval_recorded:true,execution_available:false,
    projection:{contract:'schema_execution_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'}}};
}
let response,calls=[],checks=0;
const check=(v,label)=>{checks++;assert.ok(v,label);};
const caps={schema_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:false,
  rollback_preview_available:true,rollback_preview_contract:'schema_rollback_preview_v1',
  operations:['schema.select','schema.detect','schema_settings.update','meta.update','social.update','image_alt.update'],record_contract:'schema_execution_view_v1',private_proofs_omitted:true}};
const registry=(capabilities=caps)=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,h)},
  {async get(path){calls.push(['GET',path]);return response;},async post(path,body){calls.push(['POST',path,body]);return response;}},{capabilities});return tools;};
for(const inverse of [false,true]){
  response=fixture(inverse);const tools=registry(),args={change_set_id:id,change_token:(inverse?'trsr1.':'trse1.')+'f'.repeat(64),
    confirmation:{plan_hash:hash,confirmed:true,acknowledgements:inverse?['replace_manual_schema']:[]}};
  check(validSchemaExecutionResponse(response,id,hash),'Valid native-shaped history');
  for(const [name,input] of [['get_changes',{kind:'execution',change_set_id:id}],['execute_change_set',args]]){
    const reply=await tools.get(name)(input);check(!reply.isError,'History through '+name);checks++;assert.deepEqual(JSON.parse(reply.content[0].text),response);
  }
  check(calls.length===2,'One request per operation, no implicit replay');calls=[];
  const mutations=[v=>{v.record.execution_available=true;},v=>{v.record.history.execution_available=true;},v=>{v.record.envelope={};},
    v=>{v.record.history.schema_storage={raw:'private-canary'};},v=>{v.record.history.execution.attestation.client={name:'private-canary'};},
    v=>{v.record.history.execution.attestation.operator_id=12;},v=>{v.record.history.items[0].result.schema_result.storage_hash='a'.repeat(64);},
    v=>{v.record.history.items[0].result.delivery={result:'private-canary'};},v=>{v.record.history.items[0].result.item_id=originalId;},
    v=>{v.record.history.original_plan_hash='b'.repeat(64);},v=>{v.record.history.execution.attestation.plan_hash='b'.repeat(64);},
    v=>{v.record.history.items[0].result.schema_result.frontend_output_verified=true;},v=>{delete v.record.history.items[0].result.schema_result;},
    v=>{v.record.history.items[0].after={value:'x'.repeat(1048576)};},v=>{v.record.history.items.push(structuredClone(v.record.history.items[0]));}];
  for(const mutate of mutations){response=fixture(inverse);mutate(response);check(!validSchemaExecutionResponse(response,id,hash),'Reject malformed history');
    const reply=await tools.get('execute_change_set')(args);check(reply.isError,'No malformed historical result returned');check(!reply.content[0].text.includes('private-canary'),'Do not echo private response');}
  response=fixture(inverse);const readOnly=registry({schema_execution:{...caps.schema_execution,available:false,rollback_available:false,operations:[]}});calls=[];
  check((await readOnly.get('execute_change_set')(args)).isError,'Read-only capability cannot transmit old approval');check(calls.length===0,'No request on denied capability');
}
console.log(`PASS: ${checks} schema historical projection and exact-replay bridge checks; native authority tested separately.`);
