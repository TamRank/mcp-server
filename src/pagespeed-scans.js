/** Exact approved PageSpeed jobs; no provider calls, automatic retry or legacy-write fallback. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sourceConfirmation,sourceAcks,sourceProbeAcks} from './source-scans.js';
import {confirmationBody} from './field-execution.js';
export const pagespeedRoute='/scans/executions';
export const pagespeedPolicy='pagespeed-execution-proposal-1';
export const pagespeedAcks=['external_pagespeed_request','provider_quota_unknown','no_automatic_retry',
  'exclusive_reservation_blocks_pagespeed','external_requests_cannot_be_rolled_back'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const scanConfirmation=sourceConfirmation.extend({acknowledgements:z.array(z.string()).min(4).max(5)
  .refine(a=>[pagespeedAcks,sourceAcks,sourceProbeAcks].some(b=>same(a,b)))});
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const metrics=['performance_score','fcp_ms','lcp_ms','tbt_ms','cls'];
function validResult(v){
  return object(v)&&Object.keys(v).every(k=>[...metrics,'provenance'].includes(k))&&metrics.every(k=>Object.hasOwn(v,k)
    &&(v[k]===null?k!=='performance_score':typeof v[k]==='number'&&Number.isFinite(v[k])&&v[k]>=0&&v[k]<=(['performance_score','cls'].includes(k)?100:86400000)));
}
const sorted=v=>Array.isArray(v)?v.map(sorted):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
// Frozen proposals contain only integer numbers. Match PHP's Unicode line escaping.
export const pagespeedHash=v=>createHash('sha256').update(JSON.stringify(sorted(v)).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')).digest('hex');
export function pagespeedSupport(c){
  return object(c)&&c.route===pagespeedRoute&&c.proposal_policy===pagespeedPolicy&&c.max_targets===25
    &&c.attempts_per_device===1&&same(c.devices,['mobile','desktop'])&&c.automatic_retries===0
    &&c.approval==='chat_attested'&&c.scheduling==='wp_cron'&&c.requires_cron_delivery===true
    &&c.external_requests_reversible===false&&c.results==='private_scan_progress'&&c.legacy_cache_writes===false
    &&['available','plan_available','read_available'].every(k=>typeof c[k]==='boolean');
}
export async function discoverPageSpeedScans(client){
  try{const r=await client.get(pagespeedRoute+'/capabilities');
    if(r?.contract_version===2&&pagespeedSupport(r.pagespeed_execution))return r.pagespeed_execution;
  }catch{}
  return {available:false,plan_available:false,read_available:false};
}
export function validPageSpeedStart(a){
  if(a.type!=='pagespeed'||a.source_job_id!==undefined||a.capture_mode!==undefined||a.probe_content!==undefined)return false;
  if(a.mode==='run')return a.proposal_id!==undefined&&a.client_request_id!==undefined&&a.confirmation!==undefined
    &&same(a.confirmation.acknowledgements,pagespeedAcks)&&a.post_ids===undefined&&a.expected_revision===undefined;
  return a.post_ids!==undefined&&a.proposal_id===undefined&&a.confirmation===undefined
    &&(a.mode==='plan'?a.expected_revision!==undefined&&a.client_request_id!==undefined:a.mode==='preview'&&a.client_request_id===undefined);
}
function validPlan(p,id,digest){
  if(!object(p)||p.contract_version!==2||p.lane!=='scan'||p.type!=='pagespeed'||p.policy!==pagespeedPolicy
    ||!uuid(p.proposal_id)||(id!==null&&p.proposal_id!==id)||!hash(digest)||!hash(p.preview_revision)
    ||!positive(p.created_at)||p.expires_at!==p.created_at+86400
    ||!object(p.binding)||!uuid(p.binding.installation_id)||!['blog_id','operator_id','token_id'].every(k=>positive(p.binding[k]))
    ||!Array.isArray(p.targets)||p.targets.length<1||p.targets.length>25||!same(p.strategies,['mobile','desktop'])
    ||!same(p.required_acknowledgements,pagespeedAcks)||!Array.isArray(p.warnings)||p.warnings.length!==5||!p.warnings.every(v=>typeof v==='string')
    ||p.budget?.max_provider_requests!==p.targets.length*2||p.budget?.attempts_per_device!==1||p.budget?.automatic_retries!==0
    ||p.budget?.enforced!==true||p.budget?.monetary_cost!==null||p.budget?.quota_remaining!==null
    ||p.reservation?.mode!=='exclusive'||p.reservation?.blocks!=='tamrank_pagespeed_requests'||p.reservation?.dispatch_enabled!==true
    ||p.reservation?.release!=='known_completion_or_never_started_cancellation'||p.dispatch?.concurrency!==1
    ||p.dispatch?.stop_on_uncertainty!==true||p.dispatch?.result_storage!=='private_scan_progress'
    ||p.dispatch?.website_content_writes!==false||p.dispatch?.legacy_cache_writes!==false)return false;
  if(!p.targets.every(t=>object(t)&&positive(t.post_id)&&typeof t.title==='string'&&Buffer.byteLength(t.title)<=4096
    &&typeof t.type==='string'&&/^[a-z0-9_-]{1,32}$/.test(t.type)&&typeof t.url==='string'&&/^https?:\/\//.test(t.url))
    ||new Set(p.targets.map(t=>t.post_id)).size!==p.targets.length||new Set(p.targets.map(t=>t.url)).size!==p.targets.length)return false;
  return pagespeedHash(p)===digest;
}
export function validPageSpeedProposal(d,a=null){
  return d?.contract_version===2&&['planned','expired'].includes(d.state)&&d.plan_persisted===true&&d.approval_recorded===false
    &&d.execution_enabled===false&&d.queue_reserved===false&&d.backend_requested===false&&uuid(d.proposal_id)
    &&validPlan(d.proposal,d.proposal_id,d.proposal_hash)&&(!a?.proposal_id||d.proposal_id===a.proposal_id)
    &&(!a?.post_ids||(same(d.proposal.targets.map(t=>t.post_id),a.post_ids)&&d.proposal.preview_revision===a.expected_revision));
}
export function validPageSpeedProgress(d,{execution_id=null,proposal_id=null,plan_hash=null}={}){
  if(d?.contract_version!==2||!uuid(d.execution_id)||(execution_id!==null&&d.execution_id!==execution_id)
    ||!uuid(d.proposal_id)||(proposal_id!==null&&d.proposal_id!==proposal_id)||(plan_hash!==null&&d.proposal_hash!==plan_hash)
    ||!validPlan(d.proposal,d.proposal_id,d.proposal_hash)||d.automatic_retry_allowed!==false||d.worker_liveness!=='unknown'
    ||!['queued','not_scheduled','expired','paused','reconciliation_required','completed','cancelled'].includes(d.dispatch_state)
    ||!(d.scheduled_at===null||positive(d.scheduled_at)))return false;
  const p=d.progress,r=p?.runtime;
  if(p?.contract_version!==2||p.view!=='execution_runtime'||p.execution_id!==d.execution_id||!hash(p.runtime_hash)||p.runtime_recorded!==true
    ||!positive(p.observed_at)||typeof p.execution_enabled!=='boolean'||r?.contract_version!==2||r.policy!=='pagespeed-execution-runtime-1'
    ||r.execution_id!==d.execution_id||!hash(r.registration_hash)||!same(sorted(r.binding),sorted(d.proposal.binding))
    ||!positive(r.created_at)||!positive(r.updated_at)||!Number.isSafeInteger(r.revision)||r.revision<0||r.updated_at<r.created_at||p.observed_at<r.updated_at
    ||r.dispatch_enabled!==['reserved','running'].includes(r.state)||!['held','released'].includes(r.reservation_state)||r.state!==p.state
    ||!['reserved','running','blocked','completed','cancelled'].includes(r.state)
    ||!Array.isArray(r.measurements)||r.measurements.length!==d.proposal.targets.length*2)return false;
  for(const [i,m] of r.measurements.entries()){
    const id=createHash('sha256').update(d.execution_id+':'+Math.floor(i/2)+':'+(i%2?'desktop':'mobile')).digest('hex');
    if(m?.measurement_id!==id||!['not_started','started','succeeded','failed','uncertain','cancelled'].includes(m.state)
      ||!Array.isArray(m.attempts)||m.attempts.length>1||!Object.hasOwn(m,'result'))return false;
    if(['not_started','cancelled'].includes(m.state)&&(m.attempts.length!==0||m.result!==null))return false;
    if(['started','succeeded','failed','uncertain'].includes(m.state)&&m.attempts.length!==1)return false;
    if(m.state==='succeeded'&&!validResult(m.result))return false;
    if(m.state!=='succeeded'&&m.result!==null)return false;
    const attempt=m.attempts[0];
    if(attempt){
      if(!positive(attempt.started_at)||attempt.started_at<r.created_at||attempt.started_at>r.updated_at)return false;
      if(m.state==='started'&&(attempt.finished_at!==null||attempt.outcome!==null||attempt.error_code!==null))return false;
      if(m.state!=='started'&&(!positive(attempt.finished_at)||attempt.finished_at<attempt.started_at||attempt.finished_at>r.updated_at||attempt.outcome!==m.state))return false;
      if(m.state==='succeeded'&&attempt.error_code!==null||m.state==='failed'&&attempt.error_code!=='provider_rejected')return false;
      if(m.state==='uncertain'&&!['transport_unknown','invalid_response','provider_exception','preflight_changed'].includes(attempt.error_code))return false;
    }
  }
  if(r.state==='completed'&&(r.reservation_state!=='released'||!r.measurements.every(m=>['succeeded','failed'].includes(m.state))))return false;
  if(['reserved','running','blocked'].includes(r.state)&&r.reservation_state!=='held')return false;
  if(r.state==='cancelled'&&(r.reservation_state!=='released'||!r.measurements.every(m=>['succeeded','failed','cancelled'].includes(m.state))))return false;
  if(['completed','cancelled'].includes(r.state)&&d.dispatch_state!==r.state)return false;
  if(['completed','cancelled'].includes(d.dispatch_state)&&r.state!==d.dispatch_state)return false;
  if(['queued','not_scheduled','expired','paused'].includes(d.dispatch_state)&&r.state!=='reserved')return false;
  if(d.dispatch_state==='queued'&&d.scheduled_at===null)return false;
  if(['running','blocked'].includes(r.state)!==(d.dispatch_state==='reconciliation_required'))return false;
  return true;
}
export function pageSpeedStartBody(a,clientInfo){
  const provenance=confirmationBody({confirmation:{plan_hash:a.confirmation.plan_hash,confirmed:true}},clientInfo).confirmation;
  return {proposal_id:a.proposal_id,client_request_id:a.client_request_id,
    confirmation:{...provenance,acknowledgements:[...a.confirmation.acknowledgements]}};
}
export function pageSpeedProgress(d){
  return {contract_version:2,type:'pagespeed',execution_id:d.execution_id,proposal_id:d.proposal_id,proposal_hash:d.proposal_hash,
    state:d.progress.state,dispatch_state:d.dispatch_state,scheduled_at:d.scheduled_at,worker_liveness:'unknown',
    runtime_hash:d.progress.runtime_hash,reservation_state:d.progress.runtime.reservation_state,automatic_retry_allowed:false,
    target_count:d.proposal.targets.length,measurement_count:d.progress.runtime.measurements.length,
    targets:d.proposal.targets.map((t,i)=>({...t,devices:d.progress.runtime.measurements.slice(i*2,i*2+2).map((m,j)=>({
      strategy:j?'desktop':'mobile',state:m.state,result:m.result,error_code:m.attempts[0]?.error_code??null}))})),
    limitations:['Queued is not proof of a live worker. Unknown attempts require reconciliation, never a new scan or automatic retry.',
      'Private measurement results only; no legacy cache, website content change or SEO outcome is claimed.']};
}
