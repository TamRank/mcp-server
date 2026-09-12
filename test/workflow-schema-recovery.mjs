/** Closed schema recovery contract and real SDK transport; native WP is separate. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {schemaOperations,validSchemaExecutionResponse} from '../src/schema-execution.js';
import {fieldRecoveryAcks,recoveryInput} from '../src/field-recovery.js';
import {redirectDeliveryAcks} from '../src/redirect-execution.js';
import {validSchemaRecoveryProposal,validSchemaRecoveryInput,validSchemaRecoveryResult} from '../src/schema-recovery.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',installation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  execution='cccccccc-cccc-4ccc-8ccc-cccccccccccc',hash='a'.repeat(64),original='b'.repeat(64),now=1800000000;
const uuid=n=>'dddddddd-dddd-4ddd-8ddd-'+String(n+1).padStart(12,'0');
const support={contract_version:1,available:false,read_available:true,rollback_available:false,recovery_available:true,
  recovery_contract:'schema_journal_recovery_v1',record_contract:'schema_execution_view_v1',private_proofs_omitted:true,operations:[]};
const caps={schema_execution:support};
function fixture(operations=['schema.select','meta.update'],applied=1,inverse=false){
  const pending=applied<operations.length;
  const items=operations.map((operation,n)=>({item_id:uuid(n),operation,
    target:operation==='schema_settings.update'?{site:'current',sample_post_id:n+1}:operation.startsWith('redirect.')?
      (inverse?{original_redirect_id:n+1}:operation==='redirect.create'?{source_url:'/source-'+n}:{redirect_id:n+1}):
      operation==='image_alt.update'?{attachment_id:n+1}:{post_id:n+1},
    ...operation.startsWith('redirect.')?{source_url:'/source-'+n,actual_redirect_id:n<applied?n+1:null}:{url:'https://owned.invalid/page-'+n},
    stored_state:n<applied?'applied':'pending',disposition:n<applied?'retain_applied':'skip_pending'}));
  const plan={contract_version:1,policy_version:'workflow-schema-recovery-1',source_policy:inverse?'workflow-schema-rollback-1':'workflow-schema-execution-1',
    recovery_mode:pending?'stop_pending':'delivery_only',binding:{installation_id:installation,blog_id:1,operator_id:2,token_id:4,site_origin:'https://owned.invalid'},
    change_set_id:id,original_plan_hash:original,execution_id:execution,original_token_id:3,expected_state_hash:'c'.repeat(64),
    created_at:now+1000,expires_at:now+1900,items,website_writes:0,required_acknowledgements:pending?fieldRecoveryAcks:redirectDeliveryAcks,
    approval_recorded:false,execution_available:false};
  const proposal={plan,plan_hash:hash,recovery_token:'trscr1.'+'d'.repeat(64)};
  return {proposal,input:{change_set_id:id,change_token:proposal.recovery_token,recovery_plan:plan,
    confirmation:{plan_hash:hash,confirmed:true,acknowledgements:plan.required_acknowledgements}}};
}
function result(f){
  const p=f.proposal.plan,inverse=p.source_policy==='workflow-schema-rollback-1',items=p.items.map((i,n)=>({item_id:i.item_id,operation:i.operation,target:structuredClone(i.target),
    ...i.url?{url:i.url}:inverse?{assigned_id_required:i.operation==='redirect.restore'}:{url:'https://owned.invalid'+i.source_url},fields:{},
    before:{value:'old',...i.source_url?{source_url:i.source_url}:{}},after:{value:'new',...i.source_url?{source_url:i.source_url}:{}},
    ...schemaOperations.includes(i.operation)?{schema_comparison:{current_graph:[],proposed_graph:[],source_evidence:{job_id:installation,capture_revision:hash,
      captured_at:now-60,expires_at:now+840},frontend_output_verified:false,ownership_verified:false}}:{},
    ...inverse?{original_item_id:uuid(n+30),original_order:n,audit_id:n+1,original_operation:i.operation}:{} }));
  const stored={contract_version:2,change_set_id:id,kind:inverse?'rollback':'forward',revision:1,client_request_id:'owned-schema-recovery-fixture',risk:'review_required',
    warning_codes:[],required_scopes:['site:read','schema:write'],policy_version:p.source_policy,created_at:now,expires_at:now+600,
    result_semantics:'stored_values_not_seo_outcome',frontend_verification:'native_current_sample',execution_available:true,required_acknowledgements:[],
    binding:{...p.binding,token_id:3},...inverse?{reverses:{change_set_id:installation,plan_hash:hash,execution_id:execution,action_id:null}}:
      {origin:{kind:'user_request',reference:'owned request',summary:'Review schema'}},items};
  const state=p.recovery_mode==='delivery_only'?'executed':p.items.some(i=>i.stored_state==='applied')?'partial':'failed';
  const stub=(h,token,request,acks)=>({mode:'chat_attested',received_at:'2027-01-15T08:00:00+00:00',plan_hash:h,statement:'user approved in chat',
    attested_by_token_id:token,operator_id:2,change_set_id:id,client_request_id:request,acknowledgements:acks,provenance_asserted:true,human_verified:false,
    client:{name:'Owned client',version:null},agent:{name:'unknown'}});
  const registration={execution_id:execution,state,registered_at:now,lease_until:now+120,client_request_id:'owned-schema-execution',
    attestation:stub(original,3,'owned-schema-execution',[]),budget:{version:1,window_start:now,operation_count:items.length,operator_limit:100},
    recovery:{version:3,policy_version:'workflow-schema-recovery-1',recovery_mode:p.recovery_mode,plan_hash:hash,at:now+1001,
      client_request_id:'mcp-recover-'+hash,attestation:stub(hash,4,'mcp-recover-'+hash,p.required_acknowledgements)}};
  return {contract_version:1,record:{state,plan_persisted:true,approval_recorded:true,
    projection:{contract:'schema_execution_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'},
    envelope:{plan:stored,plan_hash:original,change_token:(inverse?'trsr1.':'trse1.')+'c'.repeat(64)},registration,
    item_results:p.items.map((i,n)=>({version:1,execution_id:execution,item_id:i.item_id,state:i.stored_state==='applied'?'applied':'skipped',
      attempts:i.stored_state==='applied'?1:0,...i.stored_state==='applied'?{audit_id:n+1,committed_at:now+1,changed:true,invalidation:'delivered',
        ...i.source_url?{redirect_result:{redirect_id:i.actual_redirect_id,before:null,after:null}}:{}}:{}}))}};
}
let checks=0,calls=[],response,error;
const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const transport={async post(path,body){calls.push({path,body});if(error)throw error;return response;}};
const registry=(capabilities=caps,options={})=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...options});return tools;};
const cases=[];
for(const inverse of [false,true])for(const operations of [['schema.select'],['schema.detect','meta.update'],['schema_settings.update','social.update','image_alt.update'],
  ['schema.detect','redirect.create','redirect.update','redirect.delete'],['schema.select',...Array(24).fill('meta.update')],Array(25).fill('schema.select'),
  ...inverse?[['meta.update','image_alt.update'],['redirect.restore']]:[]])for(const applied of [...new Set([0,1,operations.length])]){
  const f=fixture(operations,applied,inverse);cases.push(f);
  check(validSchemaRecoveryProposal(f.proposal,id),'All ordered participants and both recovery modes');
  check(validSchemaRecoveryInput(recoveryInput(f.input)),'Closed exact fresh consent');
  response=result(f);check(validSchemaExecutionResponse(response),`Full semantic execution fixture: ${inverse}/${applied}/${operations.join(',')}`);
  check(validSchemaRecoveryResult(response,f.proposal),'Exact source policy, actor, receipt and per-item dispositions');
}
const f=fixture();
for(const edit of [p=>p.website_writes=1,p=>p.execution_available=true,p=>p.approval_recorded=true,p=>p.expires_at++,
  p=>p.policy_version='workflow-redirect-recovery-1',p=>p.source_policy='workflow-field-execution-1',p=>p.items[0].target={sample_post_id:1,site:'current'},
  p=>p.items[0].native_proof='private',p=>p.items[1].target={attachment_id:2},p=>p.items.reverse(),p=>p.items[1].item_id=p.items[0].item_id,
  p=>p.items[0].disposition='skip_pending',p=>p.items[1].disposition='retain_applied',p=>p.items=[],p=>p.items.push(...Array(25).fill(p.items[0])),
  p=>p.required_acknowledgements=redirectDeliveryAcks,p=>p.recovery_mode='delivery_only',p=>p.extra=true]){
  const bad=structuredClone(f.proposal);edit(bad.plan);check(!validSchemaRecoveryProposal(bad),'Malformed or unsafe server recovery proposal rejected');
}
for(const edit of [r=>r.state='executed',r=>r.envelope.plan.policy_version='workflow-schema-rollback-1',r=>r.envelope.plan.binding.blog_id++,
  r=>r.registration.execution_id=installation,r=>r.registration.recovery.version=2,r=>r.registration.recovery.plan_hash=original,
  r=>r.registration.recovery.attestation.attested_by_token_id=3,r=>r.registration.recovery.attestation.acknowledgements=[],
  r=>r.registration.recovery.client_request_id='different-request',r=>r.registration.recovery.at=now,r=>r.envelope.plan.items[0].url='https://other.invalid/page',
  r=>r.item_results[1].state='applied',r=>r.item_results[1].attempts=1,
  r=>r.envelope.plan.items[0].target.post_id++,r=>r.registration.recovery.attestation.human_verified=true]){
  const bad=result(f);edit(bad.record);check(!validSchemaRecoveryResult(bad,f.proposal),'Wrong receipt or unexpected write cannot claim recovery success');
}
if(!process.argv.includes('--bridge')){console.log(`PASS: ${checks} schema recovery semantic checks; route integration not covered (pending --bridge).`);process.exit(0);}
const tools=registry();
for(const f of cases){
  response={contract_version:1,recovery_proposal:f.proposal};
  check(!(await tools.get('get_changes').h({kind:'recovery',change_set_id:id})).isError,'Read-only schema recovery preview');
  equal(calls.splice(0),[{path:'/changes/executions/'+id+'/recovery-proposals',body:{change_set_id:id}}]);
  response=result(f);check(!(await tools.get('execute_change_set').h(f.input)).isError,'Recovery-only capability can recover');
  const sent=calls.pop();equal(sent.path,'/changes/executions/'+id+'/recover');equal(sent.body.proposal,f.proposal);
  equal(sent.body.confirmation.acknowledgements,f.proposal.plan.required_acknowledgements);
  check(!Object.hasOwn(sent.body,'items')&&!Object.hasOwn(sent.body,'source_jobs'),'No website values or scan dispatch');
  await tools.get('execute_change_set').h(f.input);equal(calls.splice(0),[sent],'Exact request identity on explicit retry');
}
check(tools.get('get_changes').c.annotations.readOnlyHint,'Recovery proposal has no mutation hint');
for(const edit of [a=>a.confirmation.confirmed=false,a=>a.confirmation.acknowledgements=[],a=>a.confirmation.acknowledgements.reverse(),
  a=>a.confirmation.plan_hash='invalid',a=>a.confirmation.transcript='private',a=>a.confirmation.client={name:'spoof'},
  a=>a.change_set_id=installation,a=>a.change_token='trse1.'+hash,a=>delete a.recovery_plan]){
  const bad=structuredClone(f.input);edit(bad);check((await tools.get('execute_change_set').h(bad)).isError,'No implicit or mismatched approval');equal(calls,[]);
}
for(const key of ['recovery_available','read_available','private_proofs_omitted','record_contract','recovery_contract','contract_version']){
  const bad=structuredClone(caps);delete bad.schema_execution[key];
  for(const [name,args]of [['get_changes',{kind:'recovery',change_set_id:id}],['execute_change_set',f.input]]){
    check((await registry(bad).get(name).h(args)).isError,'Incomplete readiness is unavailable');equal(calls,[]);
  }
}
check((await registry(caps,{maintenanceOnly:true}).get('execute_change_set').h(f.input)).isError,'Scan maintenance cannot recover website executions');equal(calls,[]);
check((await tools.get('execute_change_set').h({change_set_id:id,change_token:'trse1.'+hash,confirmation:{confirmed:true,plan_hash:hash,acknowledgements:[]}})).isError,'Recovery is not forward-write permission');equal(calls,[]);
response={contract_version:1,recovery_proposal:{...f.proposal,recovery_token:'trrr1.'+hash}};
check((await tools.get('get_changes').h({kind:'recovery',change_set_id:id})).isError,'Wrong recovery policy never falls back');equal(calls.splice(0).length,1);
error=Object.assign(new Error('private diagnostic'),{code:'workflow_timeout'});
const uncertain=await tools.get('execute_change_set').h(f.input);check(uncertain.isError&&JSON.parse(uncertain.content[0].text).automatic_retry===false,'Uncertain result requires readback');
equal(calls.splice(0).length,1);check(!uncertain.content[0].text.includes('private diagnostic'),'No private error echo');error=null;
for(const profile of ['core','specialist']){
  const server=new McpServer({name:'schema-recovery-fixture',version:'1'}),client=new Client({name:'Owned recovery client',version:'2'});
  registerWorkflowTools(server,transport,{capabilities:caps,profile});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{response=result(f);check(!(await client.callTool({name:'execute_change_set',arguments:f.input})).isError,'Real SDK recovery mapping');
    const sent=calls.pop();equal(sent.body.confirmation.client,{name:'Owned recovery client',version:'2'});equal(sent.body.confirmation.agent,{name:'unknown'});
    equal((await client.listTools()).tools.length,profile==='core'?12:20);
  }finally{await client.close();await server.close();}
}
console.log(`PASS: ${checks} schema recovery semantic/bridge/SDK checks; native WordPress recovery transport remains separate.`);
