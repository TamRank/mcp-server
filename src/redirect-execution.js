/** Opt-in redirect/mixed contracts on the existing exact execution routes. */
import {z} from 'zod';
import {scanId} from './scan-maintenance.js';
import {executionSchema,confirmationBody,fieldOperations,validExecutionResponse} from './field-execution.js';
import {fieldRecoveryPlanShape,fieldRecoveryAcks} from './field-recovery.js';
export const redirectOperations=['redirect.create','redirect.update','redirect.delete'];
export const redirectExecutionPolicies=['workflow-redirect-execution-1','workflow-redirect-rollback-1'];
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const redirectExecutionSchema={...executionSchema,change_token:z.string().regex(/^(?:trcx1|trxr1)\.[a-f0-9]{64}$/),
  confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.literal('redirect_deletion')).max(1)})};
// Compact wire schema; policy-specific closed validation below remains mandatory.
export const mixedExecutionSchema={...executionSchema,change_token:z.string().regex(/^(?:trce1|trcr1|trcx1|trxr1|trfr1|trrr1)\.[a-f0-9]{64}$/),
  confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.string()).max(2).optional()}),recovery_plan:z.record(z.unknown()).optional()};
export const redirectToken=v=>typeof v==='string'&&/^tr(?:cx|xr)1\./.test(v);
export const redirectRecoveryToken=v=>typeof v==='string'&&v.startsWith('trrr1.');
export const capability=(v,key)=>v?.contract_version===1&&v[key]===true;
export function isRedirectExecutionPlan(input,support){
  return capability(support,'available')&&Array.isArray(input.items)&&input.items.some(i=>redirectOperations.includes(i.operation))
    &&input.items.every(i=>[...fieldOperations,...redirectOperations].includes(i.operation)&&support.operations?.includes(i.operation))
    &&(input.items.every(i=>redirectOperations.includes(i.operation))||support.mixed_available===true);
}
export function redirectConfirmationBody(input,clientInfo){
  // Never manufacture the deletion acknowledgement; the tool input must copy it
  // after the exact proposal/warnings were shown and approved in chat.
  const body=confirmationBody(input,clientInfo);
  return {...body,confirmation:{...body.confirmation,
    acknowledgements:input.confirmation.acknowledgements}};
}
export function validRedirectExecutionResponse(data,setId=null,planHash=null,expectedPolicy=null){
  const policies=expectedPolicy?[expectedPolicy]:redirectExecutionPolicies;
  if(!validExecutionResponse(data,setId,planHash,policies))return false;
  const r=data.record,p=r.envelope?.plan;
  if(!p)return policies.includes((r.history??r.history_record?.record?.history)?.source_policy);
  const inverse=p.policy_version==='workflow-redirect-rollback-1',prefix=inverse?'trxr1':'trcx1';
  if(p.contract_version!==2||p.kind!==(inverse?'rollback':'forward')||!new RegExp('^'+prefix+'\\.[a-f0-9]{64}$').test(r.envelope.change_token)
    ||!Array.isArray(p.items)||p.items.length<1||p.items.length>25||p.frontend_verification!=='not_performed')return false;
  const seen=new Set();for(const i of p.items){
    if(!scanId.safeParse(i.item_id).success||seen.has(i.item_id)||![...fieldOperations,...redirectOperations,...(inverse?['redirect.restore']:[])].includes(i.operation))return false;
    seen.add(i.item_id);
  }
  return JSON.stringify(p.required_acknowledgements)===JSON.stringify(p.items.some(i=>i.operation==='redirect.delete')?['redirect_deletion']:[]);
}
export const redirectDeliveryAcks=['website_changes_will_not_run_again','applied_items_are_not_reversed'];
const sourceUrl=z.string().min(1).refine(v=>Buffer.byteLength(v,'utf8')<=255&&v.startsWith('/')&&!v.startsWith('//')&&!/[\s\\#\x00-\x1f]/u.test(v));
const redirectRecoveryItem=z.object({item_id:scanId,operation:z.enum([...redirectOperations,'redirect.restore']),
  target:z.union([z.object({source_url:sourceUrl}).strict(),z.object({redirect_id:id}).strict(),z.object({original_redirect_id:id}).strict()]),
  source_url:sourceUrl,actual_redirect_id:id.nullable(),stored_state:z.enum(['applied','pending']),disposition:z.enum(['retain_applied','skip_pending'])}).strict();
const recoveryPlan=fieldRecoveryPlanShape.extend({policy_version:z.literal('workflow-redirect-recovery-1'),source_policy:z.enum(redirectExecutionPolicies),
  recovery_mode:z.enum(['stop_pending','delivery_only']),required_acknowledgements:z.array(z.string()).length(2),
  items:z.array(z.union([fieldRecoveryPlanShape.shape.items.element,redirectRecoveryItem])).min(1).max(25)});
const recoveryEnvelope=z.object({plan:z.record(z.unknown()),plan_hash:hash,recovery_token:z.string().regex(/^trrr1\.[a-f0-9]{64}$/)}).strict();
const recoveryConfirmation=z.object({proposal:recoveryEnvelope,confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.string()).length(2)})}).strict();
export function validRedirectRecoveryProposal(v,setId=null){
  if(!recoveryEnvelope.safeParse(v).success||!recoveryPlan.safeParse(v.plan).success||Buffer.byteLength(JSON.stringify(v),'utf8')>33024)return false;
  const p=v.plan,inverse=p.source_policy==='workflow-redirect-rollback-1';
  if((setId!==null&&p.change_set_id!==setId)||p.expires_at!==p.created_at+900)return false;
  let pending=false;const seen=new Set();
  for(const i of p.items){
    if(seen.has(i.item_id))return false;seen.add(i.item_id);
    if(i.stored_state==='pending'){pending=true;if(i.disposition!=='skip_pending')return false;}
    else if(pending||i.disposition!=='retain_applied')return false;
    if(fieldOperations.includes(i.operation)){if((i.operation==='image_alt.update')!==('attachment_id' in i.target))return false;}
    else{
      const key=inverse?'original_redirect_id':i.operation==='redirect.create'?'source_url':'redirect_id';
      if(!(key in i.target)||(!inverse&&i.operation==='redirect.restore')||(i.stored_state==='pending')!==(i.actual_redirect_id===null))return false;
      if(key==='source_url'&&i.target.source_url!==i.source_url)return false;
    }
  }
  return p.recovery_mode===(pending?'stop_pending':'delivery_only')&&JSON.stringify(p.required_acknowledgements)===JSON.stringify(pending?fieldRecoveryAcks:redirectDeliveryAcks);
}
export function validRedirectRecoveryInput(v){return recoveryConfirmation.safeParse(v).success&&validRedirectRecoveryProposal(v.proposal)
  &&v.confirmation.plan_hash===v.proposal.plan_hash&&JSON.stringify(v.confirmation.acknowledgements)===JSON.stringify(v.proposal.plan.required_acknowledgements);}
export function validRedirectRecoveryResult(data,proposal){
  if(!validRedirectExecutionResponse(data,proposal.plan.change_set_id,proposal.plan.original_plan_hash,proposal.plan.source_policy))return false;
  const r=data.record,e=r.registration??r.history?.execution??r.history_record?.record?.history?.execution,mode=proposal.plan.recovery_mode;
  const states=mode==='delivery_only'?['running','executed']:[proposal.plan.items.some(i=>i.stored_state==='applied')?'partial':'failed'];
  return states.includes(r.state)&&e?.recovery?.plan_hash===proposal.plan_hash&&e.recovery.policy_version==='workflow-redirect-recovery-1'
    &&e.recovery.recovery_mode===mode&&e.recovery.attestation?.human_verified===false;
}
