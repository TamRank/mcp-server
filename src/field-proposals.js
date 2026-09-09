/** Exact private drafts only; never approval, execution, body or schema writes. */
import {z} from 'zod';
const text=n=>z.string().max(n).refine(v=>Buffer.byteLength(v,'utf8')<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v));
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const change=n=>z.object({mode:z.enum(['set','remove']),value:z.union([text(n),z.number().int(),z.boolean()]).optional()}).strict()
  .refine(v=>v.mode==='set'?v.value!==undefined:v.value===undefined);
const limits={meta_title:1000,meta_description:10000,alt_text:2000,social_title:1000,social_description:10000,social_image:4096};
const allowed={
  'meta.update':['meta_title','meta_description'],
  'image_alt.update':['alt_text'],
  'social.update':['social_title','social_description','social_image'],
  'redirect.create':['target_url','redirect_type'],
  'redirect.update':['source_url','target_url','redirect_type'],
  'redirect.delete':['acknowledge_deletion'],
};
const redirectFields=['source_url','target_url','redirect_type','acknowledge_deletion'];
const redirectUrl=(v,source=false)=>{
  if(typeof v!=='string'||Buffer.byteLength(v,'utf8')>255||!v||/[\x00-\x20\x7f\\#]/.test(v)
    ||/%(?![a-f0-9]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(v)||v.startsWith('//'))return false;
  if(source&&!v.startsWith('/'))return false;
  const value=v.startsWith('/')?'https://shape.invalid'+v:v;
  const m=value.match(/^https?:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?$/);
  if(!m||!imageUrl(value))return false;
  return !/%(?:2f|5c|25)/i.test(m[2])&&!/(?:^|\/)\.{1,2}(?:\/|$)/.test(m[2].replace(/%2e/ig,'.'));
};
const imageUrl=v=>{
  if(!/^https?:\/\//.test(v)||/[\s\x00-\x1f\\#]/.test(v))return false;
  try{const u=new URL(v);return Boolean(u.hostname)&&!u.username&&!u.password;}catch{return false;}
};
// A closed enum-keyed record avoids repeating the same value schema six times
// on the wire. Operation-specific fields and byte limits remain strictly checked.
const fields=z.record(z.enum([...Object.keys(limits),...redirectFields]),change(10000)).refine(v=>Object.entries(v).every(([k,c])=>{
  if(redirectFields.includes(k))return c.mode==='set'&&(k==='redirect_type'?[301,302,307,410,451].includes(c.value):
    k==='acknowledge_deletion'?c.value===true:k==='source_url'?redirectUrl(c.value,true):c.value===''||redirectUrl(c.value));
  return c.mode==='remove'||(typeof c.value==='string'&&Buffer.byteLength(c.value,'utf8')<=limits[k]&&(k!=='social_image'||imageUrl(c.value)));
}));
const item=z.object({operation:z.enum(Object.keys(allowed)),
  target:z.object({post_id:id.optional(),attachment_id:id.optional(),redirect_id:id.optional(),source_url:text(255).optional()}).strict(),
  fields,
}).strict().refine(v=>{
  const keys=Object.keys(v.fields),redirect=v.operation.startsWith('redirect.');
  const key=redirect?(v.operation==='redirect.create'?'source_url':'redirect_id'):v.operation==='image_alt.update'?'attachment_id':'post_id';
  if(!keys.length||!keys.every(k=>allowed[v.operation].includes(k))||Object.keys(v.target).length!==1||v.target[key]===undefined)return false;
  if(!redirect)return true;
  if(keys.length!==allowed[v.operation].length||(key==='source_url'&&!redirectUrl(v.target.source_url,true)))return false;
  return v.operation==='redirect.delete'||(v.fields.redirect_type.value>=400?v.fields.target_url.value==='':v.fields.target_url.value!=='');
});
export const fieldProposalSchema={
  client_request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/),
  origin:z.union([
    z.object({kind:z.literal('user_request'),reference:text(160).refine(v=>v.trim().length>0),summary:text(1000).refine(v=>v.trim().length>0)}).strict(),
    z.object({kind:z.literal('action'),action_id:z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/),revision:id,snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  ]),
  items:z.array(item).min(1).max(25),
};
export const validFieldProposal=a=>Buffer.byteLength(JSON.stringify(a),'utf8')<=262144
  &&new Set(a.items.map(v=>v.operation==='redirect.create'?'redirect-source:'+v.target.source_url:
    v.operation.startsWith('redirect.')?'redirect-id:'+v.target.redirect_id:'post:'+ (v.target.post_id??v.target.attachment_id))).size===a.items.length;
