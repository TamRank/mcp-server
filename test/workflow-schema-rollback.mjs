/** Public inverse mapping/SDK contract; actual WordPress authority is tested separately. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {schemaOperations,validSchemaExecutionResponse} from '../src/schema-execution.js';
import {validSchemaRollbackInput,validSchemaRollbackPreview,matchesSchemaRollbackRequest} from '../src/schema-rollback.js';
import {validRedirectExecutionResponse} from '../src/redirect-execution.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',set='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  execution='cccccccc-cccc-4ccc-8ccc-cccccccccccc',hash='a'.repeat(64),revision='b'.repeat(64),now=1800000000;
const uuid=(n,prefix='d')=>prefix.repeat(8)+'-'+prefix.repeat(4)+'-4'+prefix.repeat(3)+'-8'+prefix.repeat(3)+'-'+String(n+1).padStart(12,'0');
const support={contract_version:1,available:true,read_available:true,rollback_available:true,rollback_preview_available:true,
  rollback_preview_contract:'schema_rollback_preview_v1',recovery_available:false,record_contract:'schema_execution_view_v1',private_proofs_omitted:true,
  operations:[...schemaOperations,'meta.update','social.update','image_alt.update','redirect.create','redirect.update','redirect.delete']};
const caps={schema_execution:support,field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true},
  redirect_execution:{contract_version:1,available:true,read_available:true,rollback_available:true}};
function fixture(operations=['schema.select']){
  const items=operations.map((original_operation,n)=>{
    const schema=schemaOperations.includes(original_operation),redirect=original_operation.startsWith('redirect.');
    const operation=({'redirect.create':'redirect.delete','redirect.delete':'redirect.restore'}[original_operation]??original_operation);
    return {original_item_id:uuid(n),original_order:n,audit_id:n+1,original_operation,operation,
      target:redirect?{original_redirect_id:n+10}:operation==='schema_settings.update'?{site:'current',sample_post_id:n+1}:
        operation==='image_alt.update'?{attachment_id:n+1}:{post_id:n+1},
      before:operation==='redirect.restore'?null:{value:'new'},after:operation==='redirect.delete'?null:{value:'old'},
      ...redirect?{assigned_id_required:operation==='redirect.restore'}:{url:'https://owned.invalid/page-'+n},
      ...!schema&&!redirect?{fields:{title:{mode:'set',value:'old'}}}:{},
      ...schema?{schema_comparison:{current_graph:[{'@type':'Article'}],proposed_graph:[{'@type':'WebPage'}],
        source_evidence:{job_id:uuid(n,'e'),capture_revision:'c'.repeat(64),captured_at:now-60,expires_at:now+840},
        frontend_output_verified:false,ownership_verified:false}}:{}};
  }).reverse();
  const source_jobs=Object.fromEntries(items.filter(i=>schemaOperations.includes(i.operation)).map(i=>[i.original_item_id,
    {job_id:i.schema_comparison.source_evidence.job_id,revision:i.schema_comparison.source_evidence.capture_revision}]));
  const input={change_set_id:id,item_ids:items.map(i=>i.original_item_id).reverse(),source_jobs};
  const comparison={contract:'schema_rollback_preview_v1',change_set_id:id,original_plan_hash:hash,revision,
    revision_scope:'complete_native_comparison',private_proofs_omitted:true,items,
    proposal_input:{...structuredClone(input),expected_revision:revision},expires_at:Object.keys(source_jobs).length?now+840:null,
    plan_persisted:false,approval_recorded:false,execution_available:false,provider_requested_this_call:false,frontend_output_verified:false,ownership_verified:false};
  return {input,preview:{contract_version:1,comparison},proposal:{...comparison.proposal_input,client_request_id:'owned-inverse-request-001'}};
}
function record(f,state='planned'){
  const approved=state!=='planned',items=f.preview.comparison.items.map((i,n)=>({item_id:uuid(n,'f'),...structuredClone(i)}));
  const acks=[...new Set(items.flatMap(i=>i.operation==='schema.select'?['replace_manual_schema']:i.operation==='schema_settings.update'?['site_wide_identity']:
    i.operation==='redirect.delete'?['redirect_deletion']:[]))].sort();
  const plan={contract_version:2,change_set_id:set,kind:'rollback',revision:1,client_request_id:f.proposal.client_request_id,
    policy_version:'workflow-schema-rollback-1',risk:'review_required',warning_codes:['newer_changes_block_rollback'],
    required_scopes:['site:read','changes:write','audit:read','rollback'],created_at:now,expires_at:now+600,
    result_semantics:'stored_values_restored_not_seo_outcome',frontend_verification:Object.keys(f.input.source_jobs).length?'native_current_sample':'not_performed',
    execution_available:true,required_acknowledgements:acks,comparison_revision:revision,
    binding:{installation_id:id,blog_id:1,operator_id:2,token_id:3,site_origin:'https://owned.invalid'},
    reverses:{change_set_id:id,plan_hash:hash,execution_id:execution,action_id:null},items};
  const registration=approved?{execution_id:execution,state,registered_at:now,lease_until:now+120,client_request_id:'mcp-execute-'+hash,
    attestation:{mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'user approved in chat',attested_by_token_id:3,operator_id:2,
      change_set_id:set,client_request_id:'mcp-execute-'+hash,acknowledgements:acks,provenance_asserted:true,human_verified:false,
      client:{name:'Owned rollback client',version:'1'},agent:{name:'unknown'}},budget:{version:1,window_start:now,operation_count:items.length,operator_limit:100}}:null;
  return {contract_version:1,record:{state,plan_persisted:true,approval_recorded:approved,
    projection:{contract:'schema_execution_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'},
    envelope:{plan,plan_hash:hash,change_token:'trsr1.'+'c'.repeat(64)},registration,
    item_results:items.map(i=>!approved?null:{version:1,execution_id:execution,item_id:i.item_id,state:'applied',attempts:1,audit_id:i.audit_id+100,
      committed_at:now+1,changed:true,invalidation:'delivered',delivery:{attempts:1,last_attempt_at:now+1,status:'delivered',error_code:null}})}};
}
const execute=f=>({change_set_id:set,change_token:'trsr1.'+'c'.repeat(64),confirmation:{plan_hash:hash,confirmed:true,
  acknowledgements:record(f).record.envelope.plan.required_acknowledgements}});
let checks=0,calls=[],response,error;
const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const transport={async post(path,body){calls.push({path,body});if(error)throw error;return response;}};
function registry(capabilities=caps,options={}){const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...options});return tools;}
const tools=registry();
for(const operations of [['schema.select'],['schema.detect'],['schema_settings.update'],['meta.update','social.update','image_alt.update'],
  ['redirect.create','redirect.update','redirect.delete'],['schema.select','meta.update','redirect.create','schema.detect'],
  ['schema.detect',...Array(24).fill('meta.update')],Array(25).fill('schema.select')]){
  const f=fixture(operations);response=f.preview;
  check(validSchemaRollbackInput(f.input)&&validSchemaRollbackInput(f.proposal),'Closed two-step inputs');
  check(validSchemaRollbackPreview(response,f.input),'Complete inverse comparison');
  check(!(await tools.get('rollback_change_set').h(f.input)).isError,'Preview can include every selected original item');
  equal(calls.splice(0),[{path:'/changes/executions/'+id+'/rollback-preview',body:f.input}],'Preview never persists or executes');
  response=record(f);check(validSchemaExecutionResponse(response)&&matchesSchemaRollbackRequest(response,f.proposal),'Exact semantic inverse proposal');
  check(!(await tools.get('rollback_change_set').h(f.proposal)).isError,'Proposal binds comparison revision and exact current source jobs');
  equal(calls.splice(0),[{path:'/changes/executions/'+id+'/rollback-proposals',body:f.proposal}]);
  response=record(f,'executed');check(!(await tools.get('execute_change_set').h(execute(f))).isError,'Fresh schema inverse approval');
  const sent=calls.pop();equal(sent.path,'/changes/executions/'+set+'/execute');
  equal(sent.body.confirmation.acknowledgements,execute(f).confirmation.acknowledgements);equal(sent.body.confirmation.agent,{name:'unknown'});
  check(!Object.hasOwn(sent.body,'items'),'Restore values never sent by agent');
  await tools.get('execute_change_set').h(execute(f));equal(calls.splice(0),[sent],'Retry reuses exact approval request');
}
const f=fixture(['schema.select','meta.update','redirect.create']);
const nativeGraph=structuredClone(f.preview);
for(const i of nativeGraph.comparison.items)if(i.schema_comparison)for(const side of ['current_graph','proposed_graph'])
  i.schema_comparison[side]={'@context':'https://schema.org','@graph':i.schema_comparison[side]};
check(validSchemaRollbackPreview(nativeGraph,f.input),'Actual WordPress @context/@graph output');
check(validSchemaRollbackPreview(nativeGraph,{...f.input,item_ids:[...f.input.item_ids].reverse()}),'Selection order canonicalized without losing native reverse item order');
const wrongGraph=structuredClone(nativeGraph);wrongGraph.comparison.items[2].schema_comparison.current_graph['@graph']=null;
check(!validSchemaRollbackPreview(wrongGraph,f.input),'Invalid native graph envelope refused');
for(const edit of [v=>v.item_ids=[],v=>v.item_ids.push(v.item_ids[0]),v=>v.item_ids.push(...Array(25).fill(uuid(24))),
  v=>v.source_jobs=[],v=>v.source_jobs[uuid(0)].revision='old',v=>v.source_jobs[uuid(0)].raw='private',v=>v.restore_values={},
  v=>v.expected_revision=revision,v=>v.client_request_id='request-with-no-revision']){
  const bad=structuredClone(f.input);edit(bad);check(!validSchemaRollbackInput(bad),'Invalid comparison input');
  check((await tools.get('rollback_change_set').h(bad)).isError,'Invalid preview sends nothing');equal(calls,[]);
}
for(const edit of [v=>delete v.expected_revision,v=>delete v.client_request_id,v=>v.expected_revision='old',v=>v.confirmation={confirmed:true},
  v=>v.source_jobs[uuid(0)].raw='private']){
  const bad=structuredClone(f.proposal);edit(bad);check(!validSchemaRollbackInput(bad),'Invalid stored inverse input');
  check((await tools.get('rollback_change_set').h(bad)).isError,'Invalid proposal sends nothing');equal(calls,[]);
}
for(const edit of [c=>c.change_set_id=set,c=>c.revision='old',c=>c.original_plan_hash='old',c=>c.proposal_input.expected_revision='d'.repeat(64),
  c=>c.plan_persisted=true,c=>c.approval_recorded=true,c=>c.execution_available=true,c=>c.provider_requested_this_call=true,
  c=>c.frontend_output_verified=true,c=>c.ownership_verified=true,c=>c.private_proofs_omitted=false,c=>c.native_proof='private-canary',
  c=>c.items.reverse(),c=>c.items.pop(),c=>c.items[1].audit_id=c.items[0].audit_id,c=>c.items[0].original_order=25,
  c=>c.items[0].original_operation='redirect.delete',c=>c.items[0].target={redirect_id:12},c=>c.items[0].assigned_id_required=true,
  c=>c.items[1].fields=null,c=>c.items[2].schema_comparison.source_evidence.expires_at++,c=>c.expires_at++,
  c=>c.items[2].schema_comparison.source_evidence.job_id=uuid(20),c=>c.items[2].schema_comparison.private_capture='private',
  c=>c.items[2].schema_comparison.proposed_graph=null]){
  response=structuredClone(f.preview);edit(response.comparison);check(!validSchemaRollbackPreview(response,f.input),'Corrupt preview closed');
  check((await tools.get('rollback_change_set').h(f.input)).isError,'Unverified comparison refused');equal(calls.splice(0).length,1,'No automatic retry');
}
for(const edit of [p=>p.reverses.change_set_id=set,p=>p.client_request_id='another-request-001',p=>p.comparison_revision='c'.repeat(64),
  p=>p.items.pop(),p=>p.items.reverse(),p=>p.items[0].original_item_id=uuid(20),p=>p.items[0].original_operation='redirect.delete',
  p=>p.items[2].schema_comparison.source_evidence.capture_revision='d'.repeat(64)]){
  response=record(f);edit(response.record.envelope.plan);check(!matchesSchemaRollbackRequest(response,f.proposal),'Inverse proposal bound to request');
  check((await tools.get('rollback_change_set').h(f.proposal)).isError,'Substituted proposal refused');equal(calls.splice(0).length,1);
}
// A separately valid redirect inverse must never satisfy a schema inverse request.
response={contract_version:1,record:{state:'planned',envelope:{plan:{contract_version:2,kind:'rollback',change_set_id:set,
  policy_version:'workflow-redirect-rollback-1',frontend_verification:'not_performed',required_acknowledgements:[],
  items:[{item_id:uuid(0),operation:'redirect.update'}]},plan_hash:hash,change_token:'trxr1.'+'c'.repeat(64)}}};
check(validRedirectExecutionResponse(response),'Realistic alternative-policy fixture');
check((await tools.get('rollback_change_set').h(f.proposal)).isError,'No redirect-policy fallback');equal(calls.splice(0).length,1);
for(const mutate of [c=>delete c.schema_execution,c=>c.schema_execution.rollback_available=false,c=>c.schema_execution.rollback_preview_available=false,
  c=>c.schema_execution.rollback_preview_contract='unknown',c=>c.schema_execution.private_proofs_omitted=false,c=>c.schema_execution.contract_version=2]){
  const c=structuredClone(caps);mutate(c);const limited=registry(c);
  for(const [name,args] of [['rollback_change_set',f.input],['rollback_change_set',f.proposal],['execute_change_set',execute(f)]]){
    check((await limited.get(name).h(args)).isError,'Inverse gate required');equal(calls,[]);}
}
for(const [name,args] of [['rollback_change_set',f.input],['rollback_change_set',f.proposal],['execute_change_set',execute(f)]]){
  check((await registry(caps,{maintenanceOnly:true}).get(name).h(args)).isError,'Maintenance-only does not expose inverse website writes');equal(calls,[]);
}
const inverseOnly=registry({schema_execution:{...support,available:false}});response=record(f,'executed');
check(!(await inverseOnly.get('execute_change_set').h(execute(f))).isError,'Inverse capability independent from forward');equal(calls.splice(0).length,1);
const forward={...execute(f),change_token:'trse1.'+'c'.repeat(64)};
check((await inverseOnly.get('execute_change_set').h(forward)).isError,'Inverse capability grants no forward writer');equal(calls,[]);
for(const edit of [a=>a.confirmation.confirmed=false,a=>delete a.confirmation.acknowledgements,a=>a.confirmation.acknowledgements=['invented'],
  a=>a.confirmation.acknowledgements=['redirect_deletion','redirect_deletion'],a=>a.confirmation.human_verified=true,
  a=>a.confirmation.client={name:'spoof'},a=>a.items=[],a=>a.change_token+='.'+'d'.repeat(64)]){
  const bad=execute(f);edit(bad);check((await tools.get('execute_change_set').h(bad)).isError,'Closed new approval');equal(calls,[]);
}
for(const edit of [r=>r.record.envelope.plan_hash='f'.repeat(64),r=>r.record.envelope.change_token='trsr1.'+'e'.repeat(64),
  r=>r.record.registration.attestation.human_verified=true,r=>{r.record.envelope.plan.required_acknowledgements=[];r.record.registration.attestation.acknowledgements=[];}]){
  response=record(f,'executed');edit(response);check((await tools.get('execute_change_set').h(execute(f))).isError,'Exact execution echo');equal(calls.splice(0).length,1);
}
response=record(f);check((await tools.get('execute_change_set').h(execute(f))).isError,'A proposal is not an executed inverse');equal(calls.splice(0).length,1);
error=Object.assign(new Error('private-canary'),{code:'workflow_timeout'});
const uncertain=await tools.get('rollback_change_set').h(f.proposal);check(uncertain.isError&&!uncertain.content[0].text.includes('private-canary'),'Safe uncertainty');
equal(JSON.parse(uncertain.content[0].text).automatic_retry,false);equal(calls.splice(0).length,1);error=null;
for(const profile of ['core','specialist']){
  const server=new McpServer({name:'owned-inverse',version:'1'}),client=new Client({name:'Owned rollback client',version:'1'});
  registerWorkflowTools(server,transport,{capabilities:caps,profile});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
    const listing=await client.listTools();equal(listing.tools.length,profile==='core'?12:20);check(JSON.stringify(listing).length<16000,'Bounded SDK catalog');
    for(const chosen of [f,fixture(['meta.update'])]){
      response=chosen.preview;check(!(await client.callTool({name:'rollback_change_set',arguments:chosen.input})).isError,'SDK comparison includes empty source_jobs object');calls=[];
      response=record(chosen);check(!(await client.callTool({name:'rollback_change_set',arguments:chosen.proposal})).isError,'SDK inverse proposal');calls=[];
      response=record(chosen,'executed');check(!(await client.callTool({name:'execute_change_set',arguments:execute(chosen)})).isError,'SDK inverse execution');
      equal(calls.pop().body.confirmation.client,{name:'Owned rollback client',version:'1'},'Client identity from handshake');
    }
  }finally{await client.close();await server.close();}
}
console.log(`PASS: ${checks} schema inverse comparison, exact proposal, approval, policy and SDK checks; native behavior remains a separate gate.`);
