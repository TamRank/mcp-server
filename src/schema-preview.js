/** Typed native comparison only. Never accept graphs, actor claims or approval. */
import {z} from 'zod';
import {scanId} from './scan-maintenance.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text=z.string().max(1000).refine(v=>Buffer.byteLength(v,'utf8')<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v));
const url=z.string().max(4096).refine(v=>{
  if(Buffer.byteLength(v,'utf8')>4096||/[\s\x00-\x1f\x7f\\]/.test(v))return false;
  try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}
});
const identity=z.object({entity_type:z.enum(['Organization','LocalBusiness']).optional(),organization_name:text.optional(),
  website_url:z.union([z.literal(''),url]).optional(),logo_url:z.union([z.literal(''),url]).optional(),
  email:text.optional(),telephone:text.optional(),
  address:z.object({street:text.optional(),postal_code:text.optional(),city:text.optional(),country:text.optional()}).strict().refine(v=>Object.keys(v).length>0).optional(),
  social_profiles:z.array(url).max(20).refine(v=>new Set(v).size===v.length).optional(),
}).strict().refine(v=>Object.keys(v).length>0);
export const schemaPreviewItem=z.object({
  operation:z.enum(['schema.select','schema.detect','schema_settings.update']),
  target:z.object({post_id:id.optional(),site:z.literal('current').optional(),sample_post_id:id.optional()}).strict(),
  fields:z.object({source_job:z.object({job_id:scanId,revision:hash}).strict(),expected_revision:hash.optional(),
    main_type:z.enum(['WebPage','Article','BlogPosting']).optional(),
    extra_types:z.array(z.enum(['FAQPage','HowTo','VideoObject','ImageObject','BreadcrumbList'])).max(5).refine(v=>new Set(v).size===v.length).optional(),
    replace_manual:z.boolean().optional(),fields:identity.optional(),facts_confirmed:z.literal(true).optional(),
  }).strict(),
}).strict().refine(v=>{
  const setting=v.operation==='schema_settings.update',keys=['source_job',...(v.fields.expected_revision!==undefined?['expected_revision']:[]),
    ...(setting?['fields','facts_confirmed']:v.operation==='schema.select'?['main_type','extra_types','replace_manual']:[])];
  return JSON.stringify(Object.keys(v.target).sort())===JSON.stringify(setting?['sample_post_id','site']:['post_id'])
    &&keys.every(k=>v.fields[k]!==undefined)&&Object.keys(v.fields).every(k=>keys.includes(k));
});
export function validSchemaPreviewResponse(data,item){
  if(data?.contract_version!==2||data.full_v2_compatible!==false
    ||['plan_persisted','approval_recorded','provider_requested_this_call','execution_available','schema_proposals_available'].some(k=>data[k]!==false))return false;
  if(data.comparison?.contract!=='schema_selection_comparison_v1'||data.comparison?.source_evidence?.render_binding?.current_graph_matches!==true
    ||['frontend_output_verified','ownership_verified','execution_available'].some(k=>data.comparison[k]!==false))return false;
  const proposal=schemaPreviewItem.safeParse(data.proposal_item),revision=data.comparison?.revision;
  if(!proposal.success||!hash.safeParse(revision).success||proposal.data.fields.expected_revision!==revision
    ||data.comparison.operation!==item.operation)return false;
  // Compare values, not JSON property order; WordPress canonicalizes stored keys.
  const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
  return stable(proposal.data)===stable({...item,fields:{...item.fields,expected_revision:revision}})
    &&(item.fields.expected_revision===undefined||item.fields.expected_revision===revision);
}
