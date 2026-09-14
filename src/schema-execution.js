/** Read-only semantic schema records. Raw native envelopes are never tool output. */
import {z} from 'zod';
import {validSchemaExecutionHistory} from './schema-execution-history.js';
import {validExecutionResponse,fieldOperations,executionSchema} from './field-execution.js';
import {redirectOperations,capability,redirectConfirmationBody,mixedExecutionSchema} from './redirect-execution.js';
export const schemaExecutionPolicies=['workflow-schema-execution-1','workflow-schema-rollback-1'];
export const schemaOperations=['schema.select','schema.detect','schema_settings.update'];
export const schemaForwardToken=v=>typeof v==='string'&&v.startsWith('trse1.');
export const schemaInverseToken=v=>typeof v==='string'&&v.startsWith('trsr1.');
export const schemaForwardExecutionSchema={...executionSchema,change_token:z.string().regex(/^trse1\.[a-f0-9]{64}$/),
  confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.enum(['redirect_deletion','replace_manual_schema','site_wide_identity'])).max(3)
    .refine(v=>new Set(v).size===v.length)})};
export const schemaInverseExecutionSchema={...schemaForwardExecutionSchema,change_token:z.string().regex(/^trsr1\.[a-f0-9]{64}$/)};
export const schemaMixedExecutionSchema={...mixedExecutionSchema,change_token:z.string().regex(/^(?:trce1|trcr1|trcx1|trxr1|trfr1|trrr1|trse1|trsr1|trscr1)\.[a-f0-9]{64}$/),
  confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.string()).max(3).optional()})};
export const schemaConfirmationBody=redirectConfirmationBody;
export function isSchemaExecutionPlan(input,support){
  return capability(support,'available')&&support.record_contract==='schema_execution_view_v1'&&support.private_proofs_omitted===true
    &&Array.isArray(input.items)&&input.items.some(i=>schemaOperations.includes(i.operation))
    &&input.items.every(i=>[...schemaOperations,...fieldOperations,...redirectOperations].includes(i.operation)&&support.operations?.includes(i.operation));
}
const stable=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export function matchesSchemaExecutionRequest(data,input){
  const p=data?.record?.envelope?.plan;
  return p?.kind==='forward'&&stable(p.origin)===stable(input.origin)&&p.client_request_id===input.client_request_id
    &&Array.isArray(p.items)&&p.items.length===input.items.length&&p.items.every((i,n)=>stable({operation:i.operation,target:i.target,fields:i.fields})===stable(input.items[n]));
}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed,required=[])=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const requestId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/.test(v);
const label=(v,n)=>typeof v==='string'&&v.trim()!==''&&Buffer.byteLength(v,'utf8')<=n&&!/[<>\p{C}]/u.test(v);
const strings=v=>Array.isArray(v)&&v.every(s=>typeof s==='string')&&new Set(v).size===v.length;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/.test(v)&&Number.isFinite(Date.parse(v));
const stubKeys=['mode','received_at','plan_hash','statement','attested_by_token_id','operator_id','change_set_id',
  'client_request_id','acknowledgements','provenance_asserted','human_verified','client','agent'];
const attestation=v=>keys(v,stubKeys,stubKeys)
  &&v.mode==='chat_attested'&&v.statement==='user approved in chat'&&v.human_verified===false&&v.provenance_asserted===true
  &&hash(v.plan_hash)&&uuid(v.change_set_id)&&positive(v.operator_id)&&positive(v.attested_by_token_id)
  &&timestamp(v.received_at)&&requestId(v.client_request_id)&&strings(v.acknowledgements)
  &&keys(v.client,['name','version'],['name','version'])&&label(v.client.name,80)&&(v.client.version===null||label(v.client.version,40))
  &&keys(v.agent,['name'],['name'])&&label(v.agent.name,80);
