/** Exact private drafts only; never approval, execution, body or schema writes. */
import {z} from 'zod';
const text=n=>z.string().max(n).refine(v=>Buffer.byteLength(v,'utf8')<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v));
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const change=n=>z.object({mode:z.enum(['set','remove']),value:text(n).optional()}).strict()
  .refine(v=>v.mode==='set'?v.value!==undefined:v.value===undefined);
const limits={meta_title:1000,meta_description:10000,alt_text:2000,social_title:1000,social_description:10000,social_image:4096};
const allowed={
  'meta.update':['meta_title','meta_description'],
  'image_alt.update':['alt_text'],
  'social.update':['social_title','social_description','social_image'],
};
const imageUrl=v=>{
  if(!/^https?:\/\//.test(v)||/[\s\x00-\x1f\\#]/.test(v))return false;
  try{const u=new URL(v);return Boolean(u.hostname)&&!u.username&&!u.password;}catch{return false;}
};
// A closed enum-keyed record avoids repeating the same value schema six times
// on the wire. Operation-specific fields and byte limits remain strictly checked.
const fields=z.record(z.enum(Object.keys(limits)),change(10000)).refine(v=>Object.entries(v).every(([k,c])=>
  c.mode==='remove'||(typeof c.value==='string'&&Buffer.byteLength(c.value,'utf8')<=limits[k]&&(k!=='social_image'||imageUrl(c.value)))));
const item=z.object({operation:z.enum(['meta.update','image_alt.update','social.update']),
  target:z.object({post_id:id.optional(),attachment_id:id.optional()}).strict(),
  fields,
}).strict().refine(v=>Object.keys(v.fields).length>0&&Object.keys(v.fields).every(k=>allowed[v.operation].includes(k))
  &&(v.operation==='image_alt.update'?v.target.attachment_id!==undefined&&v.target.post_id===undefined
    :v.target.post_id!==undefined&&v.target.attachment_id===undefined));
export const fieldProposalSchema={
  client_request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/),
  origin:z.union([
    z.object({kind:z.literal('user_request'),reference:text(160).refine(v=>v.trim().length>0),summary:text(1000).refine(v=>v.trim().length>0)}).strict(),
    z.object({kind:z.literal('action'),action_id:z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/),revision:id,snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  ]),
  items:z.array(item).min(1).max(25),
};
export const validFieldProposal=a=>Buffer.byteLength(JSON.stringify(a),'utf8')<=262144
  &&new Set(a.items.map(v=>v.target.post_id??v.target.attachment_id)).size===a.items.length;
