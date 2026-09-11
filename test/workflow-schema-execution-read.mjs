/** Semantic read contract and capability boundaries; native WP/TLS is separate. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {validSchemaExecutionResponse} from '../src/schema-execution.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  execution='cccccccc-cccc-4ccc-8ccc-cccccccccccc',hash='a'.repeat(64),now=1800000000;
const itemId=n=>'dddddddd-dddd-4ddd-8ddd-'+String(n+1).padStart(12,'0');
const caps={schema_execution:{contract_version:1,available:false,read_available:true,rollback_available:false,recovery_available:false,
  operations:[],record_contract:'schema_execution_view_v1',private_proofs_omitted:true}};
function fixture(state='planned',count=1,inverse=false){
  const items=Array.from({length:count},(_,n)=>({item_id:itemId(n),operation:n?'meta.update':'schema.select',url:'https://owned.invalid/page-'+n,
    target:{post_id:n+1},fields:n?{meta_title:{mode:'set',value:'Reviewed title'}}:{primary_type:'Article'},
    before:{value:'old'},after:{value:'new'},...n?{}:{schema_comparison:{current_graph:[{'@type':'WebPage'}],proposed_graph:[{'@type':'Article'}],
      source_evidence:{job_id:other,capture_revision:'b'.repeat(64),captured_at:now-60,expires_at:now+600},
      frontend_output_verified:false,ownership_verified:false}},...inverse?{original_item_id:other,original_order:n,audit_id:n+1,original_operation:n?'meta.update':'schema.select'}:{}}));
  const plan={contract_version:2,change_set_id:id,kind:inverse?'rollback':'forward',revision:1,client_request_id:'owned-read-plan-001',risk:'review_required',
    warning_codes:['newer_changes_block_rollback'],required_scopes:['site:read','schema:write'],policy_version:inverse?'workflow-schema-rollback-1':'workflow-schema-execution-1',
    created_at:now,expires_at:now+600,result_semantics:inverse?'stored_values_restored_not_seo_outcome':'stored_values_not_seo_outcome',
    frontend_verification:'native_current_sample',execution_available:true,required_acknowledgements:[],
    binding:{installation_id:other,blog_id:1,operator_id:2,token_id:3,site_origin:'https://owned.invalid'},
    ...inverse?{reverses:{change_set_id:other,plan_hash:'b'.repeat(64),execution_id:execution,action_id:null}}
      :{origin:{kind:'user_request',reference:'owned synthetic request',summary:'Review schema'}},items};
  const approved=!['planned','expired'].includes(state);
  const registration=approved?{execution_id:execution,state,registered_at:now,lease_until:now+120,client_request_id:'owned-execute-read-001',
    attestation:{mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:hash,statement:'user approved in chat',attested_by_token_id:3,operator_id:2,
      change_set_id:id,client_request_id:'owned-execute-read-001',acknowledgements:[],provenance_asserted:true,human_verified:false,
      client:{name:'Owned read client',version:null},agent:{name:'unknown'}},budget:{version:1,window_start:now,operation_count:count,operator_limit:100}}:null;
  const results=items.map((i,n)=>!approved?null:{version:1,execution_id:execution,item_id:i.item_id,state:state==='running'?'pending':state==='failed'?'skipped':state==='partial'&&n?'skipped':'applied',
    attempts:['running','failed'].includes(state)||state==='partial'&&n?0:1,...['executed','partial'].includes(state)&&!(state==='partial'&&n)
      ?{audit_id:n+1,committed_at:now+1,changed:true,invalidation:'delivered',delivery:{attempts:1,last_attempt_at:now+1,status:'delivered',error_code:null}}:{}});
  return {contract_version:1,record:{state,plan_persisted:true,approval_recorded:approved,
    projection:{contract:'schema_execution_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'},
    envelope:{plan,plan_hash:hash,change_token:(inverse?'trsr1.':'trse1.')+'c'.repeat(64)},registration,item_results:results}};
}
let checks=0,calls=[],response=fixture(),error=null;
const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const transport={async get(path){calls.push({method:'GET',path});if(error)throw error;return response;},
  async post(path,body){calls.push({method:'POST',path,body});throw new Error('No writer in this fixture');}};
const registry=(capabilities=caps,options={})=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...options});return tools;};
const tools=registry(),read={kind:'execution',change_set_id:id};
for(const inverse of [false,true])for(const state of ['planned','expired','running','executed','partial','failed']){
  response=fixture(state,25,inverse);check(validSchemaExecutionResponse(response,id,hash),state+' full ordered 25-item record');
  const reply=await tools.get('get_changes').h(read);check(!reply.isError,'Read '+state);equal(JSON.parse(reply.content[0].text),response,'Exact semantic read, no item truncation');
  equal(calls.splice(0),[{method:'GET',path:'/changes/executions/'+id}],'Exactly one read, no source scan or writer');
}
// An inverse subset may contain only a field from an originally mixed schema set.
response=fixture('planned',2,true);response.record.envelope.plan.items.shift();response.record.item_results.shift();
check(validSchemaExecutionResponse(response),'Field-only schema-policy inverse remains readable');
response=fixture();response.record.envelope.plan.items[0].operation='schema_settings.update';response.record.envelope.plan.items[0].target={site:'current',sample_post_id:1};
check(validSchemaExecutionResponse(response),'Site-wide target remains explicit');
response=fixture();response.record.envelope.plan.items[0].operation='schema.detect';check(validSchemaExecutionResponse(response),'Detection result readable');
for(const op of ['redirect.delete','redirect.update','redirect.restore']){
  response=fixture('planned',2,true);const i=response.record.envelope.plan.items[1];
  delete i.url;delete i.fields;i.operation=op;i.original_operation=op==='redirect.restore'?'redirect.delete':op==='redirect.delete'?'redirect.create':op;
  i.target={original_redirect_id:7};i.assigned_id_required=op==='redirect.restore';
  i.before=op==='redirect.restore'?null:{id:7,source_url:'/old',target_url:'https://owned.invalid/new'};
  i.after=op==='redirect.delete'?null:{id:op==='redirect.restore'?null:7,source_url:'/old',target_url:'https://owned.invalid/original'};
  check(validSchemaExecutionResponse(response),'Inverse redirect has exact native rows, no invented page URL');
  const reply=await tools.get('get_changes').h(read);check(!reply.isError,'Mixed schema/redirect inverse readable');
  equal(JSON.parse(reply.content[0].text),response,'Preserve source/destination and assigned-ID requirement');calls=[];
  delete i.assigned_id_required;check(!validSchemaExecutionResponse(response),'Missing redirect restoration semantics refused');
}
const corruptions=[
  v=>v.record.envelope.plan_hash='wrong',v=>v.record.envelope.plan.change_set_id=other,
  v=>v.record.envelope.plan.policy_version='workflow-field-execution-1',v=>v.record.envelope.change_token='trce1.'+'c'.repeat(64),
  v=>v.record.envelope.plan.kind='rollback',v=>v.record.projection.private_proofs_omitted=false,
  v=>delete v.record.projection,v=>v.record.projection.plan_hash_scope='displayed_plan',
  v=>v.record.envelope.plan.schema_storage='private-canary',v=>v.record.envelope.plan.restoration='private-canary',
  v=>v.record.envelope.plan.items[0].dependencies={raw:'private-canary'},v=>v.record.envelope.plan.items[0].original_schema_storage='private-canary',
  v=>v.record.envelope.plan.items[0].schema_comparison.source_evidence.render_binding='private-canary',
  v=>v.record.envelope.plan.items[0].schema_comparison.ownership_verified=true,
  v=>v.record.envelope.plan.items[0].schema_comparison.frontend_output_verified=true,
  v=>v.record.envelope.plan.items[0].target.post_id={private:'private-canary'},
  v=>v.record.envelope.plan.items[1].item_id=itemId(0),v=>v.record.item_results.pop(),
  v=>v.record.registration.attestation.client.extra='private-canary',v=>v.record.registration.attestation.client.name={private:'private-canary'},
  v=>v.record.registration.attestation.agent.name='<script>',v=>v.record.registration.attestation.client.version='x'.repeat(41),
  v=>v.record.registration.attestation.human_verified=true,v=>v.record.registration.attestation.received_at=now,
  v=>delete v.record.registration.attestation.received_at,v=>v.record.registration.attestation.plan_hash='b'.repeat(64),
  v=>v.record.registration.attestation.operator_id++,v=>v.record.registration.attestation.attested_by_token_id++,
  v=>v.record.registration.attestation.acknowledgements=['site_wide_identity'],v=>v.record.registration.budget.operation_count--,
  v=>v.record.registration.private_native_context='private-canary',v=>v.record.item_results[0].delivery.result='private-canary',
  v=>v.record.item_results[0].item_id=other,v=>v.record.item_results[0].execution_id=other,
  v=>v.record.item_results[0].invalidation='pending',v=>v.record.item_results[0].audit_id=null,
  v=>v.record.item_results[0].attempts=2,v=>v.record.item_results[0]=null,
  v=>delete v.record.envelope.plan.required_scopes,v=>delete v.record.envelope.plan.created_at,
  v=>v.record.envelope.plan.expires_at=now,v=>v.record.envelope.plan.items[0].after.value='x'.repeat(1048576),
];
for(const corrupt of corruptions){
  response=fixture('executed',2);corrupt(response);check(!validSchemaExecutionResponse(response,id,hash),'Corrupted public contract rejected');
  const reply=await tools.get('get_changes').h(read);check(reply.isError,'Bridge refuses unverifiable response');
  check(!reply.content[0].text.includes('private-canary'),'No incompatible/private response echoed');equal(calls.splice(0).length,1,'No automatic retry');
}
const circular={};circular.self=circular;
for(const bad of [undefined,null,[],42,{},1n,circular])check(validSchemaExecutionResponse(bad)===false,'Malformed direct input returns false without throwing');
for(const modify of [v=>delete v.schema_execution,v=>v.schema_execution.read_available=false,v=>v.schema_execution.contract_version=2,
  v=>v.schema_execution.record_contract='unknown',v=>v.schema_execution.private_proofs_omitted=false]){
  const c=structuredClone(caps);modify(c);check((await registry(c).get('get_changes').h(read)).isError,'Missing semantic read capability rejected');equal(calls,[],'No unsupported read');
}
check((await registry(caps,{maintenanceOnly:true}).get('get_changes').h(read)).isError,'Maintenance-only grant is not schema history access');equal(calls,[]);
for(const [name,args] of [['get_changes',{...read,kind:'recovery'}],['get_changes',{...read,include_private_proofs:true}],
  ['execute_change_set',{change_set_id:id,change_token:'trse1.'+'c'.repeat(64),confirmation:{confirmed:true,plan_hash:hash}}],
  ['rollback_change_set',{change_set_id:id,client_request_id:'owned-read-inverse',item_ids:[itemId(0)]}],
  ['plan_changes',{schema_preview:{operation:'schema.detect',target:{post_id:1},fields:{source_job_id:other}}}]]){
  check((await tools.get(name).h(args)).isError,'Schema read cannot activate '+name);equal(calls,[],'No schema writer/source dispatch');
}
response=fixture();error=Object.assign(new Error('private-canary'),{code:'workflow_timeout'});
const uncertain=await tools.get('get_changes').h(read);check(uncertain.isError&&!uncertain.content[0].text.includes('private-canary'),'Read transport failure sanitized');
equal(JSON.parse(uncertain.content[0].text).automatic_retry,false);equal(calls.splice(0).length,1);error=null;
for(const profile of ['core','specialist']){
  const server=new McpServer({name:'owned-schema-read',version:'1'}),client=new Client({name:'Owned client',version:'1'});
  registerWorkflowTools(server,transport,{capabilities:caps,profile});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{const listing=await client.listTools();equal(listing.tools.length,profile==='core'?12:20);check(JSON.stringify(listing).length<16000,'Existing catalog budget');
    check(!(await client.callTool({name:'get_changes',arguments:read})).isError,'Real SDK accepts existing read selector');equal(calls.splice(0).length,1);
    check((await client.callTool({name:'get_changes',arguments:{...read,include_private_proofs:true}})).isError,'Real SDK rejects extra arguments');equal(calls,[]);
  }finally{await client.close();await server.close();}
}
console.log(`PASS: ${checks} semantic schema read, closed-response, capability and SDK checks; no schema writes activated.`);
