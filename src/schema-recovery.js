/** Separate consent for schema journal/cache recovery, never a website writer. */
import {z} from 'zod';
import {scanId} from './scan-maintenance.js';
import {executionSchema,fieldOperations} from './field-execution.js';
import {fieldRecoveryPlanShape,fieldRecoveryAcks} from './field-recovery.js';
import {redirectOperations,redirectDeliveryAcks} from './redirect-execution.js';
import {schemaOperations,schemaExecutionPolicies,validSchemaExecutionResponse} from './schema-execution.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const sourceUrl=z.string().min(1).refine(v=>Buffer.byteLength(v,'utf8')<=255&&v.startsWith('/')&&!v.startsWith('//')&&!/[\s\\#\x00-\x1f]/u.test(v));
const state={stored_state:z.enum(['applied','pending']),disposition:z.enum(['retain_applied','skip_pending'])};
const schemaItem=z.object({item_id:scanId,operation:z.enum(schemaOperations),
  target:z.union([z.object({post_id:id}).strict(),z.object({site:z.literal('current'),sample_post_id:id}).strict()]),
  url:z.string().url().max(4096),...state}).strict();
const redirectItem=z.object({item_id:scanId,operation:z.enum([...redirectOperations,'redirect.restore']),
  target:z.union([z.object({source_url:sourceUrl}).strict(),z.object({redirect_id:id}).strict(),z.object({original_redirect_id:id}).strict()]),
  source_url:sourceUrl,actual_redirect_id:id.nullable(),...state}).strict();
const plan=fieldRecoveryPlanShape.extend({policy_version:z.literal('workflow-schema-recovery-1'),source_policy:z.enum(schemaExecutionPolicies),
  recovery_mode:z.enum(['stop_pending','delivery_only']),required_acknowledgements:z.array(z.string()).length(2),
  items:z.array(z.union([fieldRecoveryPlanShape.shape.items.element,schemaItem,redirectItem])).min(1).max(25)});
const envelope=z.object({plan:z.record(z.unknown()),plan_hash:hash,recovery_token:z.string().regex(/^trscr1\.[a-f0-9]{64}$/)}).strict();
const confirmation=z.object({proposal:envelope,confirmation:executionSchema.confirmation.extend({acknowledgements:z.array(z.string()).length(2)})}).strict();
export const schemaRecoveryToken=v=>typeof v==='string'&&v.startsWith('trscr1.');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validSchemaRecoveryProposal(v,setId=null){
  if(!envelope.safeParse(v).success||!plan.safeParse(v.plan).success||Buffer.byteLength(JSON.stringify(v),'utf8')>33024)return false;
  const p=v.plan,inverse=p.source_policy==='workflow-schema-rollback-1';
  if((setId!==null&&p.change_set_id!==setId)||p.expires_at!==p.created_at+900)return false;
  let pending=false;const seen=new Set();
  for(const i of p.items){
    if(seen.has(i.item_id))return false;seen.add(i.item_id);
    if(i.stored_state==='pending'){pending=true;if(i.disposition!=='skip_pending')return false;}
    else if(pending||i.disposition!=='retain_applied')return false;
    if(schemaOperations.includes(i.operation)){
      if((i.operation==='schema_settings.update')!==('site' in i.target))return false;
    }else if(fieldOperations.includes(i.operation)){
      if((i.operation==='image_alt.update')!==('attachment_id' in i.target))return false;
    }else{
      const key=inverse?'original_redirect_id':i.operation==='redirect.create'?'source_url':'redirect_id';
      if(!(key in i.target)||(!inverse&&i.operation==='redirect.restore')||(i.stored_state==='pending')!==(i.actual_redirect_id===null))return false;
      if(key==='source_url'&&i.target.source_url!==i.source_url)return false;
    }
  }
  // An inverse may intentionally select only fields/redirects from a schema set.
  return (inverse||p.items.some(i=>schemaOperations.includes(i.operation)))
    &&p.recovery_mode===(pending?'stop_pending':'delivery_only')
    &&same(p.required_acknowledgements,pending?fieldRecoveryAcks:redirectDeliveryAcks);
}
export function validSchemaRecoveryInput(v){return confirmation.safeParse(v).success&&validSchemaRecoveryProposal(v.proposal)
  &&v.confirmation.plan_hash===v.proposal.plan_hash&&same(v.confirmation.acknowledgements,v.proposal.plan.required_acknowledgements);}
export function validSchemaRecoveryResult(data,proposal){
  if(!validSchemaRecoveryProposal(proposal)||!validSchemaExecutionResponse(data,proposal.plan.change_set_id,proposal.plan.original_plan_hash))return false;
  const r=data.record,p=proposal.plan,stored=r.envelope.plan,e=r.registration,receipt=e?.recovery;
  const states=p.recovery_mode==='delivery_only'?['running','executed']:[p.items.some(i=>i.stored_state==='applied')?'partial':'failed'];
  if(!states.includes(r.state)||stored.policy_version!==p.source_policy||e?.execution_id!==p.execution_id
    ||stored.binding.token_id!==p.original_token_id||stored.binding.operator_id!==p.binding.operator_id
    ||stored.binding.blog_id!==p.binding.blog_id||stored.binding.installation_id!==p.binding.installation_id||stored.binding.site_origin!==p.binding.site_origin
    ||receipt?.version!==3||!Number.isSafeInteger(receipt.at)||receipt.at<p.created_at||receipt.at>=p.expires_at
    ||receipt.policy_version!=='workflow-schema-recovery-1'||receipt.plan_hash!==proposal.plan_hash
    ||receipt.recovery_mode!==p.recovery_mode||receipt.attestation?.plan_hash!==proposal.plan_hash
    ||receipt.attestation.change_set_id!==p.change_set_id||receipt.attestation.operator_id!==p.binding.operator_id
    ||receipt.attestation.attested_by_token_id!==p.binding.token_id||receipt.attestation.human_verified!==false
    ||receipt.client_request_id!=='mcp-recover-'+proposal.plan_hash||receipt.attestation.client_request_id!==receipt.client_request_id
    ||!same(receipt.attestation.acknowledgements,p.required_acknowledgements)||stored.items.length!==p.items.length)return false;
  return p.items.every((i,n)=>{
    const item=stored.items[n],result=r.item_results[n];
    return item.item_id===i.item_id&&item.operation===i.operation
      &&Object.keys(i.target).length===Object.keys(item.target).length&&Object.entries(i.target).every(([k,v])=>item.target[k]===v)
      &&(i.url!==undefined?item.url===i.url:(item.after??item.before)?.source_url===i.source_url
        &&(i.stored_state!=='applied'||result.redirect_result?.redirect_id===i.actual_redirect_id))
      &&(i.stored_state==='applied'?result.state==='applied'&&result.attempts===1:result.state==='skipped'&&result.attempts===0);
  });
}
