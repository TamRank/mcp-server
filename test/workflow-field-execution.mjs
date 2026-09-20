/** Bridge/SDK mapping; injected HTTP results are not native WordPress evidence. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {confirmationBody,validExecutionResponse} from '../src/field-execution.js';
import {createServer} from 'node:http';
import {WorkflowClient} from '../src/workflow-rest.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',hash='a'.repeat(64);
const caps={field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,
  operations:['meta.update','social.update','image_alt.update']}};
const request={client_request_id:'owned-field-plan-001',origin:{kind:'user_request',reference:'synthetic',summary:'Owned synthetic proposal'},
  items:[{operation:'meta.update',target:{post_id:1},fields:{meta_title:{mode:'set',value:'Synthetic title'}}}]};
const execute={change_set_id:id,change_token:'trce1.'+'b'.repeat(64),confirmation:{plan_hash:hash,confirmed:true}};
const reply=(state='planned',policy='workflow-field-execution-1')=>({contract_version:1,record:{state,
  envelope:{plan:{change_set_id:id,policy_version:policy},plan_hash:hash}}});
let checks=0,calls=[],response=reply(),throwError=null;
const check=(ok,label)=>{checks++;assert.ok(ok,label);};
const transport={async post(path,body){calls.push({path,body});if(throwError)throw throwError;return response;},
  async get(path){calls.push({path});if(throwError)throw throwError;return response;}};
const registry=(capabilities=caps,extra={})=>{
  const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},transport,{capabilities,...extra});return tools;
};
const tools=registry();
check(!(await tools.get('plan_changes').h(request)).isError,'Executable fields use a new-policy proposal, without legacy draft support');
assert.deepEqual(calls.pop(),{path:'/changes/executions',body:request});checks++;
response=reply('executed');
check(!(await tools.get('execute_change_set').h(execute)).isError,'Exact confirmation dispatched');
const first=calls.pop();
check(first.path==='/changes/executions/'+id+'/execute','Canonical execute route');
check(first.body.client_request_id==='mcp-execute-'+hash,'Stable request identity derived from immutable proposal hash');
assert.deepEqual(first.body.confirmation,{...execute.confirmation,mode:'chat_attested',acknowledgements:[],
  client:{name:'unknown',version:null},agent:{name:'unknown'}});checks++;
await tools.get('execute_change_set').h(execute);assert.deepEqual(calls.pop(),first);checks++;
check(!(await tools.get('get_changes').h({change_set_id:id,kind:'execution'})).isError,'Explicit read-only reconciliation');
assert.deepEqual(calls.pop(),{path:'/changes/executions/'+id});checks++;
const rollback={change_set_id:id,client_request_id:'owned-rollback-plan-001',item_ids:[other]};
response=reply('planned','workflow-field-rollback-1');
check(!(await tools.get('rollback_change_set').h(rollback)).isError,'Rollback tool creates a new proposal, never runs it');
assert.deepEqual(calls.pop(),{path:'/changes/executions/'+id+'/rollback-proposals',body:rollback});checks++;
check(!tools.get('execute_change_set').c.annotations.readOnlyHint&&tools.get('execute_change_set').c.annotations.destructiveHint,'Executor has write annotations');
check(!tools.get('rollback_change_set').c.annotations.readOnlyHint&&!tools.get('rollback_change_set').c.annotations.destructiveHint,'Rollback planning is non-destructive');
check(tools.get('get_changes').c.annotations.readOnlyHint,'History stays read-only');
for(const edit of [a=>a.confirmation.confirmed=false,a=>a.confirmation.plan_hash='bad',a=>a.change_token='trcs1.'+'a'.repeat(64),
  a=>a.items=request.items,a=>a.client_request_id='invented-retry',a=>a.confirmation.client={name:'spoof'},
  a=>a.confirmation.mode='verified',a=>a.confirmation.acknowledgements=[],a=>a.change_set_id='../unsafe']){
  const bad=structuredClone(execute);edit(bad);
  check((await tools.get('execute_change_set').h(bad)).isError,'Invalid/overridden execution input rejected');check(calls.length===0,'Rejected input sends nothing');
}
for(const bad of [{...rollback,item_ids:[]},{...rollback,item_ids:[other,other]},{...rollback,confirmation:execute.confirmation}]){
  check((await tools.get('rollback_change_set').h(bad)).isError,'Invalid rollback selection rejected');check(calls.length===0,'Rejected rollback sends nothing');
}
for(const support of [null,{}, {field_execution:{...caps.field_execution,contract_version:2}},
  {field_execution:{...caps.field_execution,available:false}}]){
  check((await registry(support).get('execute_change_set').h(execute)).isError,'Unavailable execution never falls back');check(calls.length===0,'Unavailable sends nothing');
}
check((await registry(caps,{maintenanceOnly:true}).get('execute_change_set').h(execute)).isError,'Maintenance-only cannot execute');
check(calls.length===0,'Maintenance-only sends nothing');
for(const bad of [{},reply('invented'),{...reply(),contract_version:2},
  {contract_version:1,record:{...reply('executed').record,envelope:{plan:{change_set_id:other,policy_version:'workflow-field-execution-1'},plan_hash:hash}}}]){
  response=bad;check((await tools.get('execute_change_set').h(execute)).isError,'Incompatible response cannot report success');check(calls.length===1,'No automatic retry after incompatible response');calls=[];
}
throwError=Object.assign(new Error('Sensitive server detail'),{code:'workflow_timeout'});
const uncertain=await tools.get('execute_change_set').h(execute);
check(uncertain.isError&&JSON.parse(uncertain.content[0].text).automatic_retry===false,'Timeout requires reconciliation');
check(!uncertain.content[0].text.includes('Sensitive server detail')&&calls.length===1,'No unsafe error echo or automatic retry');calls=[];throwError=null;
const historical={contract_version:1,record:{state:'executed',history:{kind:'field_execution_history',change_set_id:id,original_plan_hash:hash}}};
check(!validExecutionResponse(historical,id,hash),'Incomplete unprojected historical records are refused; complete projected history has its own suite');
check(!validExecutionResponse(historical,other,hash),'Historical response remains set-bound');
for(const info of [{name:'<script>',version:'x'},{name:'é'.repeat(41),version:'x'},{name:'client\nname',version:null}])
  check(confirmationBody(execute,info).confirmation.client.name==='unknown','Unsafe/oversized provenance becomes explicitly unknown');
const server=new McpServer({name:'owned-workflow',version:'1'}),client=new Client({name:'Owned MCP client',version:'2.4'});
registerWorkflowTools(server,transport,{capabilities:caps});
const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
try{
  response=reply('executed');
  check(!(await client.callTool({name:'execute_change_set',arguments:execute})).isError,'Real SDK tool invocation');
  const sent=calls.pop();assert.deepEqual(sent.body.confirmation.client,{name:'Owned MCP client',version:'2.4'});checks++;
  check(sent.body.confirmation.agent.name==='unknown','No invented model/agent identity');
  check((await client.callTool({name:'execute_change_set',arguments:{...execute,confirmation:{...execute.confirmation,transcript:'private'}}})).isError,'SDK rejects extra confirmation fields');
  check(calls.length===0,'Invalid SDK input sends nothing');
}finally{await client.close();await server.close();}
// A separate owned loopback server verifies route-specific wire limits and that
// a failed POST is not retried. It does not stand in for WordPress execution.
let wireBytes=600000,requests=0,wireVersion=1;
const http=createServer((req,res)=>{requests++;res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({contract_version:wireVersion,value:'x'.repeat(wireBytes)}));});
await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
try{
  const wire=new WorkflowClient({siteUrl:'http://127.0.0.1:'+http.address().port,pat:'synthetic-only'});
  const routes=[['post','/changes/executions'],['get','/changes/executions/'+id],
    ['post','/changes/executions/'+id+'/execute'],['post','/changes/executions/'+id+'/rollback-proposals'],
    ['post','/changes/executions/'+id+'/recovery-proposals'],['post','/changes/executions/'+id+'/recover']];
  for(const [method,path]of routes)check((await wire[method](path,{})).value.length===wireBytes,'Execution route accepts bounded expanded response');
  for(const [method,path]of [['get','/changes/executions'],['post','/changes/executions/'+id],
    ['get','/changes/executions/'+id+'/execute'],['post','/changes/executions/not-a-uuid/execute']]){
    await assert.rejects(wire[method](path,{}),e=>e.code==='workflow_response_limit');checks++;
  }
  // Exactly one MiB is allowed; one extra byte
  // is rejected for every execution route, without a second HTTP attempt.
  wireBytes=1048576-Buffer.byteLength(JSON.stringify({contract_version:wireVersion,value:''}));
  for(const [method,path]of routes)check((await wire[method](path,{})).value.length===wireBytes,'Exact one MiB bound');
  wireBytes++;
  for(const [method,path]of routes){const before=requests;
    await assert.rejects(wire[method](path,{}),e=>e.code==='workflow_response_limit');checks++;
    check(requests===before+1,'Oversized response causes no automatic retry');
  }
  wireBytes=0;
  for(const path of ['/pages','/changes/'+id]){
    await assert.rejects(wire.get(path),e=>e.code==='workflow_upgrade_required');checks++;
  }
  wireVersion=2;
  for(const [method,path]of routes){
    await assert.rejects(wire[method](path,{}),e=>e.code==='workflow_upgrade_required');checks++;
  }
}finally{await new Promise(resolve=>http.close(resolve));}
console.log(`PASS: ${checks} field execution bridge/SDK/transport checks; native writes are covered separately.`);
