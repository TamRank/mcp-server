import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {discoverWorkflows,maintenanceAcks} from '../src/scan-maintenance.js';
const id='11111111-1111-4111-8111-111111111111';
const input={execution_id:id,client_request_id:'close-fixture-0001',expected_runtime_hash:'a'.repeat(64),confirmation:{
  mode:'chat_attested',review_hash:'b'.repeat(64),confirmed:true,client:{name:'Fixture',version:null},agent:{name:'Test agent'},acknowledgements:maintenanceAcks}};
const caps={scan_maintenance:{available:true,read_available:true}};
function registry(options={}) {const calls=[],tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},
  {get:async(path,query)=>{calls.push({method:'GET',path,query});return {contract_version:2};},
    post:async(path,body)=>{calls.push({method:'POST',path,body});return {contract_version:2};}},
  {profile:'specialist',capabilities:caps,...options});return {calls,tools};}
test('Separate destructive closure; status stays read-only; core and legacy gain no writer',async()=>{
  const {tools,calls}=registry();assert.equal(tools.size,20);
  assert.equal(tools.get('close_scan').c.annotations.readOnlyHint,false);assert.equal(tools.get('close_scan').c.annotations.destructiveHint,true);
  assert.equal(tools.get('get_scan_status').c.annotations.readOnlyHint,true);
  await tools.get('get_scan_status').h({execution_id:id});await tools.get('close_scan').h(input);
  assert.deepEqual(calls,[{method:'GET',path:'/scans/maintenance/'+id,query:{}},{method:'POST',path:'/scans/maintenance/'+id,body:input}]);
  for(const profile of ['core','legacy'])assert.equal(registry({profile}).tools.has('close_scan'),false);
});
test('Exact bounded consent only; all malformed variants send nothing',async()=>{
  const {tools,calls}=registry();
  const bad=[{...input,force:true},{...input,execution_id:'../../x'},{...input,expected_runtime_hash:null},
    {...input,confirmation:{...input.confirmation,confirmed:false}},{...input,confirmation:{...input.confirmation,confirmed:'true'}},
    {...input,confirmation:{...input.confirmation,actor:1}},{...input,confirmation:{...input.confirmation,review_hash:'bad'}},
    {...input,confirmation:{...input.confirmation,acknowledgements:maintenanceAcks.slice(1)}},
    {...input,confirmation:{...input.confirmation,acknowledgements:[...maintenanceAcks].reverse()}},
    {...input,confirmation:{...input.confirmation,client:{name:'é'.repeat(41),version:null}}},
    {...input,confirmation:{...input.confirmation,agent:{name:'<bad>'}}},{...input,confirmation:{...input.confirmation,agent:{name:' '}}}];
  for(const value of bad)assert.equal((await tools.get('close_scan').h(value)).isError,true);
  for(const value of [{execution_id:id,type:'pagespeed'},{execution_id:id,proposal_id:id},{execution_id:id,confirmation:input.confirmation}])
    assert.equal((await tools.get('get_scan_status').h(value)).isError,true);
  assert.equal(calls.length,0);
});
test('Missing or stale advertised grants do not send closure',async()=>{
  for(const capabilities of [null,{}, {scan_maintenance:{read_available:true}}, {scan_maintenance:{available:false}}]){
    const {tools,calls}=registry({capabilities});assert.equal((await tools.get('close_scan').h(input)).isError,true);assert.equal(calls.length,0);
  }
});
test('Unpaid maintenance-only mode excludes every other operation',async()=>{
  const {tools,calls}=registry({maintenanceOnly:true});
  for(const [name,args] of [['get_site_context',{}],['start_scan',{mode:'preview',type:'pagespeed',post_ids:[1]}],['get_scan_status',{type:'pagespeed'}],['execute_change_set',{}]])
    assert.equal((await tools.get(name).h(args)).isError,true);
  assert.equal(calls.length,0);await tools.get('get_capabilities').h({});assert.equal(calls.pop().path,'/scans/maintenance/capabilities');
  assert.ok(!(await tools.get('get_scan_status').h({execution_id:id})).isError);
});
test('Discovery exception is explicit preview + specialist + licence denial only',async()=>{
  for(const code of ['pro_required','agent_token_revoked','agent_token_invalid','network_error','timeout']){
    const calls=[];const c={get:async path=>{calls.push(path);if(path==='/capabilities')throw Object.assign(new Error(),{code});return {contract_version:2,...caps};}};
    const d=await discoverWorkflows(c,{preview:true,profile:'specialist'});assert.equal(d.preflight.ok,code==='pro_required');assert.equal(d.maintenanceOnly,code==='pro_required');
    assert.equal(calls.length,code==='pro_required'?2:1);
  }
  for(const opts of [{preview:false,profile:'specialist'},{preview:true,profile:'core'},{preview:true,profile:'legacy'}]){
    let n=0;const d=await discoverWorkflows({get:async()=>{n++;throw Object.assign(new Error(),{code:'pro_required'});}},opts);
    assert.equal(d.preflight.ok,false);assert.equal(n,1);
  }
});
test('Real stdio SDK -> HTTP, both URL styles, no scan or silent replay',async()=>{
  let posts=0;const pat='tamrank_pat_synthetic_maintenance_only';const requests=[];
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture.invalid'),path=url.searchParams.get('rest_route') || url.pathname.replace(/^\/wp-json/,'');
    assert.equal(req.headers.authorization,'Bearer '+pat);requests.push(path);
    res.setHeader('Content-Type','application/json');
    if(path==='/tamrank/v2/capabilities'){res.statusCode=402;res.end(JSON.stringify({code:'pro_required'}));return;}
    if(path==='/tamrank/v2/scans/maintenance/capabilities'){res.end(JSON.stringify({contract_version:2,...caps}));return;}
    assert.equal(path,'/tamrank/v2/scans/maintenance/'+id);
    if(req.method==='POST'){let body='';for await(const part of req)body+=part;assert.deepEqual(JSON.parse(body),input);posts++;
      res.end(JSON.stringify({contract_version:2,state:'abandoned',outcome:'unknown',human_verified:false,provider_requested_this_call:false}));}
    else {assert.equal(req.method,'GET');res.end(JSON.stringify({contract_version:2,review_hash:input.confirmation.review_hash,targets:Array.from({length:50},(_,i)=>({measurement_id:i})),required_acknowledgements:maintenanceAcks}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{for(const style of ['pretty','query']){
    const client=new Client({name:'fixture-maintenance-client',version:'1.0.0'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd:process.cwd(),stderr:'pipe',
        env:{PATH:process.env.PATH,TAMRANK_PAT:pat,TAMRANK_SITE_URL:'http://127.0.0.1:'+server.address().port,TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_REST_STYLE:style}}));
      const listing=await client.listTools();assert.equal(listing.tools.length,20);const size=JSON.stringify(listing).length;
      assert.ok(size<16000,`Specialist surface ${size}`);console.log(`Maintenance surface: ${size} characters (12 core / 20 specialist / 42 legacy).`);
      const review=await client.callTool({name:'get_scan_status',arguments:{execution_id:id}});assert.equal(JSON.parse(review.content[0].text).targets.length,50);
      const n=requests.length;assert.equal((await client.callTool({name:'close_scan',arguments:{...input,force:true}})).isError,true);assert.equal(requests.length,n);
      const result=await client.callTool({name:'close_scan',arguments:input});assert.equal(JSON.parse(result.content[0].text).outcome,'unknown');
      assert.equal((await client.callTool({name:'get_site_context',arguments:{}})).isError,true);
    }finally{await client.close();}
  }assert.equal(posts,2);}finally{await new Promise(resolve=>server.close(resolve));}
});
