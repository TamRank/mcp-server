/** Strict bridge contract and real SDK/HTTP fixtures; no WordPress or real data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
const hash='a'.repeat(64),revision='b'.repeat(64),job_id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const support={contract_version:2,available:true,operations:['schema.select','schema.detect','schema_settings.update']};
const detect={operation:'schema.detect',target:{post_id:1},fields:{source_job:{job_id,revision:hash}}};
const select={...detect,operation:'schema.select',fields:{...detect.fields,main_type:'Article',extra_types:['FAQPage'],replace_manual:false}};
const identity={operation:'schema_settings.update',target:{site:'current',sample_post_id:1},
  fields:{source_job:{job_id,revision:hash},fields:{organization_name:'Fictief café',address:{city:'Teststad'}},facts_confirmed:true}};
const response=item=>structuredClone({contract_version:2,full_v2_compatible:false,comparison:{contract:'schema_selection_comparison_v1',operation:item.operation,revision,
  source_evidence:{render_binding:{current_graph_matches:true}},frontend_output_verified:false,ownership_verified:false,execution_available:false},
  proposal_item:{...item,fields:{...item.fields,expected_revision:revision}},plan_persisted:false,approval_recorded:false,
  provider_requested_this_call:false,execution_available:false,schema_proposals_available:false});
let sent=[],reply=response,checks=0;
const check=(value,message)=>{checks++;assert.ok(value,message);};
function registry(capabilities={schema_preview:support},extra={}){
  const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},
    {post:async(path,body)=>{sent.push({path,body});return reply(body);}}, {capabilities,...extra});return tools;
}
const tools=registry(),handler=tools.get('plan_changes').h;
for(const item of [detect,select,identity]){
  const before=structuredClone(item),r=await handler({schema_preview:item});
  check(!r.isError,'Typed preview accepted');assert.deepEqual(sent.pop(),{path:'/schema/preview',body:item});
  assert.deepEqual(item,before);check(JSON.parse(r.content[0].text).plan_persisted===false,'No saved-plan claim');
  check(!(await handler({schema_preview:{...item,fields:{...item.fields,expected_revision:revision}}})).isError,'Exact revision accepted');sent.pop();
}
for(const caps of [null,{}, {schema_preview:{...support,available:false}}, {schema_preview:{...support,contract_version:1}},
  {schema_preview:{...support,operations:'schema.detect'}},{schema_preview:{...support,operations:['schema.select']}}]){
  check((await registry(caps).get('plan_changes').h({schema_preview:detect})).isError,'Explicit compatible capability required');check(sent.length===0,'No unavailable request sent');
}
const invalid=[{schema_preview:detect,origin:{kind:'user_request'}},{schema_preview:detect,client_request_id:'invalid-mixed'},
  {schema_preview:detect,items:[]},{schema_preview:detect,execute:true},{schema_preview:{...detect,operation:'schema.raw'}},
  {schema_preview:{...select,fields:{...select.fields,extra_types:['FAQPage','FAQPage']}}},
  {schema_preview:{...select,fields:{...select.fields,replace_manual:'yes'}}},
  {schema_preview:{...identity,fields:{...identity.fields,facts_confirmed:false}}},
  {schema_preview:{...identity,fields:{...identity.fields,fields:{raw_json_ld:'{}'}}}},
  {schema_preview:{...identity,target:{post_id:1}}}];
for(const edit of [x=>x.fields.expected_revision=null,x=>x.fields.source_job.revision='wrong',x=>x.fields.main_type='Article',
  x=>x.target.post_id='1',x=>x.fields.raw_json_ld={},x=>x.fields.source_job.actor_id=1]){
  const item=structuredClone(detect);edit(item);invalid.push({schema_preview:item});
}
for(const input of invalid){check((await handler(input)).isError,'Malformed or mixed operation refused');check(sent.length===0,'No invalid request sent');}
for(const edit of [x=>x.plan_persisted=true,x=>x.approval_recorded=true,x=>x.execution_available=true,
  x=>delete x.provider_requested_this_call,x=>x.proposal_item.target.post_id=2,x=>x.proposal_item.fields.expected_revision=hash,
  x=>x.comparison.operation='schema.select',x=>x.schema_proposals_available=true,x=>delete x.comparison.source_evidence,
  x=>x.comparison.frontend_output_verified=true]){
  reply=item=>{const r=response(item);edit(r);return r;};check((await handler({schema_preview:detect})).isError,'Unsafe or mismatched response refused');sent.pop();
}
reply=response;
check((await registry({schema_preview:support},{maintenanceOnly:true}).get('plan_changes').h({schema_preview:detect})).isError,'Maintenance-only cannot preview');
check(sent.length===0,'Maintenance never sends');
// Actual MCP serialization + actual HTTP for both supported WordPress URL forms.
let requests=[],status=200;
const http=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://fixture.invalid'),path=u.searchParams.get('rest_route')||u.pathname.replace(/^\/wp-json/,'');
  requests.push(path);
  assert.equal(req.headers.authorization,'Bearer tamrank_pat_synthetic_preview');
  res.setHeader('Content-Type','application/json');
  if(path==='/tamrank/v2/capabilities'){
    assert.equal(req.method,'GET');res.end(JSON.stringify({contract_version:2,full_v2_compatible:false,schema_preview:support}));return;
  }
  assert.equal(path,'/tamrank/v2/schema/preview');assert.equal(req.method,'POST');
  let bytes='';for await(const chunk of req)bytes+=chunk;
  res.setHeader('Content-Type','application/json');res.statusCode=status;
  res.end(JSON.stringify(status===200?response(JSON.parse(bytes)):{code:'schema_source_expired'}));
});
await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
try{for(const routeStyle of ['pretty','query']){
  const client=new Client({name:'fixture-client',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd:process.cwd(),stderr:'pipe',
    env:{PATH:process.env.PATH,TAMRANK_PAT:'tamrank_pat_synthetic_preview',TAMRANK_SITE_URL:'http://127.0.0.1:'+http.address().port,
      TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:routeStyle}}));
  try{
    const listing=await client.listTools();check(listing.tools.length===12,'No additional tool');
    check(JSON.stringify(listing).length<16000,'Core surface within budget');
    for(const item of [detect,select,identity])check(!(await client.callTool({name:'plan_changes',arguments:{schema_preview:item}})).isError,'SDK to HTTP comparison');
    status=409;const n=requests.length;check((await client.callTool({name:'plan_changes',arguments:{schema_preview:detect}})).isError,'Expired source refusal passed through');
    check(requests.length===n+1,'No auto retry or source acquisition');status=200;
  }finally{await client.close();}
}}finally{await new Promise(resolve=>http.close(resolve));}
console.log(`PASS: ${checks} schema-preview checks; SDK/HTTP both URL forms, exact items, no approval/execution or automatic retry.`);
