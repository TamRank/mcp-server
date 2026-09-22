import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {indexRoute,indexAcks,indexSupport,validIndexReceipt} from '../src/index-scans.js';
import {pagespeedHash} from '../src/pagespeed-scans.js';
const id='11111111-1111-4111-8111-111111111111',revision='a'.repeat(64),at=1800000000;
const targets=[205,1].map(post_id=>({post_id,target_id:`page-${post_id}`,url:`https://example.invalid/page-${post_id}/`}));
const proposal={contract_version:2,lane:'hosted_index_scan',proposal_id:id,binding:{installation_id:id,blog_id:1,operator_id:2,token_id:3},
  created_at:at,expires_at:at+900,type:'index',preview_revision:revision,vps_contract_version:'index-inspection-1',
  vps_policy_version:'index-inspection-policy-1',property:'https://example.invalid/',targets,
  limits:{max_provider_attempts:2,max_credits:0},cache_policy:'use_valid_snapshot',required_acknowledgements:indexAcks,
  product_writes_performed:false,warnings:['one','two','three','four']};
const proposalHash=pagespeedHash(proposal);
const draft={contract_version:2,type:'index',proposal_id:id,proposal_hash:proposalHash,state:'planned',created_at:at,expires_at:at+900,
  expired:false,approval_recorded:false,backend_requested:false,proposal,job:null,product_writes_performed:false};
const job={contract_version:'index-inspection-1',policy_version:'index-inspection-policy-1',operation:'index_inspection',
  job_id:'isj_16451fe2329761d713af597c',site_uuid:id,property:proposal.property,proposal_hash:proposalHash,status:'queued',status_version:1,
  targets_total:2,targets_snapshot_version:1,targets:targets.map((t,position)=>({position,target_id:t.target_id,url:t.url,status:'queued',observed_at:null,result:null}))};
const started={...draft,state:'queued',approval_recorded:true,backend_requested:true,job};
const support={contract_version:2,available:true,plan_available:true,read_available:true,route:indexRoute,type:'index',modes:['plan','run'],
  max_targets:25,max_provider_attempts_per_target:1,max_credits:0,approval:'chat_attested',automatic_retries:0,status_reads:'local_only',results:'existing_index_status_fields'};
const plan={mode:'plan',type:'index',post_ids:[205,1],expected_revision:revision,client_request_id:'index-plan-0001'};
const run={mode:'run',type:'index',proposal_id:id,client_request_id:'index-run-0001',confirmation:{plan_hash:proposalHash,confirmed:true,
  agent:'unknown',acknowledgements:indexAcks}};
function registry(caps={index_scan_execution:support}){const calls=[],tools=new Map();
  registerWorkflowTools({server:{getClientVersion:()=>({name:'Hosted test',version:'1.2'})},registerTool:(n,c,h)=>tools.set(n,{c,h})},
    {get:async(p,q)=>{calls.push(['GET',p,q]);return structuredClone(draft);},post:async(p,b)=>{calls.push(['POST',p,b]);return structuredClone(started);}},
    {profile:'specialist',capabilities:caps,preflight:{ok:true}});return{calls,tools};}

test('Index contract and full local receipt stay bound to all ordered targets',()=>{
  assert.ok(indexSupport(support));assert.ok(validIndexReceipt(draft,plan));assert.ok(validIndexReceipt(started,run));
  const bad=structuredClone(started);bad.job.targets.reverse();assert.equal(validIndexReceipt(bad,run),false);
  const changed=structuredClone(draft);changed.proposal.targets[0].url+='changed';assert.equal(validIndexReceipt(changed,plan),false);
});
test('Index plan, approval, local status and close use only the dedicated routes',async()=>{
  const r=registry();assert.ok(!(await r.tools.get('start_scan').h(plan)).isError);assert.ok(!(await r.tools.get('start_scan').h(run)).isError);
  assert.ok(!(await r.tools.get('get_scan_status').h({type:'index',proposal_id:id})).isError);
  assert.ok(!(await r.tools.get('close_scan').h({type:'index',proposal_id:id,client_request_id:'index-close-0001',expected_status_version:1,
    confirmation:{confirmed:true,agent:'unknown',acknowledgement:'stop_unstarted_targets_without_retry'}})).isError);
  assert.deepEqual(r.calls.map(c=>c.slice(0,2)),[['POST',indexRoute+'/proposals'],['GET',indexRoute+'/proposals/'+id],['POST',indexRoute],
    ['GET',indexRoute+'/'+id],['POST',indexRoute+'/'+id+'/close']]);
  assert.deepEqual(r.calls[2][2].confirmation.client,{name:'Hosted test',version:'1.2'});
  assert.deepEqual(r.calls[4][2],{client_request_id:'index-close-0001',expected_status_version:1});
});
test('Invalid consent, changed plan and unavailable site never dispatch a hosted scan',async()=>{
  for(const input of [{...run,confirmation:{...run.confirmation,confirmed:false}},{...run,confirmation:{...run.confirmation,acknowledgements:[...indexAcks].reverse()}},
    {...run,client_request_id:'x'.repeat(65)},{...plan,post_ids:[1,1]},{...plan,post_ids:Array.from({length:26},(_,i)=>i+1)}]){
    const r=registry();assert.equal((await r.tools.get('start_scan').h(input)).isError,true);assert.equal(r.calls.length,0);}
  for(const caps of [{},{index_scan_execution:{...support,available:false}},{index_scan_execution:{...support,route:'/wrong'}}]){
    const r=registry(caps);assert.equal((await r.tools.get('start_scan').h(run)).isError,true);assert.ok(r.calls.length<=1);}
});
