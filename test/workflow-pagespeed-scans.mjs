import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {discoverWorkflows} from '../src/scan-maintenance.js';
import {pagespeedRoute,pagespeedPolicy,pagespeedAcks,pagespeedHash,validPageSpeedProposal,validPageSpeedProgress,pageSpeedProgress} from '../src/pagespeed-scans.js';
import {sourceAcks} from '../src/source-scans.js';
const id='11111111-1111-4111-8111-111111111111',execution='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64),at=1789218000;
const clone=structuredClone;
const support={available:true,plan_available:true,read_available:true,route:pagespeedRoute,proposal_policy:pagespeedPolicy,
  max_targets:25,attempts_per_device:1,devices:['mobile','desktop'],automatic_retries:0,approval:'chat_attested',
  scheduling:'wp_cron',requires_cron_delivery:true,external_requests_reversible:false,results:'private_scan_progress',legacy_cache_writes:false};
const targets=Array.from({length:25},(_,i)=>({post_id:i+1,title:'Fictieve pagina '+i,type:'page',url:'https://example.invalid/page-'+i}));
const proposal={contract_version:2,lane:'scan',type:'pagespeed',policy:pagespeedPolicy,proposal_id:id,
  preview_revision:hash,binding:{installation_id:id,blog_id:1,operator_id:2,token_id:3},created_at:at,expires_at:at+86400,
  targets,strategies:['mobile','desktop'],required_acknowledgements:pagespeedAcks,warnings:['one','two','three','four','five'],
  budget:{max_provider_requests:50,attempts_per_device:1,automatic_retries:0,enforced:true,monetary_cost:null,quota_remaining:null},
  reservation:{mode:'exclusive',blocks:'tamrank_pagespeed_requests',dispatch_enabled:true,release:'known_completion_or_never_started_cancellation'},
  dispatch:{concurrency:1,stop_on_uncertainty:true,result_storage:'private_scan_progress',website_content_writes:false,legacy_cache_writes:false}};
const draft={contract_version:2,proposal_id:id,proposal_hash:pagespeedHash(proposal),proposal,state:'planned',plan_persisted:true,
  approval_recorded:false,execution_enabled:false,queue_reserved:false,backend_requested:false};
const plan={type:'pagespeed',mode:'plan',post_ids:targets.map(t=>t.post_id),expected_revision:hash,client_request_id:'scan-plan-0001'};
const run={type:'pagespeed',mode:'run',proposal_id:id,client_request_id:'scan-start-0001',
  confirmation:{confirmed:true,agent:'unverified label',plan_hash:draft.proposal_hash,acknowledgements:pagespeedAcks}};
function progress(){return {contract_version:2,execution_id:execution,proposal_id:id,proposal,proposal_hash:draft.proposal_hash,
  automatic_retry_allowed:false,worker_liveness:'unknown',dispatch_state:'queued',scheduled_at:at+1,
  progress:{contract_version:2,view:'execution_runtime',execution_id:execution,runtime_hash:hash,runtime_recorded:true,observed_at:at,
    execution_enabled:true,state:'reserved',runtime:{contract_version:2,policy:'pagespeed-execution-runtime-1',execution_id:execution,
      registration_hash:hash,binding:proposal.binding,created_at:at,updated_at:at,revision:0,dispatch_enabled:true,reservation_state:'held',state:'reserved',
      measurements:targets.flatMap((_,i)=>['mobile','desktop'].map(s=>({measurement_id:createHash('sha256').update(execution+':'+i+':'+s).digest('hex'),
        state:'not_started',attempts:[],result:null})))}}};}
