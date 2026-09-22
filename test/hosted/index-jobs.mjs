import assert from 'node:assert/strict';
import {connect,id} from './factory-fixtures.mjs';
import {indexAcks} from '../../src/index-scans.js';
import {pagespeedHash} from '../../src/pagespeed-scans.js';
const at=1800000000,revision='a'.repeat(64),targets=[1].map(post_id=>({post_id,target_id:`page-${post_id}`,url:`https://site.example.invalid/page-${post_id}/`}));
const proposal={contract_version:2,lane:'hosted_index_scan',proposal_id:id,binding:{installation_id:'11111111-1111-4111-8111-111111111111',blog_id:2,operator_id:3,token_id:4},
  created_at:at,expires_at:at+900,type:'index',preview_revision:revision,vps_contract_version:'index-inspection-1',vps_policy_version:'index-inspection-policy-1',
  property:'https://site.example.invalid/',targets,limits:{max_provider_attempts:1,max_credits:0},cache_policy:'use_valid_snapshot',required_acknowledgements:indexAcks,
  product_writes_performed:false,warnings:['one','two','three','four']};
const digest=pagespeedHash(proposal),draft={contract_version:2,type:'index',proposal_id:id,proposal_hash:digest,state:'planned',created_at:at,expires_at:at+900,
  expired:false,approval_recorded:false,backend_requested:false,proposal,job:null,product_writes_performed:false};
const started={...draft,state:'queued',approval_recorded:true,backend_requested:true,job:{contract_version:'index-inspection-1',policy_version:'index-inspection-policy-1',
  operation:'index_inspection',job_id:'isj_16451fe2329761d713af597c',site_uuid:proposal.binding.installation_id,property:proposal.property,proposal_hash:digest,status:'queued',
  status_version:1,targets_total:1,targets_snapshot_version:1,targets:[{position:0,target_id:'page-1',url:targets[0].url,status:'queued',observed_at:null,result:null}]}};
const caps={contract_version:2,mcp_bridge_compatibility:'workflow-v2-1',reads:{},index_scan_execution:{contract_version:2,available:true,plan_available:true,read_available:true,
  route:'/index-scans',type:'index',modes:['plan','run'],max_targets:25,max_provider_attempts_per_target:1,max_credits:0,approval:'chat_attested',automatic_retries:0,
  status_reads:'local_only',results:'existing_index_status_fields'}};
const fixture=await connect({responses:[{body:draft},{body:started}]},{capabilities:caps,scopes:['site:read','scans:plan','scans:execute']},ctx=>{
  ctx.validatedInstallation.workflow_profile='workflow-v2-1';ctx.auditContext.grantLabel='grant:'+ctx.grantContext.grant_id;
});
try{
  const names=(await fixture.client.listTools()).tools.map(t=>t.name);assert(names.includes('start_scan'));assert(names.includes('get_scan_status'));assert(names.includes('close_scan'));
  const output=await fixture.client.callTool({name:'start_scan',arguments:{mode:'run',type:'index',proposal_id:id,client_request_id:'index-run-0001',
    confirmation:{plan_hash:digest,confirmed:true,agent:'must be replaced by grant',acknowledgements:indexAcks}}});
  assert.equal(output.isError,undefined);assert.deepEqual(fixture.stub.events.map(e=>e.type),['authorize','request','request','record']);
  const sent=JSON.parse(new TextDecoder().decode(fixture.stub.calls[1].bodyBytes));
  assert.deepEqual(sent.confirmation.client,{name:'Synthetic MCP client',version:'2.4'});
  assert.deepEqual(sent.confirmation.agent,{name:'grant:'+fixture.ctx.grantContext.grant_id});
  assert.equal(sent.confirmation.plan_hash,digest);assert.equal(sent.client_request_id,'index-run-0001');
}finally{await fixture.close();}
console.log('PASS: hosted OAuth lists and executes only the advertised, approved index-job workflow.');
