/** A rollback confirmed in WordPress admin (PRO wp_admin_confirmed) reads back through the bridge; agent input stays chat-only. */
import assert from 'node:assert/strict';
import {validExecutionResponse} from '../src/field-execution.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',itemId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',executionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  originalId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',hash='a'.repeat(64),now=1800000000;
const caps={field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,operations:['meta.update']}};
let response,calls=[],checks=0;const check=(v,label)=>{checks++;assert.ok(v,label);};
const registry=()=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,h)},
  {async get(path){calls.push(['GET',path]);return response;},async post(path,body){calls.push(['POST',path,body]);return response;}},{capabilities:caps});return tools;};
const chat=()=>({mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'user approved in chat',acknowledgements:[],
  provenance_asserted:true,human_verified:false,attribution_removed_at:now+10});
// Contract delta 3b, literally: the historical projection drops approved_by_user_id, operator_id and attested_by_token_id.
const wpAdmin=()=>({mode:'wp_admin_confirmed',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'administrator approved in WordPress admin',
  acknowledgements:[],provenance_asserted:false,human_verified:true,attribution_removed_at:now+10});
// A field rollback set (workflow-field-rollback-1), the only kind wp-admin can roll back in v1.
function fixture(attestation){
  const h={contract_version:1,kind:'field_execution_history',change_set_id:id,change_kind:'rollback',source_policy:'workflow-field-rollback-1',original_plan_hash:hash,
    site:{installation_id:originalId,blog_id:1,site_origin:'https://owned.invalid'},attribution:{removed_at:now+10},created_at:now,expires_at:now+86400,
    state:'executed',action_id:null,approval_recorded:true,execution_available:false,
    reverses:{change_set_id:originalId,plan_hash:'b'.repeat(64),execution_id:originalId,action_id:null},
    items:[{item_id:itemId,operation:'meta.update',target:{post_id:1},url:'https://owned.invalid/page',
      before:{meta_title:{exists:true,value:'New title'}},after:{meta_title:{exists:true,value:'Old title'}},original_item_id:originalId,original_order:0,audit_id:3,
      result:{version:1,execution_id:executionId,item_id:itemId,state:'applied',attempts:1,committed_at:now+1,audit_id:4,changed:true,invalidation:'delivered'}}],
    execution:{execution_id:executionId,state:'executed',registered_at:now,lease_until:now+120,finished_at:now+1,attestation,
      budget:{version:1,window_start:now,operation_count:1,operator_limit:30}}};
  return {contract_version:1,record:{state:'executed',history:h,approval_recorded:true,execution_available:false,
    projection:{contract:'execution_history_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'}}};
}
const read=async()=>{const reply=await registry().get('get_changes')({kind:'execution',change_set_id:id});calls=[];return reply;};

// 1. A wp-admin rolled-back set reads back, through the validator and through get_changes.
response=fixture(wpAdmin());
check(validExecutionResponse(response,id,hash),'wp_admin_confirmed history parses');
{const reply=await read();check(!reply.isError,`get_changes releases the wp-admin set: ${reply.content[0].text}`);
  checks++;assert.deepEqual(JSON.parse(reply.content[0].text),response);}

// 2. chat_attested history is unchanged.
response=fixture(chat());
check(validExecutionResponse(response,id,hash),'chat_attested history still parses');
check(!(await read()).isError,'get_changes still releases a chat set');

// 3. An unknown mode, or literals of one mode under the other, is refused.
for(const [label,attestation] of [
  ['unknown mode',{...wpAdmin(),mode:'admin_attested'}],
  ['unknown mode with chat literals',{...chat(),mode:'agent_confirmed'}],
  ['wp-admin claiming chat provenance',{...wpAdmin(),provenance_asserted:true}],
  ['wp-admin not human verified',{...wpAdmin(),human_verified:false}],
  ['wp-admin with the chat statement',{...wpAdmin(),statement:'user approved in chat'}],
  ['chat claiming human verification',{...chat(),human_verified:true}],
  ['chat with the wp-admin statement',{...chat(),statement:'administrator approved in WordPress admin'}],
  ['historical wp-admin keeps approved_by_user_id',{...wpAdmin(),approved_by_user_id:2}],
  ['historical wp-admin keeps operator_id',{...wpAdmin(),operator_id:1}],
]){
  response=fixture(attestation);
  check(!validExecutionResponse(response,id,hash),`${label}: refused by the validator`);
  check((await read()).isError,`${label}: get_changes releases nothing`);
}

// 4. A recovery attestation stays chat-only: wp-admin never confirms recovery in v1.
{
  const withRecovery=a=>{const r=fixture(chat());r.record.history.execution.recovery={version:1,plan_hash:'e'.repeat(64),at:now+2,
    attestation:{...a,plan_hash:'e'.repeat(64)}};return r;};
  response=withRecovery(chat());const chatRecovery=validExecutionResponse(response,id,hash);
  response=withRecovery(wpAdmin());
  check(!validExecutionResponse(response,id,hash),'wp_admin_confirmed recovery attestation refused');
  // The refusal must come from the mode, not from an otherwise invalid fixture.
  check(chatRecovery,'the same recovery with chat_attested parses');
}

// 5. Agent input never carries wp_admin_confirmed: execute and rollback refuse it and send nothing.
{
  const tools=registry(),base={change_set_id:id,change_token:'trcr1.'+'f'.repeat(64),confirmation:{plan_hash:hash,confirmed:true}};
  for(const [label,confirmation] of [
    ['mode wp_admin_confirmed',{...base.confirmation,mode:'wp_admin_confirmed'}],
    ['human_verified true',{...base.confirmation,human_verified:true}],
    ['approved_by_user_id',{...base.confirmation,approved_by_user_id:2}],
    ['full wp-admin attestation',{...base.confirmation,...wpAdmin()}],
  ]){
    const reply=await tools.get('execute_change_set')({...base,confirmation});
    check(reply.isError&&JSON.parse(reply.content[0].text).code==='invalid_request',`execute refuses ${label}`);
  }
  for(const extra of [{confirmation:{mode:'wp_admin_confirmed'}},{mode:'wp_admin_confirmed'},{human_verified:true}]){
    const reply=await tools.get('rollback_change_set')({change_set_id:id,client_request_id:'owned-rollback-001',item_ids:[itemId],...extra});
    check(reply.isError&&JSON.parse(reply.content[0].text).code==='invalid_request',`rollback refuses ${JSON.stringify(extra)}`);
  }
  check(calls.length===0,'Refused agent input sends nothing');
  // What the bridge does send is chat_attested, whatever it was asked.
  response=fixture(chat());await tools.get('execute_change_set')(base);
  check(calls.at(-1)?.[2]?.confirmation?.mode==='chat_attested','Bridge execution body is chat_attested');
}
console.log(`PASS: ${checks} wp-admin rollback history checks: wp_admin_confirmed and chat_attested history parse, unknown or mixed modes refused, recovery chat-only, agent input never wp_admin_confirmed.`);
