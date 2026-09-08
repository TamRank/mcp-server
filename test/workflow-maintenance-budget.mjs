import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {WorkflowClient,rateLimitAdvice} from '../src/workflow-rest.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {discoverWorkflows} from '../src/scan-maintenance.js';
test('Only bounded wait guidance, never arbitrary server data or automatic retry',()=>{
  for(const retry_after of [null,0,-1,3601,'60',NaN,Infinity,true])assert.equal(rateLimitAdvice({retry_after}),undefined);
  assert.deepEqual(rateLimitAdvice({retry_after:60,secret:'ignore',automatic_retry:true}),{retry_after:60,automatic_retry:false});
});
test('REST 429 passes bounded advice to MCP without repeating a read or closure',async()=>{
  let requests=0;
  const http=createServer((req,res)=>{requests++;res.writeHead(429,{'Content-Type':'application/json','Retry-After':'42'});
    res.end(JSON.stringify({code:'scan_maintenance_rate_limit',message:'Wait before trying again.',data:{retry_after:42,secret:'never expose'}}));});
  await new Promise(r=>http.listen(0,'127.0.0.1',r));
  try {
    for(const routeStyle of ['pretty','query']) {
      const tools=new Map();registerWorkflowTools({registerTool:(name,config,handler)=>tools.set(name,handler)},
        new WorkflowClient({siteUrl:'http://127.0.0.1:'+http.address().port,pat:'synthetic',routeStyle}),
        {profile:'specialist',capabilities:{scan_maintenance:{available:true,read_available:true}}});
      const id='11111111-1111-4111-8111-111111111111';
      const {maintenanceAcks}=await import('../src/scan-maintenance.js');
      for(const [name,input] of [['get_scan_status',{execution_id:id}],['close_scan',{execution_id:id,client_request_id:'budget-fixture-1',expected_runtime_hash:'a'.repeat(64),
        confirmation:{mode:'chat_attested',review_hash:'b'.repeat(64),confirmed:true,client:{name:'Synthetic',version:null},agent:{name:'Test'},acknowledgements:maintenanceAcks}}]]) {
        const before=requests,result=await tools.get(name)(input),data=JSON.parse(result.content[0].text);
        assert.equal(result.isError,true);assert.equal(data.retry_after,42);assert.equal(data.automatic_retry,false);
        assert.equal(data.secret,undefined);assert.equal(requests,before+1);
      }
    }
  } finally {await new Promise(r=>http.close(r));}
});
test('Throttled discovery stays closed and reports waiting, not a licence upgrade',async()=>{
  let requests=0;
  const transport={get:async path=>{requests++;throw Object.assign(new Error(),path==='/capabilities'?{code:'pro_required',status:402}:{code:'scan_maintenance_rate_limit',status:429,data:{retry_after:30}});}};
  const discovery=await discoverWorkflows(transport,{preview:true,profile:'specialist'});
  assert.equal(discovery.preflight.ok,false);assert.equal(discovery.maintenanceOnly,false);assert.equal(discovery.preflight.retry_after,30);
  const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,h)},transport,{profile:'specialist',...discovery});
  const result=await tools.get('get_capabilities')({}),data=JSON.parse(result.content[0].text);
  assert.equal(result.isError,true);assert.equal(data.code,'scan_maintenance_rate_limit');assert.equal(data.retry_after,30);assert.equal(requests,2);
});
