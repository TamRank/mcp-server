/** Closed, non-executable display after removal of direct attribution.
 * Native WordPress still verifies the signed private record and current owner.
 * This validator never authenticates a record or creates permission to write.
 */
import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/).refine(v=>Number.isFinite(Date.parse(v)));
const text=z.string().max(4096),values=z.record(z.unknown()).nullable();
const attestation=z.object({mode:z.literal('chat_attested'),received_at:timestamp,plan_hash:hash,statement:z.literal('user approved in chat'),
  acknowledgements:z.array(z.string()).max(3).refine(v=>new Set(v).size===v.length),provenance_asserted:z.literal(true),human_verified:z.literal(false),
  attribution_removed_at:id}).strict();
const result=z.object({version:z.literal(1),execution_id:uuid,item_id:uuid,state:z.enum(['applied','failed','conflict','skipped']),attempts:z.union([z.literal(0),z.literal(1)]),
  committed_at:id.optional(),audit_id:id.optional(),changed:z.boolean().optional(),invalidation:z.enum(['pending','delivered']).optional(),
  stopped_at:id.optional(),reason:z.string().max(100).optional(),
  delivery:z.object({attempts:z.number().int().nonnegative(),last_attempt_at:id,status:z.string(),error_code:z.string().nullable()}).strict().optional(),
  reversal:z.object({change_set_id:uuid,execution_id:uuid,item_id:uuid,audit_id:id,reverted_at:id,attribution_removed_at:id}).strict().optional(),
  redirect_result:z.object({redirect_id:id,before:values,after:values}).strict().optional(),
  schema_result:z.object({policy:z.enum(['native-schema-item-1','native-schema-rollback-item-1']),current_graph_hash:hash,proposed_graph_hash:hash,
    frontend_output_verified:z.literal(false)}).strict().optional()}).strict();
const execution=z.object({execution_id:uuid,state:z.enum(['executed','partial','failed']),registered_at:id,lease_until:id,finished_at:id.optional(),
  attestation,budget:z.object({version:z.literal(1),window_start:z.number().int().nonnegative(),operation_count:id,operator_limit:id}).strict(),
  stop:z.object({item_id:uuid,reason:z.string().max(100),at:id}).strict().optional(),
  recovery:z.object({version:z.literal(3),policy_version:z.literal('workflow-schema-recovery-1'),recovery_mode:z.enum(['stop_pending','delivery_only']),
    plan_hash:hash,at:id,attestation}).strict().optional()}).strict().nullable();
const schemaOps=['schema.select','schema.detect','schema_settings.update'];
const item=z.object({item_id:uuid,operation:z.enum([...schemaOps,'meta.update','social.update','image_alt.update','redirect.create','redirect.update','redirect.delete','redirect.restore']),
  target:z.object({post_id:id.optional(),attachment_id:id.optional(),site:z.literal('current').optional(),sample_post_id:id.optional(),
    source_url:text.optional(),redirect_id:id.optional(),original_redirect_id:id.optional()}).strict(),
  url:text.optional(),fields:z.record(z.unknown()).optional(),before:values,after:values,result:result.nullable(),
  original_item_id:uuid.optional(),original_order:z.number().int().min(0).max(24).optional(),audit_id:id.optional(),original_operation:z.string().optional(),
  assigned_id_required:z.boolean().optional()}).strict();
const history=z.object({contract_version:z.literal(1),kind:z.literal('field_execution_history'),change_set_id:uuid,change_kind:z.enum(['forward','rollback']),
  source_policy:z.enum(['workflow-schema-execution-1','workflow-schema-rollback-1']),original_plan_hash:hash,
  site:z.object({installation_id:uuid,blog_id:id,site_origin:z.string().url()}).strict(),attribution:z.object({removed_at:id}).strict(),
  created_at:id,expires_at:id,state:z.enum(['planned','expired','executed','partial','failed']),action_id:uuid.nullable(),
  origin:z.object({kind:z.string(),reference:text,summary:text,action_id:uuid.optional(),revision:hash.optional(),snapshot_hash:hash.optional()}).strict().optional(),
  reverses:z.object({change_set_id:uuid,plan_hash:hash,execution_id:uuid,action_id:uuid.nullable()}).strict().optional(),
  approval_recorded:z.boolean(),execution_available:z.literal(false),items:z.array(item).min(1).max(25),execution}).strict();
