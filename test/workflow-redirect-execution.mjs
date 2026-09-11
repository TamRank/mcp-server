/** Closed bridge mapping with injected results; native TLS/WP is tested separately. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {fieldOperations,validExecutionResponse} from '../src/field-execution.js';
import {redirectOperations,redirectDeliveryAcks,validRedirectRecoveryProposal} from '../src/redirect-execution.js';
import {fieldRecoveryAcks} from '../src/field-recovery.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',hash='a'.repeat(64),original='b'.repeat(64);
const caps={field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:true,operations:fieldOperations},
  redirect_execution:{contract_version:1,available:true,mixed_available:true,read_available:true,rollback_available:true,recovery_available:true,operations:[...fieldOperations,...redirectOperations]}};
const request={client_request_id:'owned-mixed-plan-001',origin:{kind:'user_request',reference:'synthetic',summary:'Owned synthetic redirect'},items:[
  {operation:'redirect.delete',target:{redirect_id:1},fields:{acknowledge_deletion:{mode:'set',value:true}}},
  {operation:'meta.update',target:{post_id:2},fields:{meta_title:{mode:'set',value:'Owned title'}}}]};
const input={change_set_id:id,change_token:'trcx1.'+'c'.repeat(64),confirmation:{plan_hash:hash,confirmed:true,acknowledgements:['redirect_deletion']}};
const reply=(state='planned',inverse=false)=>({contract_version:1,record:{state,envelope:{plan:{contract_version:2,kind:inverse?'rollback':'forward',
  change_set_id:id,policy_version:inverse?'workflow-redirect-rollback-1':'workflow-redirect-execution-1',frontend_verification:'not_performed',
  items:[{item_id:id,operation:'redirect.delete'},{item_id:other,operation:'meta.update'}],required_acknowledgements:['redirect_deletion']},plan_hash:hash,
  change_token:(inverse?'trxr1.':'trcx1.')+'c'.repeat(64)}}});
let checks=0,calls=[],response=reply(),error=null;
const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const transport={async post(path,body){calls.push({path,body});if(error)throw error;return response;},async get(path){calls.push({path});return response;}};
const registry=(capabilities=caps,options={})=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...options});return tools;};
const tools=registry();
check(!(await tools.get('plan_changes').h(request)).isError,'Mixed proposal uses native redirect policy');equal(calls.pop(),{path:'/changes/executions',body:request});
response=reply('executed');check(!(await tools.get('execute_change_set').h(input)).isError,'Exact deletion approval executes');
const sent=calls.pop();equal(sent.path,'/changes/executions/'+id+'/execute');equal(sent.body.confirmation.acknowledgements,['redirect_deletion']);
equal(sent.body.client_request_id,'mcp-execute-'+hash);equal(sent.body.confirmation.agent,{name:'unknown'});
await tools.get('execute_change_set').h(input);equal(calls.pop(),sent,'Exact request identity, no invented retry ID');
for(const change of [v=>delete v.confirmation.acknowledgements,v=>v.confirmation.acknowledgements=['redirect_deletion','redirect_deletion'],
  v=>v.confirmation.acknowledgements=['site_wide_identity'],v=>v.confirmation.confirmed=false,v=>v.confirmation.client={name:'spoof'},
  v=>v.confirmation.human_verified=true,v=>v.confirmation.transcript='private',v=>v.items=request.items,v=>v.change_token='trcs1.'+hash]){
  const bad=structuredClone(input);change(bad);check((await tools.get('execute_change_set').h(bad)).isError,'Invalid redirect consent refused');equal(calls,[],'Rejected input sends no request');
}
check(!validExecutionResponse(response,id,hash),'Old field-only validator does not accept redirect policy');
for(const capability of [{},null,{...caps,redirect_execution:{...caps.redirect_execution,available:false}},
  {...caps,redirect_execution:{...caps.redirect_execution,contract_version:2}}]){
  check((await registry(capability).get('execute_change_set').h(input)).isError,'Missing or incompatible capability refuses writes');equal(calls,[],'No legacy fallback');
}
const onlyCaps={redirect_execution:{...caps.redirect_execution,mixed_available:false,operations:redirectOperations}};
const only=registry(onlyCaps),onlyRequest={...request,items:[request.items[0]]};
check(!(await only.get('plan_changes').h(onlyRequest)).isError,'Redirect-only proposal needs no field capability');calls=[];
check((await only.get('plan_changes').h(request)).isError,'Mixed operation refuses missing metadata support');equal(calls,[],'No unsupported mixed write or draft downgrade');
check(!(await only.get('execute_change_set').h(input)).isError,'Redirect policy execution needs no metadata capability; server verifies actual frozen item grants');calls=[];
check((await registry(caps,{maintenanceOnly:true}).get('execute_change_set').h(input)).isError,'Maintenance-only cannot write');equal(calls,[]);
const rollback={change_set_id:id,client_request_id:'owned-inverse-plan-001',item_ids:[other]};response=reply('planned',true);
check(!(await tools.get('rollback_change_set').h(rollback)).isError,'Rollback obtains a new inverse proposal only');equal(calls.pop(),{path:'/changes/executions/'+id+'/rollback-proposals',body:rollback});
response=reply('executed',true);const inverseInput={...input,change_token:'trxr1.'+'c'.repeat(64)};
check(!(await tools.get('execute_change_set').h(inverseInput)).isError,'Separately approved inverse uses same executor route');calls=[];
check((await registry({...caps,redirect_execution:{...caps.redirect_execution,rollback_available:false}}).get('execute_change_set').h(inverseInput)).isError,'Inverse execution requires explicit rollback capability');equal(calls,[],'No request on missing inverse grant');
for(const change of [v=>v.record.envelope.plan.change_set_id=other,v=>v.record.envelope.plan_hash=original,
  v=>v.record.envelope.plan.policy_version='workflow-field-execution-1',v=>v.record.envelope.plan.kind='forward',
  v=>v.record.envelope.change_token='trcx1.'+'c'.repeat(64),v=>v.record.envelope.plan.required_acknowledgements=[],
  v=>v.record.envelope.plan.items[0].operation='schema.detect',v=>v.record.envelope.plan.items[1].item_id=id,
  v=>v.record.envelope.plan.frontend_verification='verified']){
  response=reply('executed',true);change(response);check((await tools.get('execute_change_set').h(inverseInput)).isError,'Wrong response cannot report success');equal(calls.length,1,'Bad response is not retried');calls=[];
}
// Recovery preserves exact per-item identity and distinguishes stopping from delivery.
function recoveryProposal(delivery=false,inverse=false){return {plan:{contract_version:1,policy_version:'workflow-redirect-recovery-1',
  source_policy:inverse?'workflow-redirect-rollback-1':'workflow-redirect-execution-1',recovery_mode:delivery?'delivery_only':'stop_pending',
  binding:{installation_id:id,blog_id:1,operator_id:2,token_id:3,site_origin:'https://owned.invalid'},change_set_id:id,original_plan_hash:hash,
  execution_id:other,original_token_id:4,expected_state_hash:'f'.repeat(64),created_at:1800000000,expires_at:1800000900,
  items:[{item_id:id,operation:inverse?'redirect.restore':'redirect.create',target:inverse?{original_redirect_id:5}:{source_url:'/old'},source_url:'/old',actual_redirect_id:7,
    stored_state:'applied',disposition:'retain_applied'},{item_id:other,operation:'meta.update',target:{post_id:2},url:'https://owned.invalid/page',
    stored_state:delivery?'applied':'pending',disposition:delivery?'retain_applied':'skip_pending'}],website_writes:0,
  required_acknowledgements:delivery?redirectDeliveryAcks:fieldRecoveryAcks,approval_recorded:false,execution_available:false},plan_hash:original,recovery_token:'trrr1.'+'d'.repeat(64)};}
const recoveryArgs=p=>({change_set_id:id,change_token:p.recovery_token,recovery_plan:p.plan,
  confirmation:{plan_hash:p.plan_hash,confirmed:true,acknowledgements:p.plan.required_acknowledgements}});
const recoveryResult=p=>{const v=reply(p.plan.recovery_mode==='delivery_only'?'executed':'partial',p.plan.source_policy==='workflow-redirect-rollback-1');
  v.record.registration={recovery:{plan_hash:p.plan_hash,policy_version:'workflow-redirect-recovery-1',recovery_mode:p.plan.recovery_mode,attestation:{human_verified:false}}};return v;};
for(const delivery of [false,true])for(const inverse of [false,true]){
  const p=recoveryProposal(delivery,inverse);check(validRedirectRecoveryProposal(p),'Native recovery shape');response={contract_version:1,recovery_proposal:p};
  check(!(await tools.get('get_changes').h({change_set_id:id,kind:'recovery'})).isError,'Recovery proposal uses existing read tool');equal(calls.pop(),{path:'/changes/executions/'+id+'/recovery-proposals',body:{change_set_id:id}});
  response=recoveryResult(p);check(!(await tools.get('execute_change_set').h(recoveryArgs(p))).isError,'Explicit recovery dispatch');
  const sent=calls.pop();equal(sent.path,'/changes/executions/'+id+'/recover');equal(sent.body.proposal,p);equal(sent.body.confirmation.acknowledgements,p.plan.required_acknowledgements);
  equal(sent.body.client_request_id,'mcp-recover-'+original,'Stable recovery request identity');
}
const p=recoveryProposal(),recover=recoveryArgs(p);response=recoveryResult(p);
for(const edit of [v=>v.recovery_plan.website_writes=1,v=>v.recovery_plan.recovery_mode='delivery_only',v=>v.recovery_plan.source_policy='workflow-field-execution-1',
  v=>v.recovery_plan.items[0].actual_redirect_id=null,v=>v.recovery_plan.items[0].target={redirect_id:1},v=>v.recovery_plan.items[0].operation='redirect.restore',
  v=>v.recovery_plan.items.reverse(),v=>v.recovery_plan.items[1].item_id=id,v=>v.recovery_plan.expires_at++,v=>v.recovery_plan.extra='unknown',
  v=>v.confirmation.acknowledgements=redirectDeliveryAcks,v=>v.change_token='trfr1.'+'d'.repeat(64),v=>v.change_set_id=other,v=>delete v.recovery_plan]){
  const bad=structuredClone(recover);edit(bad);check((await tools.get('execute_change_set').h(bad)).isError,'Recovery cannot change scope, mode, source, target or consent');equal(calls,[]);
}
for(const key of ['available','read_available','recovery_available']){
  const support={redirect_execution:{...caps.redirect_execution,[key]:false}},r=registry(support);
  const result=await r.get('execute_change_set').h(recover);
  check(key==='available'?!result.isError:result.isError,'Recovery is independent of new writes, but requires read and management capability');
  equal(calls.length,key==='available'?1:0);calls=[];
}
response=recoveryResult(recoveryProposal(true));response.record.state='running';
check(!(await tools.get('execute_change_set').h(recoveryArgs(recoveryProposal(true)))).isError,'Pending cache delivery remains honestly running');calls=[];
error=Object.assign(new Error('private detail'),{code:'workflow_timeout'});
const uncertain=await tools.get('execute_change_set').h(input);check(uncertain.isError&&JSON.parse(uncertain.content[0].text).automatic_retry===false,'Uncertainty requires explicit reconciliation');
equal(calls.length,1);check(!uncertain.content[0].text.includes('private detail'),'No secret server error echo');calls=[];error=null;
for(const profile of ['core','specialist']){
  const server=new McpServer({name:'owned-redirect-bridge',version:'1'}),client=new Client({name:'Owned redirect client',version:'2'});
  registerWorkflowTools(server,transport,{capabilities:caps,profile});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{const listing=await client.listTools();equal(listing.tools.length,profile==='core'?12:20);check(JSON.stringify(listing).length<16000,'Existing catalog budget');
    response=reply('executed');check(!(await client.callTool({name:'execute_change_set',arguments:input})).isError,'Real SDK invocation');
    const sent=calls.pop();equal(sent.body.confirmation.client,{name:'Owned redirect client',version:'2'});equal(sent.body.confirmation.acknowledgements,['redirect_deletion']);
  }finally{await client.close();await server.close();}
}
console.log(`PASS: ${checks} redirect/mixed execution and recovery bridge/SDK checks; native WordPress transport is a separate gate.`);
