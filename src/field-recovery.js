/** Frozen server-issued journal recovery; never a new website-write grant. */
import {z} from 'zod';
import {scanId} from './scan-maintenance.js';
import {confirmationBody,validExecutionResponse,fieldOperations,executionSchema} from './field-execution.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const fieldRecoveryAcks=['pending_items_will_not_run','applied_items_are_not_reversed'];
const acknowledgements=z.array(z.enum(fieldRecoveryAcks)).length(2);
const planShape=z.object({contract_version:z.literal(1),policy_version:z.literal('workflow-field-recovery-1'),
  binding:z.object({installation_id:scanId,blog_id:id,operator_id:id,token_id:id,site_origin:z.string().url().max(4096)}).strict(),
  change_set_id:scanId,original_plan_hash:hash,execution_id:scanId,original_token_id:id,expected_state_hash:hash,
  created_at:id,expires_at:id,items:z.array(z.object({item_id:scanId,operation:z.enum(fieldOperations),
    target:z.union([z.object({post_id:id}).strict(),z.object({attachment_id:id}).strict()]),url:z.string().url().max(4096),
    stored_state:z.enum(['applied','pending']),disposition:z.enum(['retain_applied','skip_pending'])}).strict()).min(1).max(25),
  website_writes:z.literal(0),required_acknowledgements:acknowledgements,approval_recorded:z.literal(false),execution_available:z.literal(false)}).strict();
const envelope=z.object({plan:z.record(z.unknown()).describe('Copy returned plan unchanged.'),plan_hash:hash,
  recovery_token:z.string().regex(/^trfr1\.[a-f0-9]{64}$/)}).strict();
export const fieldRecoverySchema=z.object({proposal:envelope,confirmation:z.object({plan_hash:hash,confirmed:z.literal(true),acknowledgements}).strict()}).strict();
export const recoveryExecutionSchema={...executionSchema,change_token:z.string().regex(/^(?:trce1|trcr1|trfr1)\.[a-f0-9]{64}$/),
  // Copy the exact acknowledgements from the returned plan. The closed
  // semantic validator below still checks both literals and their order.
  confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.string()).length(2).optional()}),
  recovery_plan:z.record(z.unknown()).optional()};
export const recoveryInput=a=>({proposal:{plan:a.recovery_plan,plan_hash:a.confirmation.plan_hash,recovery_token:a.change_token},confirmation:a.confirmation});
const sameAcks=a=>JSON.stringify(a)===JSON.stringify(fieldRecoveryAcks);
export function validRecoveryProposal(v,setId=null){
  if(!envelope.safeParse(v).success||!planShape.safeParse(v.plan).success||Buffer.byteLength(JSON.stringify(v),'utf8')>33024)return false;
  const p=v.plan;if((setId!==null&&p.change_set_id!==setId)||p.expires_at!==p.created_at+900||!sameAcks(p.required_acknowledgements))return false;
  let pending=false;const seen=new Set();
  for(const item of p.items){
    if(seen.has(item.item_id)||(item.operation==='image_alt.update')!==('attachment_id' in item.target))return false;seen.add(item.item_id);
    if(item.stored_state==='pending'){pending=true;if(item.disposition!=='skip_pending')return false;}
    else if(pending||item.disposition!=='retain_applied')return false;
  }
  return pending;
}
export function validRecoveryInput(v){return fieldRecoverySchema.safeParse(v).success&&validRecoveryProposal(v.proposal)
  &&v.confirmation.plan_hash===v.proposal.plan_hash&&sameAcks(v.confirmation.acknowledgements);}
export function recoveryBody(v,clientInfo){
  return {proposal:v.proposal,client_request_id:'mcp-recover-'+v.proposal.plan_hash,
    confirmation:{...confirmationBody(v,clientInfo).confirmation,acknowledgements:v.confirmation.acknowledgements}};
}
export function validRecoveryResult(data,proposal){
  if(!validExecutionResponse(data,proposal.plan.change_set_id,proposal.plan.original_plan_hash)||!['partial','failed'].includes(data.record.state))return false;
  const e=data.record.registration??data.record.history?.execution??data.record.history_record?.record?.history?.execution;
  return e?.recovery?.plan_hash===proposal.plan_hash&&e.recovery.attestation?.human_verified===false;
}
