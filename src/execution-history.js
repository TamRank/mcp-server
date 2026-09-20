/** Closed, non-executable field/redirect history. Native ownership, signed
 * receipts and exact replay are still verified by WordPress, never by this view.
 */
import {z} from 'zod';
import {schemaHistoricalShape as base,schemaHistoricalRecordShape as baseRecord} from './schema-execution-history.js';
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),hash=z.string().regex(/^[a-f0-9]{64}$/);
const fields=['meta.update','social.update','image_alt.update'],redirects=['redirect.create','redirect.update','redirect.delete','redirect.restore'];
const policies=['workflow-field-execution-1','workflow-field-rollback-1','workflow-redirect-execution-1','workflow-redirect-rollback-1'];
const baseExecution=base.shape.execution.unwrap(),baseRecovery=baseExecution.shape.recovery.unwrap();
const fieldRecovery=baseRecovery.omit({policy_version:true,recovery_mode:true}).extend({version:z.literal(1)});
const redirectRecovery=baseRecovery.extend({version:z.literal(2),policy_version:z.literal('workflow-redirect-recovery-1')});
const execution=baseExecution.extend({recovery:z.union([fieldRecovery,redirectRecovery]).optional()}).nullable();
const item=base.shape.items.element.extend({operation:z.enum([...fields,...redirects]),
  result:base.shape.items.element.shape.result.unwrap().omit({schema_result:true}).nullable()});
const history=base.extend({source_policy:z.enum(policies),items:z.array(item).min(1).max(25),execution});
const unused=history.omit({origin:true}).extend({kind:z.literal('unused_execution_history'),state:z.literal('retired'),
  source_policy:z.enum(policies.slice(0,2)),attribution:z.union([base.shape.attribution,z.object({operator_id:id,token_id:id}).strict()]),
  payload_available:z.literal(false),retirement:z.object({at:id}).strict(),execution:z.null(),approval_recorded:z.literal(false),
  items:z.array(z.object({item_id:base.shape.change_set_id,operation:z.enum(fields)}).strict()).min(1).max(25)});
