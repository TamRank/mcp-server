/** Fresh schema inverse comparison and exact stored proposal, never restoration values as input. */
import {z} from 'zod';
import {rollbackSchema} from './field-execution.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const jobs=z.record(uuid,z.object({job_id:uuid,revision:hash}).strict()).refine(v=>Object.keys(v).length<=25);
const previewShape={change_set_id:rollbackSchema.change_set_id,item_ids:rollbackSchema.item_ids,source_jobs:jobs};
const preview=z.object(previewShape).strict(),proposal=z.object({...previewShape,
  client_request_id:rollbackSchema.client_request_id,expected_revision:hash}).strict();
export const schemaRollbackShape={...rollbackSchema,client_request_id:rollbackSchema.client_request_id.optional(),
  source_jobs:jobs.optional(),expected_revision:hash.optional()};
export const isSchemaRollback=v=>v?.source_jobs!==undefined;
export const isSchemaRollbackPreview=v=>isSchemaRollback(v)&&v.client_request_id===undefined;
export const validSchemaRollbackInput=v=>preview.safeParse(v).success||proposal.safeParse(v).success;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed,required=allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k));
const stable=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const sameIds=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
const positive=v=>Number.isSafeInteger(v)&&v>0;
const schemaOps=['schema.select','schema.detect','schema_settings.update'];
// WordPress's renderer emits a JSON-LD @context/@graph object, not a JS array.
const graph=v=>Array.isArray(v)?v.every(object):keys(v,['@context','@graph'])
  &&v['@context']==='https://schema.org'&&Array.isArray(v['@graph'])&&v['@graph'].every(object);
export function matchesSchemaRollbackRequest(data,input){
  const p=data?.record?.envelope?.plan;
  if(!proposal.safeParse(input).success||p?.kind!=='rollback'||p.reverses?.change_set_id!==input.change_set_id||p.client_request_id!==input.client_request_id
    ||p.comparison_revision!==input.expected_revision||!sameIds(p.items?.map(i=>i.original_item_id),input.item_ids))return false;
  return Boolean(comparisonItems(p.items.map(({item_id,...item})=>item),input));
}
export function validSchemaRollbackPreview(data,input){
  let encoded;try{encoded=JSON.stringify(data);}catch{return false;}
  if(typeof encoded!=='string'||Buffer.byteLength(encoded)>1048576||!preview.safeParse(input).success
    ||!keys(data,['contract_version','comparison'])||data.contract_version!==1)return false;
  const c=data.comparison;
  if(!keys(c,['contract','change_set_id','original_plan_hash','revision','revision_scope','private_proofs_omitted','items','proposal_input','expires_at',
    'plan_persisted','approval_recorded','execution_available','provider_requested_this_call','frontend_output_verified','ownership_verified'])
    ||c.contract!=='schema_rollback_preview_v1'||c.change_set_id!==input.change_set_id||!hash.safeParse(c.original_plan_hash).success
    ||!hash.safeParse(c.revision).success||c.revision_scope!=='complete_native_comparison'||c.private_proofs_omitted!==true
    ||['plan_persisted','approval_recorded','execution_available','provider_requested_this_call','frontend_output_verified','ownership_verified'].some(k=>c[k]!==false)
    ||stable(c.proposal_input)!==stable({...input,item_ids:[...input.item_ids].sort(),expected_revision:c.revision})||!(c.expires_at===null||positive(c.expires_at))
    ||!Array.isArray(c.items)||!sameIds(c.items.map(i=>i?.original_item_id),input.item_ids))return false;
  const checked=comparisonItems(c.items,input);
  return Boolean(checked)&&c.expires_at===checked.expires_at;
}
function comparisonItems(items,input){
  let order=25,expires_at=null;const refs={},audits=new Set();
  for(const i of items){
    const redirect=['redirect.delete','redirect.update','redirect.restore'].includes(i?.operation);
    if(!keys(i,['original_item_id','original_order','audit_id','original_operation','operation','url','fields','before','after','assigned_id_required','target','schema_comparison'],
      ['original_item_id','original_order','audit_id','original_operation','operation','before','after','target'])
      ||!uuid.safeParse(i.original_item_id).success||!Number.isSafeInteger(i.original_order)||i.original_order<0||i.original_order>=order||!positive(i.audit_id)||audits.has(i.audit_id)
      ||![...schemaOps,'meta.update','social.update','image_alt.update','redirect.delete','redirect.update','redirect.restore'].includes(i.operation)
      ||i.operation!==({'redirect.create':'redirect.delete','redirect.update':'redirect.update','redirect.delete':'redirect.restore'}[i.original_operation]??i.original_operation)
      ||!(i.before===null||object(i.before))||!(i.after===null||object(i.after))
      ||!keys(i.target,['post_id','attachment_id','site','sample_post_id','source_url','redirect_id','original_redirect_id'],[])
      ||Object.keys(i.target).length===0||Object.entries(i.target).some(([k,v])=>k==='site'?v!=='current':k==='source_url'?typeof v!=='string':!positive(v))
      ||(redirect?i.url!==undefined||i.assigned_id_required!==(i.operation==='redirect.restore'):typeof i.url!=='string'||i.assigned_id_required!==undefined))return false;
    const targetKeys=redirect?['original_redirect_id']:i.operation==='schema_settings.update'?['site','sample_post_id']
      :i.operation==='image_alt.update'?['attachment_id']:['post_id'];
    if(!keys(i.target,targetKeys)||(!redirect&&(i.before===null||i.after===null))
      ||(!redirect&&!schemaOps.includes(i.operation)&&!object(i.fields)))return false;
    order=i.original_order;audits.add(i.audit_id);
    if(schemaOps.includes(i.operation)){
      const s=i.schema_comparison;
      if(!keys(s,['current_graph','proposed_graph','detection','identity_change','restored_unrendered_extra_types','source_evidence','frontend_output_verified','ownership_verified'],
        ['current_graph','proposed_graph','source_evidence','frontend_output_verified','ownership_verified'])
        ||!graph(s.current_graph)||!graph(s.proposed_graph)||s.frontend_output_verified!==false||s.ownership_verified!==false
        ||!keys(s.source_evidence,['job_id','capture_revision','captured_at','expires_at'])||!uuid.safeParse(s.source_evidence.job_id).success
        ||!hash.safeParse(s.source_evidence.capture_revision).success||!positive(s.source_evidence.captured_at)||!positive(s.source_evidence.expires_at)
        ||s.source_evidence.expires_at-s.source_evidence.captured_at!==900)return false;
      refs[i.original_item_id]={job_id:s.source_evidence.job_id,revision:s.source_evidence.capture_revision};
      expires_at=expires_at===null?s.source_evidence.expires_at:Math.min(expires_at,s.source_evidence.expires_at);
    }else if(i.schema_comparison!==undefined)return false;
  }
  return stable(refs)===stable(input.source_jobs)?{expires_at}:false;
}
