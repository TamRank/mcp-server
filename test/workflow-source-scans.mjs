import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {discoverWorkflows} from '../src/scan-maintenance.js';
import {sourceAcks,sourceProbeAcks,sourceArgs} from '../src/source-scans.js';
import {workflowIdentity} from '../src/workflow-identity.js';
const id='11111111-1111-4111-8111-111111111111';
const hash='a'.repeat(64),support={available:true,read_available:true,execute_available:true,modes:['preview','plan','run']};
const preview={type:'schema_source',mode:'preview',post_ids:[123]};
const plan={...preview,mode:'plan',expected_revision:hash,client_request_id:'source-plan-0001'};
const run={type:'schema_source',mode:'run',source_job_id:id,client_request_id:'source-run-0001',
  confirmation:{plan_hash:hash,confirmed:true,agent:'Synthetic agent',acknowledgements:sourceAcks}};
function registry(opts={}){
  const calls=[],tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},
    {get:async(path,query)=>{calls.push(['GET',path,query]);return {contract_version:2};},post:async(path,body)=>{calls.push(['POST',path,body]);return {contract_version:2};}},
    {profile:'specialist',capabilities:{schema_source_jobs:support},...opts});return {calls,tools};
}
test('Existing tools support preview, plan, one-shot run and private own read',async()=>{
  const {tools,calls}=registry();assert.equal(tools.size,20);assert.equal(tools.get('start_scan').c.annotations.readOnlyHint,false);
  assert.equal(tools.get('get_scan_status').c.annotations.readOnlyHint,true);
  for(const a of [preview,plan,run])assert.ok(!(await tools.get('start_scan').h(a)).isError);
  assert.ok(!(await tools.get('get_scan_status').h({type:'schema_source',proposal_id:id})).isError);
  assert.deepEqual(calls,[['GET','/scans/sources/preview',{post_id:123}],['POST','/scans/sources/proposals',sourceArgs(plan)],
    ['POST','/scans/sources/'+id+'/run',sourceArgs(run)],['GET','/scans/sources/'+id,undefined]]);
  assert.deepEqual(calls[2][2].confirmation.client,workflowIdentity);
  assert.equal(calls[2][2].confirmation.mode,'chat_attested');assert.deepEqual(calls[2][2].confirmation.agent,{name:'Synthetic agent'});
  for(const profile of ['core','legacy'])assert.equal(registry({profile}).tools.has('start_scan'),false);
});
test('Strict exact confirmation and mode boundaries send no malformed request',async()=>{
  const {tools,calls}=registry();
  for(const a of [{...preview,post_ids:[1,2]},{...preview,post_ids:[]},{...preview,expected_revision:hash},
    {...preview,confirmation:run.confirmation},{...plan,client_request_id:undefined},{...plan,expected_revision:undefined},
    {...run,post_ids:[123]},{...run,expected_revision:hash},{...run,source_job_id:'../../x'},
    {...run,confirmation:undefined},{...run,confirmation:{...run.confirmation,confirmed:false}},
    {...run,confirmation:{...run.confirmation,plan_hash:'invalid'}},{...run,confirmation:{...run.confirmation,agent:'<script>'}},
    {...run,confirmation:{...run.confirmation,agent:'é'.repeat(41)}},{...run,confirmation:{...run.confirmation,client:{name:'spoof'}}},
    {...run,confirmation:{...run.confirmation,acknowledgements:[...sourceAcks].reverse()}},
    {...run,type:'pagespeed'},{...preview,url:'http://other.invalid'}, {...run,transport:{}}, {...run,force:true}])
    assert.equal((await tools.get('start_scan').h(a)).isError,true,JSON.stringify(a));
  for(const a of [{type:'schema_source'},{type:'schema_source',source_job_id:id},{type:'schema_source',proposal_id:id,execution_id:id},
    {type:'schema_source',proposal_id:id,confirmation:run.confirmation},{type:'schema_source',proposal_id:id,expected_ref:'stored:'+'a'.repeat(32)}])
    assert.equal((await tools.get('get_scan_status').h(a)).isError,true);
  assert.equal(calls.length,0);
});
test('Site support, per-mode permissions and no-PRO maintenance cannot imply acquisition',async()=>{
  for(const opts of [{capabilities:null},{capabilities:{}},{maintenanceOnly:true},{preflight:{ok:false}},
    {capabilities:{schema_source_jobs:{...support,execute_available:false}}},{capabilities:{schema_source_jobs:{...support,modes:['preview','plan']}}}]){
    const {tools,calls}=registry(opts);assert.equal((await tools.get('start_scan').h(run)).isError,true);assert.equal(calls.length,0);
  }
  const r=registry({capabilities:{schema_source_jobs:{...support,execute_available:false,modes:['preview','plan']}}});
  assert.ok(!(await r.tools.get('start_scan').h(plan)).isError);
});
test('Discovery is passive and never bypasses primary authentication failure',async()=>{
  for(const code of ['agent_token_revoked','network_error','pro_required']){
    const calls=[];const d=await discoverWorkflows({get:async path=>{calls.push(path);throw Object.assign(new Error(),{code});}},
      {preview:true,profile:'specialist'});assert.equal(d.preflight.ok,false);assert.ok(!calls.includes('/scans/sources/capabilities'));
  }
  const calls=[];const d=await discoverWorkflows({get:async path=>{calls.push(path);if(path==='/capabilities')return {contract_version:2};
    if(path==='/scans/sources/capabilities')return {contract_version:2,schema_source_jobs:support};throw new Error();}},
    {preview:true,profile:'specialist'});
  assert.deepEqual(d.capabilities.schema_source_jobs,support);assert.equal(calls.filter(p=>p==='/scans/sources/capabilities').length,1);
});
test('Native acquisition and extra content consent require explicit capabilities and exact inputs',async()=>{
  const nativeSupport={...support,capture_modes:['source','native_render'],probe_content_available:true};
  const nativePreview={...preview,capture_mode:'native_render'};
  const nativePlan={...plan,capture_mode:'native_render',probe_content:true};
  const probeRun={...run,confirmation:{...run.confirmation,acknowledgements:sourceProbeAcks}};
  const {tools,calls}=registry({capabilities:{schema_source_jobs:nativeSupport}});
  for(const a of [nativePreview,nativePlan,probeRun])assert.ok(!(await tools.get('start_scan').h(a)).isError);
  assert.deepEqual(calls[0],['GET','/scans/sources/preview',{post_id:123,capture_mode:'native_render'}]);
  assert.deepEqual(calls[1],['POST','/scans/sources/proposals',{post_id:123,capture_mode:'native_render',
    client_request_id:plan.client_request_id,expected_revision:hash,probe_content:true}]);
  assert.deepEqual(calls[2][2].confirmation.acknowledgements,sourceProbeAcks);
  assert.equal(calls[2][2].capture_mode,undefined,'Run uses immutable stored plan, not a new capture choice');
  const before=calls.length;
  for(const a of [{...preview,probe_content:true},{...nativePreview,probe_content:true},{...plan,probe_content:true},
    {...nativePlan,probe_content:false},{...nativePreview,capture_mode:'source'},
    {...probeRun,capture_mode:'native_render'},{...probeRun,probe_content:true},
    {...nativePlan,type:'pagespeed'},{...probeRun,confirmation:{...probeRun.confirmation,acknowledgements:[...sourceAcks,sourceAcks[0]]}}])
    assert.equal((await tools.get('start_scan').h(a)).isError,true,JSON.stringify(a));
  assert.equal(calls.length,before);
  for(const caps of [support,{...nativeSupport,capture_modes:['source']},{...nativeSupport,probe_content_available:false}]){
    const r=registry({capabilities:{schema_source_jobs:caps}});
    assert.equal((await r.tools.get('start_scan').h(nativePlan)).isError,true);assert.equal(r.calls.length,0);
  }
  const r=registry({capabilities:{schema_source_jobs:{...nativeSupport,probe_content_available:false}}});
  assert.equal((await r.tools.get('start_scan').h(probeRun)).isError,true);assert.equal(r.calls.length,0);
});
test('Actual stdio -> HTTP: both URL styles, bound client identity and no uncertain auto-retry',async()=>{
  const pat='tamrank_pat_owned_source_fixture';let requests=[],executions=0,stored=false;
  let expectedPreview=preview,expectedPlan=plan,expectedRun=run;
  const nativeSupport={...support,capture_modes:['source','native_render'],probe_content_available:true};
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://fixture.invalid'),path=u.searchParams.get('rest_route')||u.pathname.replace(/^\/wp-json/,'');
    assert.equal(req.headers.authorization,'Bearer '+pat);requests.push([req.method,path]);res.setHeader('Content-Type','application/json');
    const send=v=>res.end(JSON.stringify({contract_version:2,...v}));
    if(path==='/tamrank/v2/capabilities')return send({});
    if(path==='/tamrank/v2/scans/sources/capabilities')return send({schema_source_jobs:nativeSupport});
    if(path==='/tamrank/v2/scans/maintenance/capabilities'){res.statusCode=403;return send({code:'scope'});}
    if(path==='/tamrank/v2/scans/sources/preview'){assert.equal(req.method,'GET');assert.equal(u.searchParams.get('post_id'),'123');
      assert.equal(u.searchParams.get('capture_mode'),expectedPreview.capture_mode??null);assert.equal(u.searchParams.get('probe_content'),null);
      return send({source:{revision:hash}});}
    if(path==='/tamrank/v2/scans/sources/'+id){assert.equal(req.method,'GET');return send({state:stored?'received':'planned',plan_hash:hash});}
    let body='';for await(const part of req)body+=part;const value=JSON.parse(body);assert.equal(req.method,'POST');
    if(path==='/tamrank/v2/scans/sources/proposals'){assert.deepEqual(value,sourceArgs(expectedPlan));return send({plan:{job_id:id},plan_hash:hash});}
    assert.equal(path,'/tamrank/v2/scans/sources/'+id+'/run');assert.deepEqual(value,sourceArgs(expectedRun));
    if(!stored){stored=true;executions++;res.statusCode=503;return send({code:'schema_capture_commit_uncertain'});}
    return send({state:'received'});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{for(const style of ['pretty','query'])for(const capture of ['source','native','native-probe']){
    expectedPreview={...preview,...(capture!=='source'?{capture_mode:'native_render'}:{})};
    expectedPlan={...plan,...(capture!=='source'?{capture_mode:'native_render'}:{}),...(capture==='native-probe'?{probe_content:true}:{})};
    expectedRun={...run,confirmation:{...run.confirmation,acknowledgements:capture==='native-probe'?sourceProbeAcks:sourceAcks}};
    stored=false;requests=[];const client=new Client({name:'Owned source client',version:'1'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd:process.cwd(),stderr:'pipe',
        env:{PATH:process.env.PATH,TAMRANK_PAT:pat,TAMRANK_SITE_URL:'http://127.0.0.1:'+server.address().port,TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style}}));
      assert.deepEqual(client.getServerVersion(),workflowIdentity);
      const listing=await client.listTools();assert.equal(listing.tools.length,20);assert.ok(JSON.stringify(listing).length<16000);
      for(const a of [expectedPreview,expectedPlan])assert.ok(!(await client.callTool({name:'start_scan',arguments:a})).isError);
      const before=requests.length;const uncertain=await client.callTool({name:'start_scan',arguments:expectedRun});
      assert.equal(uncertain.isError,true);assert.equal(requests.length,before+1,'No second send or hidden reconciliation read');
      const read=await client.callTool({name:'get_scan_status',arguments:{type:'schema_source',proposal_id:id}});
      assert.equal(JSON.parse(read.content[0].text).state,'received');
      assert.ok(!(await client.callTool({name:'start_scan',arguments:expectedRun})).isError,'Explicit exact replay returns stored receipt');
    }finally{await client.close();}
  }assert.equal(executions,6);}finally{await new Promise(r=>server.close(r));}
});