function registry(caps={pagespeed_execution:support},opts={}){
  const calls=[],tools=new Map();let response=progress();
  registerWorkflowTools({server:{getClientVersion:()=>({name:'Owned MCP client',version:'1'})},registerTool:(n,c,h)=>tools.set(n,{c,h})},
    {get:async(p,q)=>{calls.push(['GET',p,q]);return clone(p.includes('/proposals/')?draft:p===pagespeedRoute+'/'+execution?response:{contract_version:2});},
      post:async(p,b)=>{calls.push(['POST',p,b]);return clone(p===pagespeedRoute+'/proposals'?draft:response);}},
    {profile:'specialist',capabilities:caps,...opts});
  return {calls,tools,setResponse:r=>{response=r;}};
}
test('Full exact proposal and URL/device mapping are preserved; truncated or changed data is refused',()=>{
  assert.ok(validPageSpeedProposal(draft,plan));assert.ok(validPageSpeedProgress(progress()));
  assert.equal(pageSpeedProgress(progress()).targets.length,25);assert.equal(pageSpeedProgress(progress()).targets.at(-1).devices.length,2);
  for(const mutate of [d=>d.proposal.targets.pop(),d=>d.proposal.budget.max_provider_requests=2,d=>d.proposal.targets[0].url+='changed',
    d=>d.proposal_hash=hash,d=>d.proposal.policy='pagespeed-proposal-1',d=>d.proposal_id=execution,d=>d.backend_requested=true]){
    const d=clone(draft);mutate(d);assert.equal(validPageSpeedProposal(d,plan),false);
  }
  for(const mutate of [d=>d.progress.runtime.measurements.pop(),d=>d.progress.runtime.measurements.reverse(),d=>d.execution_id=id,
    d=>d.progress.runtime.updated_at='later',d=>d.worker_liveness='alive',d=>d.automatic_retry_allowed=true,
    d=>d.dispatch_state='completed',d=>d.progress.runtime.binding.blog_id=2]){
    const d=clone(progress());mutate(d);assert.equal(validPageSpeedProgress(d),false);
  }
});
test('Completed and cancelled scans are terminal, not dispatch-enabled',()=>{
  const d=progress();d.dispatch_state='completed';d.scheduled_at=null;const p=d.progress,r=p.runtime;
  p.state=r.state='completed';p.execution_enabled=r.dispatch_enabled=false;r.reservation_state='released';
  for(const m of r.measurements){m.state='succeeded';m.result={performance_score:95,fcp_ms:null,lcp_ms:800,tbt_ms:0,cls:0};
    m.attempts=[{started_at:at,finished_at:at,outcome:'succeeded',error_code:null}];}
  assert.ok(validPageSpeedProgress(d));const bad=clone(d);bad.progress.runtime.measurements[0].result.performance_score=101;assert.equal(validPageSpeedProgress(bad),false);
  p.state=r.state=d.dispatch_state='cancelled';for(const m of r.measurements){m.state='cancelled';m.attempts=[];m.result=null;}
  assert.ok(validPageSpeedProgress(d));r.reservation_state='held';assert.equal(validPageSpeedProgress(d),false);
});
test('Plan/run/private status use their own route and real MCP client label, not administrative grants',async()=>{
  const {calls,tools}=registry();assert.equal(tools.size,20);
  assert.equal(tools.get('start_scan').c.annotations.destructiveHint,true);assert.equal(tools.get('get_scan_status').c.annotations.readOnlyHint,true);
  for(const a of [plan,run])assert.ok(!(await tools.get('start_scan').h(a)).isError);
  for(const a of [{type:'pagespeed',proposal_id:id},{type:'pagespeed',execution_id:execution}])assert.ok(!(await tools.get('get_scan_status').h(a)).isError);
  assert.deepEqual(calls.map(c=>c.slice(0,2)),[['POST',pagespeedRoute+'/proposals'],['GET',pagespeedRoute+'/proposals/'+id],['POST',pagespeedRoute],
    ['GET',pagespeedRoute+'/proposals/'+id],['GET',pagespeedRoute+'/'+execution]]);
  assert.deepEqual(calls[2][2].confirmation.client,{name:'Owned MCP client',version:'1'});assert.deepEqual(calls[2][2].confirmation.agent,{name:'unknown'});
  assert.equal(calls[2][2].client_request_id,run.client_request_id);assert.deepEqual(calls[2][2].confirmation.acknowledgements,pagespeedAcks);
});
test('No bad confirmation, source/PageSpeed crossover, undeclared dispatch or fallback',async()=>{
  const {calls,tools}=registry({pagespeed_execution:support,schema_source_jobs:{available:true,execute_available:true,modes:['run']}});
  for(const a of [{...run,post_ids:[1]},{...run,expected_revision:hash},{...run,capture_mode:'native_render'},{...run,source_job_id:id},
    {...run,confirmation:undefined},{...run,confirmation:{...run.confirmation,confirmed:false}},
    {...run,confirmation:{...run.confirmation,acknowledgements:sourceAcks}},
    {...run,confirmation:{...run.confirmation,acknowledgements:[...pagespeedAcks].reverse()}},
    {...run,type:'schema_source',proposal_id:undefined,source_job_id:id},{...plan,post_ids:[1,1]},
    {...plan,post_ids:targets.map(t=>t.post_id).concat(26)}])assert.equal((await tools.get('start_scan').h(a)).isError,true);
  for(const a of [{type:'pagespeed',execution_id:execution,proposal_id:id},{type:'pagespeed',execution_id:execution,expected_ref:'stored:'+'a'.repeat(32)}])
    assert.equal((await tools.get('get_scan_status').h(a)).isError,true);
  assert.equal(calls.length,0);
  for(const opts of [{capabilities:null},{capabilities:{}},{maintenanceOnly:true},{preflight:{ok:false}},
    {capabilities:{pagespeed_execution:{...support,available:false}}},{capabilities:{pagespeed_execution:{...support,route:'/evil'}}}]){
    const r=registry(undefined,opts);assert.equal((await r.tools.get('start_scan').h(run)).isError,true);assert.equal(r.calls.length,0);
  }
  const noRun=registry({pagespeed_execution:{...support,available:false}});assert.ok(!(await noRun.tools.get('start_scan').h(plan)).isError);
  const off=registry({pagespeed_execution:{...support,available:false,plan_available:false}});
  assert.equal((await off.tools.get('start_scan').h(plan)).isError,true);assert.equal(off.calls.length,0);
  assert.ok(!(await off.tools.get('get_scan_status').h({type:'pagespeed',execution_id:execution})).isError);
  assert.ok(!(await off.tools.get('get_scan_status').h({type:'pagespeed',proposal_id:id})).isError);
});
test('Hash mismatch sends no start; invalid returned progress is never called successful',async()=>{
  const r=registry();assert.equal((await r.tools.get('start_scan').h({...run,confirmation:{...run.confirmation,plan_hash:hash}})).isError,true);
  assert.equal(r.calls.length,1);assert.equal(r.calls[0][0],'GET');
  const bad=progress();bad.progress.runtime.measurements.pop();r.setResponse(bad);
  assert.equal((await r.tools.get('start_scan').h(run)).isError,true);assert.equal(r.calls.length,3,'No retry or replacement request');
});
test('Discovery only asks optional capabilities in approved specialist startup',async()=>{
  for(const opts of [{preview:true,profile:'core'},{preview:false,profile:'specialist'},{preview:true,profile:'legacy'}]){
    const calls=[];await discoverWorkflows({get:async p=>{calls.push(p);return {full_v2_compatible:true};}},opts);
    assert.ok(!calls.includes(pagespeedRoute+'/capabilities'));
  }
  const d=await discoverWorkflows({get:async p=>p==='/capabilities'?{contract_version:2}:p===pagespeedRoute+'/capabilities'?{contract_version:2,pagespeed_execution:support}:{}},
    {preview:true,profile:'specialist'});assert.deepEqual(d.capabilities.pagespeed_execution,support);
});