export function validSchemaExecutionResponse(data,id=null,planHash=null){
  // Malformed or oversized responses fail closed, including direct adapter use.
  let encoded;try{encoded=JSON.stringify(data);}catch{return false;}
  if(typeof encoded!=='string'||Buffer.byteLength(encoded,'utf8')>1048576||!keys(data,['contract_version','record'],['contract_version','record'])
    ||!validExecutionResponse(data,id,planHash,schemaExecutionPolicies))return false;
  if(data.record.history!==undefined)return validSchemaExecutionHistory(data.record);
  const r=data.record,p=r.envelope?.plan,inverse=p?.policy_version==='workflow-schema-rollback-1';
  if(!keys(r,['state','plan_persisted','approval_recorded','projection','envelope','registration','item_results'],
    ['state','plan_persisted','approval_recorded','projection','envelope','registration','item_results'])
    ||!keys(r.projection,['contract','private_proofs_omitted','plan_hash_scope'])
    ||r.projection.contract!=='schema_execution_view_v1'||r.projection.private_proofs_omitted!==true||r.projection.plan_hash_scope!=='complete_stored_plan'
    ||!keys(r.envelope,['plan','plan_hash','change_token'])||r.plan_persisted!==true||typeof r.approval_recorded!=='boolean'
    ||!keys(p,['contract_version','change_set_id','kind','revision','client_request_id','risk','warning_codes','required_scopes',
      'policy_version','created_at','expires_at','result_semantics','frontend_verification','execution_available','required_acknowledgements','binding','origin','reverses','items','comparison_revision'],
      ['contract_version','change_set_id','kind','revision','client_request_id','risk','warning_codes','required_scopes','policy_version',
        'created_at','expires_at','result_semantics','frontend_verification','execution_available','required_acknowledgements','binding','items'])
    ||p.contract_version!==2||p.kind!==(inverse?'rollback':'forward')||p.revision!==1||p.execution_available!==true
    ||!requestId(p.client_request_id)||!positive(p.created_at)||!positive(p.expires_at)||p.expires_at<=p.created_at
    ||!strings(p.warning_codes)||!strings(p.required_scopes)||typeof p.risk!=='string'||typeof p.result_semantics!=='string'
    ||!new RegExp('^'+(inverse?'trsr1':'trse1')+'\\.[a-f0-9]{64}$').test(r.envelope.change_token)
    ||!Array.isArray(p.items)||p.items.length<1||p.items.length>25||!Array.isArray(r.item_results)||r.item_results.length!==p.items.length
    ||!Array.isArray(p.required_acknowledgements)||p.required_acknowledgements.some(v=>!['redirect_deletion','replace_manual_schema','site_wide_identity'].includes(v))
    ||new Set(p.required_acknowledgements).size!==p.required_acknowledgements.length
    ||!['not_performed','native_current_sample'].includes(p.frontend_verification)
    ||!keys(p.binding,['installation_id','blog_id','operator_id','token_id','site_origin'],['installation_id','blog_id','operator_id','token_id','site_origin'])
    ||!uuid(p.binding.installation_id)||!positive(p.binding.blog_id)||!positive(p.binding.operator_id)||!positive(p.binding.token_id)
    ||typeof p.binding.site_origin!=='string')return false;
  if(inverse?!keys(p.reverses,['change_set_id','plan_hash','execution_id','action_id'])||p.origin!==undefined
    :!keys(p.origin,['kind','reference','summary','action_id','revision','snapshot_hash'])||p.reverses!==undefined)return false;
  if(p.comparison_revision!==undefined&&(!inverse||!hash(p.comparison_revision)))return false;
  const seen=new Set();
  for(let n=0;n<p.items.length;n++){
    const i=p.items[n],state=r.item_results[n];
    const redirectInverse=inverse&&[...redirectOperations,'redirect.restore'].includes(i?.operation);
    if(!keys(i,['item_id','original_item_id','original_order','audit_id','original_operation','operation','url','fields','before','after','target','schema_comparison','assigned_id_required'],
      ['item_id','operation','before','after','target',...redirectInverse?['assigned_id_required']:['url']])||!uuid(i.item_id)||seen.has(i.item_id)
      ||![...fieldOperations,...redirectOperations,...schemaOperations,...(inverse?['redirect.restore']:[])].includes(i.operation)
      ||!keys(i.target,['post_id','attachment_id','site','sample_post_id','source_url','redirect_id','original_redirect_id'])
      ||!Object.keys(i.target).length||Object.entries(i.target).some(([k,v])=>k==='site'?v!=='current':k==='source_url'?typeof v!=='string':!positive(v))
      ||(redirectInverse?(i.url!==undefined||i.assigned_id_required!==(i.operation==='redirect.restore'))
        :(typeof i.url!=='string'||i.assigned_id_required!==undefined))
      ||(i.before!==null&&!object(i.before))||(i.after!==null&&!object(i.after)))return false;
    seen.add(i.item_id);
    if(schemaOperations.includes(i.operation)){
      const c=i.schema_comparison;
      if(!keys(c,['current_graph','proposed_graph','detection','identity_change','restored_unrendered_extra_types','source_evidence','frontend_output_verified','ownership_verified'],
        ['current_graph','proposed_graph','source_evidence','frontend_output_verified','ownership_verified'])
        ||c.frontend_output_verified!==false||c.ownership_verified!==false
        ||!keys(c.source_evidence,['job_id','capture_revision','captured_at','expires_at'])||!uuid(c.source_evidence.job_id)||!hash(c.source_evidence.capture_revision))return false;
    }else if(i.schema_comparison!==undefined)return false;
    if(state===null){if(r.approval_recorded)return false;continue;}
    if(!r.approval_recorded||!keys(state,['version','execution_id','item_id','state','attempts','committed_at','audit_id','changed','invalidation','stopped_at','reason','delivery','reversal','redirect_result','schema_result'],
      ['version','execution_id','item_id','state','attempts'])
      ||state.version!==1||!uuid(state.execution_id)||![0,1].includes(state.attempts)
      ||state.item_id!==i.item_id||!['pending','applied','failed','conflict','skipped'].includes(state.state))return false;
    if(state.state==='applied'&&(!positive(state.audit_id)||state.attempts!==1||!['pending','delivered'].includes(state.invalidation)))return false;
    if(state.delivery!==undefined&&!keys(state.delivery,['attempts','last_attempt_at','status','error_code']))return false;
    if(state.reversal!==undefined&&!keys(state.reversal,['change_set_id','execution_id','item_id','audit_id','operator_id','token_id','reverted_at']))return false;
    if(state.redirect_result!==undefined&&!keys(state.redirect_result,['redirect_id','before','after']))return false;
    if(state.schema_result!==undefined&&(!keys(state.schema_result,['policy','current_graph_hash','proposed_graph_hash','frontend_output_verified'])||state.schema_result.frontend_output_verified!==false))return false;
  }
  if(!inverse&&!p.items.some(i=>schemaOperations.includes(i.operation)))return false;
  if(r.registration===null)return !r.approval_recorded&&['planned','expired'].includes(r.state);
  const e=r.registration;
  if(!r.approval_recorded||!keys(e,['execution_id','state','registered_at','lease_until','finished_at','client_request_id','attestation','budget','stop','recovery'],
    ['execution_id','state','registered_at','lease_until','client_request_id','attestation','budget'])
    ||!uuid(e.execution_id)||e.state!==r.state||!attestation(e.attestation)||e.attestation.plan_hash!==r.envelope.plan_hash
    ||!positive(e.registered_at)||!positive(e.lease_until)||!requestId(e.client_request_id)
    ||e.attestation.change_set_id!==p.change_set_id||e.attestation.client_request_id!==e.client_request_id
    ||e.attestation.operator_id!==p.binding.operator_id||e.attestation.attested_by_token_id!==p.binding.token_id
    ||JSON.stringify(e.attestation.acknowledgements)!==JSON.stringify(p.required_acknowledgements)
    ||!keys(e.budget,['version','window_start','operation_count','operator_limit'],['version','window_start','operation_count','operator_limit']))return false;
  if(r.item_results.some(v=>v.execution_id!==e.execution_id)||e.budget.operation_count!==p.items.length
    ||(r.state==='executed'&&r.item_results.some(v=>v.state!=='applied'||v.invalidation!=='delivered')))return false;
  if(e.stop!==undefined&&!keys(e.stop,['item_id','reason','at']))return false;
  if(e.recovery!==undefined&&(!keys(e.recovery,['version','policy_version','recovery_mode','plan_hash','at','client_request_id','attestation'])
    ||e.recovery.policy_version!=='workflow-schema-recovery-1'||!attestation(e.recovery.attestation)))return false;
  return true;
}
