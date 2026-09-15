/** Strict recovery mapping and SDK checks; fake HTTP is not native WP evidence. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {fieldRecoveryAcks,validRecoveryProposal} from '../src/field-recovery.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hash='a'.repeat(64),original='b'.repeat(64);
const proposal={plan:{contract_version:1,policy_version:'workflow-field-recovery-1',
  binding:{installation_id:id,blog_id:1,operator_id:2,token_id:3,site_origin:'https://synthetic.invalid'},
  change_set_id:id,original_plan_hash:original,execution_id:other,original_token_id:4,expected_state_hash:'c'.repeat(64),
  created_at:1800000000,expires_at:1800000900,items:[
    {item_id:id,operation:'meta.update',target:{post_id:1},url:'https://synthetic.invalid/a',stored_state:'applied',disposition:'retain_applied'},
    {item_id:other,operation:'image_alt.update',target:{attachment_id:2},url:'https://synthetic.invalid/b',stored_state:'pending',disposition:'skip_pending'}],
  website_writes:0,required_acknowledgements:fieldRecoveryAcks,approval_recorded:false,execution_available:false},
  plan_hash:hash,recovery_token:'trfr1.'+'d'.repeat(64)};
const input={change_set_id:id,change_token:proposal.recovery_token,recovery_plan:proposal.plan,
  confirmation:{plan_hash:hash,confirmed:true,acknowledgements:fieldRecoveryAcks}};
const caps={field_execution:{contract_version:1,available:true,read_available:true,recovery_available:true,
  operations:['meta.update','social.update','image_alt.update']}};
const reply=()=>({contract_version:1,record:{state:'partial',envelope:{plan:{change_set_id:id,policy_version:'workflow-field-execution-1'},plan_hash:original},
  registration:{recovery:{plan_hash:hash,attestation:{human_verified:false}}}}});
let checks=0,calls=[],response=reply(),error=null;
const check=(v,label)=>{checks++;assert.ok(v,label);};
const transport={async post(path,body){calls.push({path,body});if(error)throw error;return response;},
  async get(path){calls.push({path});return response;}};
function registry(capabilities=caps,options={}){
  const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...options});return tools;
}
const tools=registry();
response={contract_version:1,recovery_proposal:proposal};
check(!(await tools.get('get_changes').h({change_set_id:id,kind:'recovery'})).isError,'Read-only stop preview');
assert.deepEqual(calls.pop(),{path:'/changes/executions/'+id+'/recovery-proposals',body:{change_set_id:id}});checks++;
check(tools.get('get_changes').c.annotations.readOnlyHint,'Stateless recovery preview stays read-only');
response=reply();
check(!(await tools.get('execute_change_set').h(input)).isError,'Explicit exact recovery dispatch');
const sent=calls.pop();
check(sent.path==='/changes/executions/'+id+'/recover','Recovery never uses the field-write route');
assert.deepEqual(sent.body.proposal,proposal);checks++;
check(sent.body.client_request_id==='mcp-recover-'+hash,'Stable recovery request identity');
check(sent.body.confirmation.mode==='chat_attested'&&sent.body.confirmation.client.name==='unknown','Bounded attestation, no claimed human verification');
assert.deepEqual(sent.body.confirmation.acknowledgements,fieldRecoveryAcks);checks++;
await tools.get('execute_change_set').h(input);assert.deepEqual(calls.pop(),sent);checks++;
for(const edit of [a=>a.confirmation.confirmed=false,a=>a.confirmation.acknowledgements=[],
  a=>a.confirmation.acknowledgements=[...fieldRecoveryAcks].reverse(),a=>a.confirmation.acknowledgements=['wrong','wrong'],
  a=>a.confirmation.client={name:'spoof'},a=>a.confirmation.transcript='private',a=>a.change_set_id=other,
  a=>a.change_token='trce1.'+'d'.repeat(64),a=>delete a.recovery_plan,a=>a.recovery_plan.website_writes=1,
  a=>a.recovery_plan.items[1].target={post_id:2},a=>a.recovery_plan.items[1].disposition='retain_applied',
  a=>a.recovery_plan.items.reverse(),a=>a.recovery_plan.items[1].item_id=id,a=>a.recovery_plan.items.pop(),
  a=>a.recovery_plan.expires_at++,a=>a.recovery_plan.extra='unknown',a=>a.client_request_id='invented']){
  const bad=structuredClone(input);edit(bad);
  check((await tools.get('execute_change_set').h(bad)).isError,'Malformed/changed recovery refused');
  check(calls.length===0,'Rejected input sends nothing');
}
for(const support of [null,{}, {field_execution:{...caps.field_execution,contract_version:2}},
  {field_execution:{...caps.field_execution,recovery_available:false}}, {field_execution:{...caps.field_execution,read_available:false}}]){
  for(const [name,args]of [['execute_change_set',input],['get_changes',{change_set_id:id,kind:'recovery'}]]){
    check((await registry(support).get(name).h(args)).isError,'Missing capability cannot recover');check(calls.length===0,'No fallback');
  }
}
check((await registry(caps,{maintenanceOnly:true}).get('execute_change_set').h(input)).isError,'Maintenance-only cannot recover');check(calls.length===0,'No request');
const recoveryOnly=registry({field_execution:{...caps.field_execution,available:false}});
check(!(await recoveryOnly.get('execute_change_set').h(input)).isError,'Recovery available without granting new field execution');calls=[];
check((await recoveryOnly.get('execute_change_set').h({change_set_id:id,change_token:'trce1.'+hash,confirmation:{plan_hash:hash,confirmed:true}})).isError,'Recovery capability never grants field execution');check(calls.length===0,'No write sent');
for(const edit of [a=>a.contract_version=2,a=>a.record.state='executed',a=>a.record.envelope.plan_hash=hash,
  a=>a.record.envelope.plan.change_set_id=other,a=>a.record.registration.recovery.plan_hash=original,
  a=>a.record.registration.recovery.attestation.human_verified=true]){
  response=reply();edit(response);check((await tools.get('execute_change_set').h(input)).isError,'Wrong result cannot report success');
  check(calls.length===1,'Incompatible result is not retried');calls=[];
}
error=Object.assign(new Error('private server detail'),{code:'workflow_timeout'});
const uncertain=await tools.get('execute_change_set').h(input);
check(uncertain.isError&&JSON.parse(uncertain.content[0].text).automatic_retry===false,'Uncertainty requires explicit readback');
check(calls.length===1&&!uncertain.content[0].text.includes('private server detail'),'No retry or private error echo');calls=[];error=null;
response=reply();response.record={state:'partial',history:{kind:'field_execution_history',change_set_id:id,original_plan_hash:original,
  execution:{recovery:{plan_hash:hash,attestation:{human_verified:false,attribution_removed_at:1800000500}}}}};
check((await tools.get('execute_change_set').h(input)).isError,'Incomplete historical recovery is refused; complete minimal histories are covered separately');calls=[];
check(!validRecoveryProposal({...proposal,plan:{...proposal.plan,required_acknowledgements:[...fieldRecoveryAcks].reverse()}}),'Returned acknowledgements must match order');
const server=new McpServer({name:'recovery-fixture',version:'1'}),client=new Client({name:'Owned client',version:'2'});
registerWorkflowTools(server,transport,{capabilities:caps});
const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
try{
  response=reply();check(!(await client.callTool({name:'execute_change_set',arguments:input})).isError,'Real SDK recovery call');
  const actual=calls.pop();assert.deepEqual(actual.body.confirmation.client,{name:'Owned client',version:'2'});checks++;
  check(actual.body.confirmation.agent.name==='unknown','No invented agent identity');
  check((await client.callTool({name:'execute_change_set',arguments:{...input,confirmation:{...input.confirmation,human_verified:true}}})).isError,'SDK rejects false verification claim');
  check(calls.length===0,'SDK rejection makes no request');
}finally{await client.close();await server.close();}
console.log(`PASS: ${checks} recovery bridge/SDK checks; native WordPress transport remains a separate gate.`);
