/** Hosted URL Inspection jobs. One chat-approved attempt per selected URL, zero TamRank credits. */
import {z} from 'zod';
import {scanId} from './scan-maintenance.js';
import {pagespeedHash} from './pagespeed-scans.js';

export const indexRoute='/index-scans';
export const indexAcks=['google_url_inspection_requests','cache_may_supply_older_measurements','no_automatic_retry','external_requests_cannot_be_rolled_back'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const requestId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,63}$/);
const text=z.string().min(1).max(64).refine(v=>v.trim().length>0&&Buffer.byteLength(v,'utf8')<=64&&!/[<>\p{C}]/u.test(v));
export const indexConfirmation=z.object({plan_hash:hash,confirmed:z.literal(true),agent:text,
  acknowledgements:z.array(z.string()).length(4).refine(v=>same(v,indexAcks))}).strict();
export const indexCloseConfirmation=z.object({confirmed:z.literal(true),agent:text,
  acknowledgement:z.literal('stop_unstarted_targets_without_retry')}).strict();

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function indexSupport(c){return object(c)&&c.contract_version===2&&c.route===indexRoute&&c.type==='index'
  &&same(c.modes,['plan','run'])&&c.max_targets===25&&c.max_provider_attempts_per_target===1&&c.max_credits===0
  &&c.approval==='chat_attested'&&c.automatic_retries===0&&c.status_reads==='local_only'
  &&c.results==='existing_index_status_fields'&&['available','plan_available','read_available'].every(k=>typeof c[k]==='boolean');}
export async function discoverIndexScans(client){try{const r=await client.get(indexRoute+'/capabilities');
  return r?.contract_version===2&&indexSupport(r)?r:{available:false,plan_available:false,read_available:false};
}catch{return{available:false,plan_available:false,read_available:false};}}
export function validIndexStart(a){if(a.type!=='index')return false;
  const only=keys=>Object.keys(a).every(k=>keys.includes(k));
  if(a.mode==='preview')return Array.isArray(a.post_ids)&&only(['mode','type','post_ids','expected_revision']);
  if(a.mode==='plan')return Array.isArray(a.post_ids)&&a.expected_revision!==undefined&&indexRequestId.safeParse(a.client_request_id).success
    &&only(['mode','type','post_ids','expected_revision','client_request_id']);
  return a.mode==='run'&&a.proposal_id!==undefined&&indexRequestId.safeParse(a.client_request_id).success&&a.confirmation!==undefined
    &&only(['mode','type','proposal_id','client_request_id','confirmation']);
}
function validPlan(p,id,hashValue){if(!object(p)||p.contract_version!==2||p.lane!=='hosted_index_scan'||p.type!=='index'
  ||!uuid(p.proposal_id)||p.proposal_id!==id||!digest(hashValue)||!digest(p.preview_revision)||!positive(p.created_at)||p.expires_at!==p.created_at+900
  ||p.vps_contract_version!=='index-inspection-1'||p.vps_policy_version!=='index-inspection-policy-1'||p.cache_policy!=='use_valid_snapshot'
  ||!object(p.binding)||!uuid(p.binding.installation_id)||!['blog_id','operator_id','token_id'].every(k=>positive(p.binding[k]))
  ||typeof p.property!=='string'||Buffer.byteLength(p.property,'utf8')>512||!Array.isArray(p.targets)||p.targets.length<1||p.targets.length>25
  ||p.limits?.max_provider_attempts!==p.targets.length||p.limits?.max_credits!==0||!same(p.required_acknowledgements,indexAcks)
  ||p.product_writes_performed!==false||!Array.isArray(p.warnings)||p.warnings.length!==4)return false;
  if(!p.targets.every(t=>object(t)&&positive(t.post_id)&&t.target_id===`page-${t.post_id}`&&typeof t.url==='string'
    &&/^https?:\/\//.test(t.url)&&Buffer.byteLength(t.url,'utf8')<=2048)||new Set(p.targets.map(t=>t.url)).size!==p.targets.length)return false;
  return pagespeedHash(p)===hashValue;
}
function validJob(j,p){if(!object(j)||j.contract_version!=='index-inspection-1'||j.policy_version!=='index-inspection-policy-1'
  ||j.operation!=='index_inspection'||!/^isj_[a-f0-9]{24}$/.test(j.job_id)||j.site_uuid!==p.binding.installation_id
  ||j.property!==p.property||j.proposal_hash!==pagespeedHash(p)||!positive(j.status_version)
  ||!['queued','running','completed','partial','failed','cancelled','needs_reconciliation'].includes(j.status)
  ||!Array.isArray(j.targets)||j.targets.length!==p.targets.length||j.targets_total!==p.targets.length||j.targets_snapshot_version!==j.status_version)return false;
  return j.targets.every((t,i)=>object(t)&&t.position===i&&t.target_id===p.targets[i].target_id&&t.url===p.targets[i].url
    &&['queued','sending','completed','failed','uncertain','not_started','cancelled'].includes(t.status)
    &&(t.status==='completed'?object(t.result)&&['indexed','crawled','not_found','noindex','error'].includes(t.result.coverage_state)
      &&typeof t.observed_at==='string'&&Number.isFinite(Date.parse(t.observed_at)):t.result===null));
}
export function validIndexReceipt(d,a=null){if(d?.contract_version!==2||d.type!=='index'||!uuid(d.proposal_id)||!digest(d.proposal_hash)
  ||!['planned','approved','queued','running','completed','partial','failed','cancelled','needs_reconciliation'].includes(d.state)
  ||typeof d.approval_recorded!=='boolean'||typeof d.backend_requested!=='boolean'||d.product_writes_performed!==false
  ||!validPlan(d.proposal,d.proposal_id,d.proposal_hash)||!(d.job===null||validJob(d.job,d.proposal)))return false;
  if(a?.proposal_id&&a.proposal_id!==d.proposal_id)return false;
  if(a?.post_ids&&!same(a.post_ids,d.proposal.targets.map(t=>t.post_id)))return false;
  if(a?.expected_revision&&a.expected_revision!==d.proposal.preview_revision)return false;
  if(a?.confirmation?.plan_hash&&a.confirmation.plan_hash!==d.proposal_hash)return false;
  return true;
}
const label=(v,n)=>typeof v==='string'&&v.trim()!==''&&Buffer.byteLength(v,'utf8')<=n&&!/[<>\p{C}]/u.test(v);
export function indexStartBody(a,clientInfo,agentName=a.confirmation.agent){return{proposal_id:a.proposal_id,client_request_id:a.client_request_id,confirmation:{
  mode:'chat_attested',plan_hash:a.confirmation.plan_hash,confirmed:true,acknowledgements:[...a.confirmation.acknowledgements],
  client:{name:label(clientInfo?.name,64)?clientInfo.name:'unknown',version:label(clientInfo?.version,32)?clientInfo.version:'unknown'},
  agent:{name:label(agentName,64)?agentName:'unknown'}}};}
export const indexRequestId=requestId;
