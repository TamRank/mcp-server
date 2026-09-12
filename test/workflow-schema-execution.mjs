/** Forward schema transport/validation; native WordPress behavior has a separate TLS suite. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {fieldOperations} from '../src/field-execution.js';
import {redirectOperations} from '../src/redirect-execution.js';
import {fieldRecoveryAcks} from '../src/field-recovery.js';
import {schemaOperations,validSchemaExecutionResponse,matchesSchemaExecutionRequest} from '../src/schema-execution.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  execution='cccccccc-cccc-4ccc-8ccc-cccccccccccc',hash='a'.repeat(64),now=1800000000;
const itemId=n=>'dddddddd-dddd-4ddd-8ddd-'+String(n+1).padStart(12,'0');
const support={contract_version:1,available:true,read_available:true,rollback_available:false,recovery_available:false,
  operations:[...schemaOperations,...fieldOperations,...redirectOperations],record_contract:'schema_execution_view_v1',private_proofs_omitted:true};
const caps={schema_execution:support};
const schemaItem=(operation='schema.select')=>({operation,target:operation==='schema_settings.update'?{site:'current',sample_post_id:1}:{post_id:1},
  fields:{source_job:{job_id:other,revision:'b'.repeat(64)},expected_revision:'d'.repeat(64),
    ...operation==='schema.select'?{main_type:'Article',extra_types:[],replace_manual:false}:
      operation==='schema_settings.update'?{fields:{organization_name:'Owned confirmed identity'},facts_confirmed:true}:{}}});
const request=(operation='schema.select',count=1)=>({client_request_id:'owned-schema-plan-001',
  origin:{kind:'user_request',reference:'owned synthetic request',summary:'Review exact schema'},
  items:[schemaItem(operation),...Array.from({length:count-1},(_,n)=>({operation:'meta.update',target:{post_id:n+2},fields:{meta_title:{mode:'set',value:'Owned title '+n}}}))]});
const acknowledgements=req=>req.items.flatMap(i=>i.operation==='schema_settings.update'?['site_wide_identity']:
  i.operation==='schema.select'&&i.fields.replace_manual?['replace_manual_schema']:i.operation==='redirect.delete'?['redirect_deletion']:[]).sort();
function fixture(req=request(),state='planned'){
  const acks=acknowledgements(req),approved=state!=='planned';
  const items=req.items.map((item,n)=>({...structuredClone(item),item_id:itemId(n),url:'https://owned.invalid/page-'+n,
    before:{value:'old'},after:{value:'new'},...schemaOperations.includes(item.operation)?{schema_comparison:{current_graph:[{'@type':'WebPage'}],
      proposed_graph:[{'@type':'Article'}],source_evidence:{job_id:other,capture_revision:'b'.repeat(64),captured_at:now-60,expires_at:now+600},
      frontend_output_verified:false,ownership_verified:false}}:{}}));
  const plan={contract_version:2,change_set_id:id,kind:'forward',revision:1,client_request_id:req.client_request_id,risk:'review_required',
    warning_codes:[],required_scopes:['site:read','schema:write','scans:plan'],policy_version:'workflow-schema-execution-1',created_at:now,expires_at:now+600,
    result_semantics:'stored_values_not_seo_outcome',frontend_verification:'native_current_sample',execution_available:true,required_acknowledgements:acks,
    binding:{installation_id:other,blog_id:1,operator_id:2,token_id:3,site_origin:'https://owned.invalid'},origin:structuredClone(req.origin),items};
  const registration=approved?{execution_id:execution,state,registered_at:now,lease_until:now+120,client_request_id:'mcp-execute-'+hash,
    attestation:{mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'user approved in chat',attested_by_token_id:3,operator_id:2,
      change_set_id:id,client_request_id:'mcp-execute-'+hash,acknowledgements:acks,provenance_asserted:true,human_verified:false,
      client:{name:'Owned schema client',version:'1'},agent:{name:'unknown'}},budget:{version:1,window_start:now,operation_count:items.length,operator_limit:100}}:null;
  return {contract_version:1,record:{state,plan_persisted:true,approval_recorded:approved,
    projection:{contract:'schema_execution_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'},
    envelope:{plan,plan_hash:hash,change_token:'trse1.'+'c'.repeat(64)},registration,
    item_results:items.map(i=>!approved?null:{version:1,execution_id:execution,item_id:i.item_id,state:'applied',attempts:1,audit_id:1,
      committed_at:now+1,changed:true,invalidation:'delivered',delivery:{attempts:1,last_attempt_at:now+1,status:'delivered',error_code:null}})}};
}
const input=req=>({change_set_id:id,change_token:'trse1.'+'c'.repeat(64),confirmation:{plan_hash:hash,confirmed:true,acknowledgements:acknowledgements(req)}});
let checks=0,calls=[],response=fixture(),error=null;
const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const transport={async post(path,body){calls.push({method:'POST',path,body});if(error)throw error;return response;},
  async get(path){calls.push({method:'GET',path});if(error)throw error;return response;}};
const registry=(capabilities=caps,options={})=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...options});return tools;};
const tools=registry();
for(const operation of schemaOperations)for(const count of operation==='schema_settings.update'?[1]:[1,25]){
  const req=request(operation,count);response=fixture(req);check(validSchemaExecutionResponse(response),'Valid complete fixture');
  const planned=await tools.get('plan_changes').h(req);check(!planned.isError,'Typed '+operation+' proposal');
  equal(JSON.parse(planned.content[0].text),response,'Complete semantic record, no four-item cap');
  equal(calls.splice(0),[{method:'POST',path:'/changes/executions',body:req}],'Exact native proposal, no scan or private-draft fallback');
  response=fixture(req,'executed');const reply=await tools.get('execute_change_set').h(input(req));
  check(!reply.isError,'Approved schema forward execution');equal(JSON.parse(reply.content[0].text),response);
  const sent=calls.pop();equal(sent.path,'/changes/executions/'+id+'/execute');
  equal(sent.body.confirmation.acknowledgements,acknowledgements(req));equal(sent.body.client_request_id,'mcp-execute-'+hash);
  equal(sent.body.confirmation.agent,{name:'unknown'});check(!Object.hasOwn(sent.body,'items'),'Execution sends no replacement item list');
  await tools.get('execute_change_set').h(input(req));equal(calls.splice(0),[sent],'Retry identity and approval payload stable');
}
const req=request('schema.select',3);req.items[0].fields.replace_manual=true;
req.items[2]={operation:'redirect.delete',target:{redirect_id:3},fields:{acknowledge_deletion:{mode:'set',value:true}}};
response=fixture(req);check(!(await tools.get('plan_changes').h(req)).isError,'Mixed schema/metadata/redirect is one native set');calls=[];
response=fixture(req,'executed');check(!(await tools.get('execute_change_set').h(input(req))).isError,'Multiple required acknowledgement kinds');
equal(calls.pop().body.confirmation.acknowledgements,['redirect_deletion','replace_manual_schema']);
check((await tools.get('plan_changes').h(request('schema_settings.update',2))).isError,'Site-wide identity remains a standalone explicit request');equal(calls,[]);
for(const edit of [v=>delete v.items[0].fields.expected_revision,v=>v.items[0].fields.graph=[],v=>v.items[0].target.post_id=2,
  v=>v.items[0].fields.facts_confirmed=false,v=>v.schema_storage={secret:'private-canary'},v=>v.items.push(...Array(24).fill(v.items[1])),
  v=>v.origin={kind:'user_request'},v=>v.items[0].fields.source_job.revision='old']){
  const bad=structuredClone(req);edit(bad);check((await tools.get('plan_changes').h(bad)).isError,'Malformed schema request refused');equal(calls,[],'No request sent');
}
for(const edit of [v=>delete v.confirmation.acknowledgements,v=>v.confirmation.acknowledgements=['site_wide_identity','site_wide_identity'],
  v=>v.confirmation.acknowledgements=['invented'],v=>v.confirmation.confirmed=false,v=>v.confirmation.plan_hash='bad',v=>v.confirmation.client={name:'spoof'},
  v=>v.confirmation.human_verified=true,v=>v.confirmation.transcript='private',v=>v.items=req.items,v=>v.recovery_plan={},
  v=>v.change_token='trsr1.'+'c'.repeat(64)]){
  const bad=input(req);edit(bad);check((await tools.get('execute_change_set').h(bad)).isError,'Malformed or unsupported consent refused');equal(calls,[],'No request sent');
}
for(const edit of [c=>delete c.schema_execution,c=>c.schema_execution.available=false,c=>c.schema_execution.contract_version=2,
  c=>c.schema_execution.record_contract='unknown',c=>c.schema_execution.private_proofs_omitted=false]){
  const c=structuredClone(caps);edit(c);check((await registry(c).get('execute_change_set').h(input(req))).isError,'Unavailable schema writer rejected');equal(calls,[]);
}
for(const operation of ['schema.select','meta.update','redirect.delete']){
  const c=structuredClone(caps);c.schema_execution.operations=c.schema_execution.operations.filter(o=>o!==operation);
  check((await registry(c).get('plan_changes').h(req)).isError,'Whole set requires every advertised operation');equal(calls,[],'No partial subset or downgrade');
}
for(const name of ['plan_changes','execute_change_set']){
  check((await registry(caps,{maintenanceOnly:true}).get(name).h(name==='plan_changes'?req:input(req))).isError,'Maintenance-only has no schema writer');equal(calls,[]);
}
// A schema-only capability must not activate old writers, rollback or recovery.
for(const prefix of ['trce1','trcr1','trcx1','trxr1','trfr1','trrr1','trsr1']){
  const bad=input(req);bad.change_token=prefix+'.'+'c'.repeat(64);
  check((await tools.get('execute_change_set').h(bad)).isError,'No unrelated '+prefix+' writer');equal(calls,[]);
}
check((await tools.get('rollback_change_set').h({change_set_id:id,client_request_id:'owned-inverse-001',item_ids:[itemId(0)]})).isError,'No public schema inverse yet');equal(calls,[]);
for(const edit of [v=>v.record.envelope.plan.items.reverse(),v=>v.record.envelope.plan.items[1].target.post_id++,
  v=>v.record.envelope.plan.items[1].fields.meta_title.value='different',v=>v.record.envelope.plan.origin.summary='Different request',
  v=>v.record.envelope.plan.client_request_id='another-request-001',v=>v.record.envelope.plan.items[0].fields.expected_revision='e'.repeat(64),
  v=>v.record.envelope.plan.items[0].schema_storage='private-canary']){
  response=fixture(req);edit(response);check((await tools.get('plan_changes').h(req)).isError,'Mismatched or private proposal refused');equal(calls.splice(0).length,1,'No automatic retry');
}
// Response type must match the route, even when the client also has field rights.
const mixedCaps={...caps,field_execution:{contract_version:1,available:true,read_available:true,operations:fieldOperations}};
response={contract_version:1,record:{state:'executed',envelope:{plan:{contract_version:2,change_set_id:id,policy_version:'workflow-field-execution-1'},plan_hash:hash}}};
for(const [name,args] of [['plan_changes',req],['execute_change_set',input(req)]]){
  check((await registry(mixedCaps).get(name).h(args)).isError,'Schema route cannot accept a field-only response');equal(calls.splice(0).length,1);
}
for(const edit of [v=>v.record.envelope.plan_hash='f'.repeat(64),v=>v.record.envelope.plan.change_set_id=other,
  v=>v.record.registration.attestation.human_verified=true,v=>v.record.envelope.change_token='trse1.'+'f'.repeat(64),
  v=>{v.record.envelope.plan.required_acknowledgements=[];v.record.registration.attestation.acknowledgements=[];}]){
  response=fixture(req,'executed');edit(response);check((await tools.get('execute_change_set').h(input(req))).isError,'Execution identity and approval remain exact');equal(calls.splice(0).length,1);
}
response=fixture(req);check((await tools.get('execute_change_set').h(input(req))).isError,'An unapproved plan is not an execution result');equal(calls.splice(0).length,1);
const allCaps={...caps,field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:true,operations:fieldOperations},
  redirect_execution:{contract_version:1,available:true,read_available:true,mixed_available:true,rollback_available:true,recovery_available:true,operations:[...fieldOperations,...redirectOperations]}};
const all=registry(allCaps);
for(const [prefix,policy] of [['trce1','workflow-field-execution-1'],['trcr1','workflow-field-rollback-1'],
  ['trcx1','workflow-redirect-execution-1'],['trxr1','workflow-redirect-rollback-1']]){
  const redirect=prefix==='trcx1'||prefix==='trxr1',inverse=prefix==='trcr1'||prefix==='trxr1';
  response={contract_version:1,record:{state:'executed',envelope:{plan:{contract_version:2,kind:inverse?'rollback':'forward',change_set_id:id,
    policy_version:policy,frontend_verification:'not_performed',required_acknowledgements:[],items:[{item_id:other,operation:redirect?'redirect.update':'meta.update'}]},
    plan_hash:hash,change_token:prefix+'.'+'c'.repeat(64)}}};
  const args={change_set_id:id,change_token:prefix+'.'+'c'.repeat(64),confirmation:{plan_hash:hash,confirmed:true,...redirect?{acknowledgements:[]}: {}}};
  check(!(await all.get('execute_change_set').h(args)).isError,'Schema support preserves existing '+prefix+' execution');equal(calls.splice(0).length,1);
}
const recovery={plan:{contract_version:1,policy_version:'workflow-field-recovery-1',binding:{installation_id:id,blog_id:1,operator_id:2,token_id:3,site_origin:'https://owned.invalid'},
  change_set_id:id,original_plan_hash:'b'.repeat(64),execution_id:execution,original_token_id:4,expected_state_hash:'c'.repeat(64),created_at:now,expires_at:now+900,
  items:[{item_id:other,operation:'meta.update',target:{post_id:1},url:'https://owned.invalid/a',stored_state:'pending',disposition:'skip_pending'}],
  website_writes:0,required_acknowledgements:fieldRecoveryAcks,approval_recorded:false,execution_available:false},plan_hash:hash,recovery_token:'trfr1.'+'d'.repeat(64)};
response={contract_version:1,record:{state:'failed',envelope:{plan:{change_set_id:id,policy_version:'workflow-field-execution-1'},plan_hash:'b'.repeat(64)},
  registration:{recovery:{plan_hash:hash,attestation:{human_verified:false}}}}};
const recovering={change_set_id:id,change_token:recovery.recovery_token,recovery_plan:recovery.plan,confirmation:{plan_hash:hash,confirmed:true,acknowledgements:fieldRecoveryAcks}};
check(!(await all.get('execute_change_set').h(recovering)).isError,'Schema support preserves separately approved field recovery');
equal(calls.pop().path,'/changes/executions/'+id+'/recover');
error=Object.assign(new Error('private-canary'),{code:'workflow_timeout'});
const uncertain=await tools.get('execute_change_set').h(input(req));check(uncertain.isError&&!uncertain.content[0].text.includes('private-canary'),'Sanitized uncertainty');
equal(JSON.parse(uncertain.content[0].text).automatic_retry,false);equal(calls.splice(0).length,1);error=null;
for(const profile of ['core','specialist']){
  const server=new McpServer({name:'owned-schema-bridge',version:'1'}),client=new Client({name:'Owned schema client',version:'1'});
  registerWorkflowTools(server,transport,{capabilities:caps,profile});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
    const listing=await client.listTools();equal(listing.tools.length,profile==='core'?12:20);check(JSON.stringify(listing).length<16000,'Bounded real catalog');
    response=fixture(req);check(!(await client.callTool({name:'plan_changes',arguments:req})).isError,'SDK supports complete typed proposal');calls=[];
    response=fixture(req,'executed');check(!(await client.callTool({name:'execute_change_set',arguments:input(req)})).isError,'SDK supports approved execution');
    equal(calls.pop().body.confirmation.client,{name:'Owned schema client',version:'1'},'Client provenance from handshake, not agent input');
  }finally{await client.close();await server.close();}
}
console.log(`PASS: ${checks} forward schema/mixed mapping, approval, capability, response and SDK checks; native WordPress is a separate suite.`);
