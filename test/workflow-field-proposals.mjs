import assert from 'node:assert/strict';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {createServer} from 'node:http';
import {WorkflowClient} from '../src/workflow-rest.js';
let calls=[];
const caps={field_proposals:{available:true,read_available:true,contract_version:2,operations:['meta.update','image_alt.update'],origin_kinds:['user_request']}};
const registry=(capabilities=caps)=>{const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},
  {post:async(path,body)=>{calls.push({path,body});return {contract_version:2,execution_available:false};},get:async(path,query)=>{calls.push({path,query});return {contract_version:2};}},{capabilities});return tools;};
const request={client_request_id:'field-unit-0001',origin:{kind:'user_request',reference:'synthetic',summary:'Synthetic explicit request'},items:[
  {operation:'meta.update',target:{post_id:1},fields:{meta_title:{mode:'set',value:''},meta_description:{mode:'remove'}}},
  {operation:'image_alt.update',target:{attachment_id:2},fields:{alt_text:{mode:'set',value:'Café'}}}]};
const core=registry();assert.equal(core.get('plan_changes').c.annotations.readOnlyHint,false);
assert.equal(core.get('plan_changes').c.annotations.destructiveHint,false);
assert.equal(core.get('get_changes').c.annotations.readOnlyHint,true);
assert.ok(!(await core.get('plan_changes').h(request)).isError);assert.deepEqual(calls.pop(),{path:'/changes/proposals',body:request});
const id='12345678-1234-1234-1234-123456789abc';await core.get('get_changes').h({change_set_id:id});assert.deepEqual(calls.pop(),{path:'/changes/'+id,query:{}});
const variants=[{...request,execute:true},{...request,origin:{...request.origin,kind:'action'}},{...request,items:[]},
  {...request,items:Array(26).fill(request.items[0])},{...request,items:[request.items[0],request.items[0]]}];
for(const edit of [i=>i.operation='body.update',i=>i.target.attachment_id=3,i=>i.fields={},i=>i.fields.alt_text={mode:'set',value:'wrong'},
  i=>i.fields.meta_title={mode:'remove',value:''},i=>i.fields.meta_title={mode:'set'},i=>i.fields.meta_title={mode:'set',value:'<b>no</b>'},
  i=>i.fields.meta_title={mode:'set',value:'é'.repeat(501)},i=>i.target.post_id='1',i=>i.fields.unknown={mode:'set',value:'x'}]){
  const bad=structuredClone(request);edit(bad.items[0]);variants.push(bad);
}
for(const bad of variants){assert.equal((await core.get('plan_changes').h(bad)).isError,true);assert.equal(calls.length,0);}
for(const unsupported of [null,{}, {field_proposals:{...caps.field_proposals,available:false}},
  {field_proposals:{...caps.field_proposals,contract_version:1}},{field_proposals:{...caps.field_proposals,operations:['meta.update']}}]){
  assert.equal((await registry(unsupported).get('plan_changes').h(request)).isError,true);assert.equal(calls.length,0);
}
for(const bad of [{},{change_set_id:id,list:true},{change_set_id:'../unsafe'}]){
  assert.equal((await core.get('get_changes').h(bad)).isError,true);assert.equal(calls.length,0);
}
assert.equal((await registry({field_proposals:{...caps.field_proposals,read_available:false}}).get('get_changes').h({change_set_id:id})).isError,true);
assert.equal(calls.length,0);
console.log('PASS: exact typed field proposals/read mapping, scope gates, no execution, no invalid requests sent.');
let bytes=600000;
const http=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({contract_version:2,value:'x'.repeat(bytes)}));});
await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
try{
  const client=new WorkflowClient({siteUrl:'http://127.0.0.1:'+http.address().port,pat:'synthetic-only'});
  assert.equal((await client.get('/changes/'+id)).value.length,600000);
  assert.equal((await client.post('/changes/proposals',request)).value.length,600000);
  await assert.rejects(client.get('/pages'),e=>e.code==='workflow_response_limit');
  await assert.rejects(client.get('/changes/proposals'),e=>e.code==='workflow_response_limit');
  await assert.rejects(client.post('/changes/'+id,{}),e=>e.code==='workflow_response_limit');
  bytes=1048576;await assert.rejects(client.get('/changes/'+id),e=>e.code==='workflow_response_limit');
  console.log('PASS: bounded private-draft Unicode wire budget; ordinary read limits unchanged.');
}finally{await new Promise(resolve=>http.close(resolve));}
