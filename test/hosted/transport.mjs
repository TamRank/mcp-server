import assert from 'node:assert/strict';
import { WorkflowClient } from '../../src/workflow-rest.js';
import { validateRestBase, workflowUrl } from '../../src/hosted/rest-base.js';
import { createStubVps } from './stub-vps.mjs';

const pretty = 'https://site.example.invalid/wp-json/tamrank/v2';
const queryBase = 'https://site.example.invalid/?rest_route=/tamrank/v2';
const id = '11111111-1111-4111-8111-111111111111';
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const fresh = (responses = [{body:{contract_version:2}}], options={}) => {
  const stub=createStubVps({responses});
  return {stub,client:new WorkflowClient({rest_base_url:pretty,rest_style:'pretty',hosted:true,transport:stub.transport,...options})};
};
assert.equal(workflowUrl(pretty,'pretty','/site/context').href, pretty+'/site/context');
assert.equal(workflowUrl(queryBase,'query','/cloud-links/identity').href,
  'https://site.example.invalid/?rest_route=%2Ftamrank%2Fv2%2Fcloud-links%2Fidentity');
const q=workflowUrl(queryBase,'query','/work-queue',{status:'open'});
assert.deepEqual(q.searchParams.getAll('rest_route'), ['/tamrank/v2/work-queue']);
assert.equal(q.searchParams.get('status'),'open');
for(const [base,style] of [[pretty+'?a=1','pretty'],[queryBase+'&a=1','query'],[queryBase+'&rest_route=/tamrank/v2','query'],
  ['https://user:pass@site.example.invalid/wp-json/tamrank/v2','pretty'],[pretty+'#x','pretty'],
  ['http://127.0.0.1/wp-json/tamrank/v2','pretty'],['http://site.example.invalid/wp-json/tamrank/v2','pretty']])
  assert.throws(()=>validateRestBase(base,style));
for(const path of ['/../site/context','/%2e%2e','//evil.example.invalid/%2f']) {
  const {client,stub}=fresh();await assert.rejects(client.get(path),{code:'invalid_route'});assert.equal(stub.calls.length,0);
}
{
 const {client,stub}=fresh();await assert.rejects(client.get('/site/context',{rest_route:'/escape'}),{code:'invalid_route'});assert.equal(stub.calls.length,0);
}
for (const [method,path,limit,version] of [['GET','/site/context',524288,2],['POST','/changes/proposals',1048576,2],
 ['GET','/changes/'+id,1048576,2],['POST','/changes/executions',1048576,1]]) {
 const {client,stub}=fresh([{body:{contract_version:version}}]);
 await client.request(method,path,{body:method==='POST'?{a:'é',b:1}:undefined});
 assert.equal(stub.calls.length,1);const call=stub.calls[0];
 assert.equal(call.responseByteLimit,limit);assert(call.timeoutMs<=30000);
 assert.equal(call.url,pretty+path);assert.equal(Object.keys(call).length,7);
 assert.equal(Object.hasOwn(call.headers,'Authorization'),false);
 assert.equal(new TextDecoder().decode(call.bodyBytes),method==='POST'?JSON.stringify({a:'é',b:1}):'');
}
{
 const {client,stub}=fresh();await assert.rejects(client.post('/changes/proposals',{text:'x'.repeat(1048576)}),{code:'workflow_request_limit'});assert.equal(stub.calls.length,0);
}
{
 const {client,stub}=fresh([{bodyBytes:new Uint8Array(524289)}]);await assert.rejects(client.get('/site/context'),{code:'workflow_response_limit'});assert.equal(stub.calls.length,1);
}
for(const status of [301,302,307,308]) {
 const {client,stub}=fresh([{status,body:{}}]);await assert.rejects(client.post('/changes/proposals',{}),{code:'workflow_redirect_refused'});assert.equal(stub.calls.length,1);
}
for(const response of [{failure:'timeout'},{failure:'network'},{status:401,html:'<html>WAF</html>'},{status:401,body:{code:'unknown',message:'no',data:{status:401}}}]) {
 const {client,stub}=fresh([response]);await assert.rejects(client.post('/changes/proposals',{}),e=>e.code==='site_unavailable'&&e.data.outcome_unknown===true&&e.data.retryable===false);assert.equal(stub.calls.length,1);
}
for(const path of ['/changes/proposals','/changes/executions']) {
 const {client,stub}=fresh([{status:404,body:{code:'change_plan_target_unavailable',message:'Target unavailable.',data:{status:404}}}]);
 await assert.rejects(client.post(path,{}),e=>e.code==='change_plan_target_unavailable'&&e.data.outcome_unknown===false
   &&e.data.retryable===false&&e.message==='Target unavailable.');
 assert.equal(stub.calls.length,1);
}
for(const response of [
 {status:404,body:{code:'change_plan_target_unavailable',message:'Target unavailable.',data:{status:500}}},
 {status:404,body:{code:'rest_no_route',message:'Route missing.',data:{status:404}}},
]) {
 const {client}=fresh([response]);
 await assert.rejects(client.post('/changes/executions',{}),e=>e.code==='site_unavailable'&&e.data.outcome_unknown===true);
}
{
 const {client}=fresh([{status:404,body:{code:'change_plan_target_unavailable',message:'Target unavailable.',data:{status:404}}}]);
 await assert.rejects(client.post('/changes/executions/'+id+'/execute',{}),e=>e.code==='site_unavailable'&&e.data.outcome_unknown===true);
}
{
 let calls=0;const client=new WorkflowClient({rest_base_url:pretty,rest_style:'pretty',hosted:true,timeoutMs:10,
 transport:{request(){calls++;return new Promise(()=>{});}}});
 await assert.rejects(client.post('/changes/proposals',{}),e=>e.code==='site_unavailable'&&e.data.outcome_unknown===true);assert.equal(calls,1);
}
{
 const {client}=fresh([{status:401,body:{code:'agent_token_revoked',message:'refused',data:{status:401}}}]);
 await assert.rejects(client.get('/site/context'),{code:'site_reconnect_required'});
}
{
 const {client}=fresh([{status:401,body:{code:'agent_token_revoked',message:'refused'}}]);
 await assert.rejects(client.get('/site/context'),{code:'site_unavailable'});
}
{
 const transport={request:async()=>({status:200,headers:{},bodyBytes:encode({contract_version:2,text:'tamrank_pat_synthetic secret-opaque'})}),
 redact:text=>text.replaceAll('secret-opaque','[redacted]')};
 const client=new WorkflowClient({rest_base_url:pretty,rest_style:'pretty',hosted:true,transport});
 assert.equal((await client.get('/site/context')).text,'[redacted] [redacted]');
}
console.log('PASS: full REST bases, namespace binding, seven-field transport, byte budgets, redaction, redirects, timeout and WRITE01/ERR02 transport halves.');