const record=baseRecord.extend({history:z.union([history,unused]),projection:baseRecord.shape.projection.extend({contract:z.literal('execution_history_view_v1')})});
const fieldNames={'meta.update':['meta_title','meta_description'],'social.update':['social_title','social_description','social_image'],'image_alt.update':['alt_text']};
const keys=(v,allowed)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
export function validHistoricalExecution(data,requestedId=null,requestedHash=null,allowed=policies){
  let encoded;try{encoded=JSON.stringify(data);}catch{return false;}
  if(typeof encoded!=='string'||Buffer.byteLength(encoded,'utf8')>1048576||!keys(data,['contract_version','record'])||data.contract_version!==1
    ||!record.safeParse(data.record).success)return false;
  const r=data.record,h=r.history,e=h.execution,inverse=h.change_kind==='rollback',redirect=h.source_policy.startsWith('workflow-redirect-');
  if(!allowed.includes(h.source_policy)||(requestedId!==null&&h.change_set_id!==requestedId)||(requestedHash!==null&&h.original_plan_hash!==requestedHash)
    ||h.source_policy!==`workflow-${redirect?'redirect':'field'}-${inverse?'rollback':'execution'}-1`
    ||r.state!==h.state||r.approval_recorded!==h.approval_recorded||h.approval_recorded!==(e!==null)
    ||h.expires_at!==h.created_at+86400||inverse!==!!h.reverses
    ||new Set(h.items.map(i=>i.item_id)).size!==h.items.length)return false;
  if(h.kind==='unused_execution_history')return !redirect&&h.retirement.at>=h.expires_at+1209600
    &&(h.attribution.removed_at===undefined||h.attribution.removed_at>=h.created_at);
  if(inverse===!!h.origin||h.attribution.removed_at<h.created_at||(!redirect&&h.items.some(i=>!fields.includes(i.operation)))
    ||(redirect&&!h.items.some(i=>redirects.includes(i.operation))))return false;
  if(!e&&!['planned','expired'].includes(h.state))return false;
  if(e&&(e.state!==h.state||e.attestation.plan_hash!==h.original_plan_hash||e.attestation.attribution_removed_at!==h.attribution.removed_at
    ||e.budget.operation_count!==h.items.length||e.lease_until<e.registered_at))return false;
  let previousOrder=25,applied=0;const acks=[];
  for(const i of h.items){
    if(inverse){if(i.original_item_id===undefined||i.original_order===undefined||i.audit_id===undefined
      ||(redirect?i.original_operation===undefined:i.original_operation!==undefined)||i.original_order>=previousOrder)return false;previousOrder=i.original_order;}
    else if(i.original_item_id!==undefined||i.original_order!==undefined||i.audit_id!==undefined||i.original_operation!==undefined||i.operation==='redirect.restore')return false;
    if(fields.includes(i.operation)){
      const target=i.operation==='image_alt.update'?'attachment_id':'post_id',names=fieldNames[i.operation];
      if(!keys(i.target,[target])||!id.safeParse(i.target[target]).success||!keys(i.before,names)||!keys(i.after,names)
        ||Object.keys(i.before).length===0||JSON.stringify(Object.keys(i.before).sort())!==JSON.stringify(Object.keys(i.after).sort())
        ||(i.fields!==undefined&&!keys(i.fields,names)))return false;
      for(const value of [...Object.values(i.before),...Object.values(i.after)])
        if(!keys(value,['exists','value'])||typeof value.exists!=='boolean'||!Object.hasOwn(value,'value'))return false;
    }else{
      const key=inverse?'original_redirect_id':i.operation==='redirect.create'?'source_url':'redirect_id';
      if(!keys(i.target,[key])||!Object.hasOwn(i.target,key))return false;
      if(i.operation==='redirect.delete'&&!acks.includes('redirect_deletion'))acks.push('redirect_deletion');
    }
    const s=i.result;if(!e){if(s!==null)return false;continue;}
    if(!s||s.item_id!==i.item_id||s.execution_id!==e.execution_id)return false;
    if(s.state==='applied'){
      applied++;if(!s.audit_id||s.attempts!==1||s.invalidation!=='delivered'||!s.committed_at)return false;
      if(redirects.includes(i.operation)&&!s.redirect_result)return false;
    }else if(s.audit_id!==undefined||s.changed!==undefined||s.invalidation!==undefined||s.delivery!==undefined||s.reversal!==undefined||s.redirect_result!==undefined)return false;
    if(s.redirect_result&&(!redirects.includes(i.operation)||s.state!=='applied'))return false;
  }
  if(e&&(JSON.stringify(acks.sort())!==JSON.stringify(e.attestation.acknowledgements)
    ||(h.state==='executed'?applied!==h.items.length:h.state!==(applied?'partial':'failed'))))return false;
  if(e?.recovery){const recovery=e.recovery;
    if(recovery.attestation.plan_hash!==recovery.plan_hash||recovery.attestation.attribution_removed_at!==h.attribution.removed_at
      ||(redirect?recovery.version!==2:recovery.version!==1))return false;
  }
  return true;
}
export function matchesHistoricalExecution(data,input){
  if(!validHistoricalExecution(data,input?.change_set_id,input?.confirmation?.plan_hash)||!data.record.approval_recorded)return false;
  const h=data.record.history,prefix={'workflow-field-execution-1':'trce1.','workflow-field-rollback-1':'trcr1.',
    'workflow-redirect-execution-1':'trcx1.','workflow-redirect-rollback-1':'trxr1.'}[h.source_policy];
  return typeof input.change_token==='string'&&input.change_token.startsWith(prefix)
    &&JSON.stringify(h.execution.attestation.acknowledgements)===JSON.stringify(input.confirmation.acknowledgements??[]);
}