const record=z.object({state:z.string(),history,approval_recorded:z.boolean(),execution_available:z.literal(false),
  projection:z.object({contract:z.literal('schema_execution_view_v1'),private_proofs_omitted:z.literal(true),plan_hash_scope:z.literal('complete_stored_plan')}).strict()}).strict();
export function validSchemaExecutionHistory(r){
  if(!record.safeParse(r).success)return false;
  const h=r.history,e=h.execution,inverse=h.change_kind==='rollback';
  if(r.state!==h.state||r.approval_recorded!==h.approval_recorded||h.approval_recorded!==(e!==null)
    ||h.source_policy!==(inverse?'workflow-schema-rollback-1':'workflow-schema-execution-1')||inverse!==!!h.reverses||inverse===!!h.origin
    ||h.expires_at<=h.created_at||h.expires_at>h.created_at+86400||h.attribution.removed_at<h.created_at
    ||new Set(h.items.map(i=>i.item_id)).size!==h.items.length||(!inverse&&!h.items.some(i=>schemaOps.includes(i.operation))))return false;
  if(e&&(e.state!==h.state||e.attestation.plan_hash!==h.original_plan_hash||e.attestation.attribution_removed_at!==h.attribution.removed_at
    ||e.budget.operation_count!==h.items.length||e.lease_until<e.registered_at))return false;
  if(!e&&!['planned','expired'].includes(h.state))return false;
  const acks=new Set();let previousOrder=25;
  for(const i of h.items){
    if(!Object.keys(i.target).length)return false;
    if(inverse){if(i.original_item_id===undefined||i.original_order===undefined||i.audit_id===undefined||i.original_operation===undefined||i.original_order>=previousOrder)return false;previousOrder=i.original_order;}
    else if(i.original_item_id!==undefined||i.original_order!==undefined||i.audit_id!==undefined||i.original_operation!==undefined)return false;
    if(i.operation==='redirect.delete')acks.add('redirect_deletion');
    if(i.operation==='schema_settings.update')acks.add('site_wide_identity');
    if(i.operation==='schema.select'&&(inverse||i.fields?.replace_manual))acks.add('replace_manual_schema');
    const s=i.result;if(!e){if(s!==null)return false;continue;}
    if(!s||s.item_id!==i.item_id||s.execution_id!==e.execution_id)return false;
    if(s.state==='applied'&&(!s.audit_id||s.attempts!==1||!s.invalidation))return false;
    if(schemaOps.includes(i.operation)&&s.state==='applied'&&!s.schema_result)return false;
    if(h.state==='executed'&&(s.state!=='applied'||s.invalidation!=='delivered'))return false;
    if(s.schema_result&&(!schemaOps.includes(i.operation)||s.state!=='applied'||s.schema_result.policy!==(inverse?'native-schema-rollback-item-1':'native-schema-item-1')))return false;
  }
  if(e&&JSON.stringify([...acks].sort())!==JSON.stringify(e.attestation.acknowledgements))return false;
  if(e?.recovery&&(e.recovery.attestation.plan_hash!==e.recovery.plan_hash||e.recovery.attestation.attribution_removed_at!==h.attribution.removed_at))return false;
  return true;
}
export function matchesSchemaHistoricalExecution(data,input){
  const r=data?.record,h=r?.history,e=h?.execution;
  if(typeof input?.change_token!=='string'||!input?.confirmation)return false;
  return validSchemaExecutionHistory(r)&&r.approval_recorded&&h.change_set_id===input.change_set_id&&h.original_plan_hash===input.confirmation.plan_hash
    &&(input.change_token.startsWith('trsr1.')?h.change_kind==='rollback':input.change_token.startsWith('trse1.')&&h.change_kind==='forward')
    &&JSON.stringify(e.attestation.acknowledgements)===JSON.stringify(input.confirmation.acknowledgements);
}
