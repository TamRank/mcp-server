/** Exact private drafts only; never approval, execution, body or schema writes. */
import {z} from 'zod';
const text=n=>z.string().max(n).refine(v=>Buffer.byteLength(v,'utf8')<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v));
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const change=n=>z.object({mode:z.enum(['set','remove']),value:text(n).optional()}).strict()
  .refine(v=>v.mode==='set'?v.value!==undefined:v.value===undefined);
const item=z.object({operation:z.enum(['meta.update','image_alt.update']),
  target:z.object({post_id:id.optional(),attachment_id:id.optional()}).strict(),
  fields:z.object({meta_title:change(1000).optional(),meta_description:change(10000).optional(),alt_text:change(2000).optional()}).strict(),
}).strict().refine(v=>v.operation==='meta.update'
  ? v.target.post_id!==undefined&&v.target.attachment_id===undefined&&v.fields.alt_text===undefined&&Object.keys(v.fields).length>0
  : v.target.attachment_id!==undefined&&v.target.post_id===undefined&&Object.keys(v.fields).length===1&&v.fields.alt_text!==undefined);
export const fieldProposalSchema={
  client_request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/),
  origin:z.object({kind:z.literal('user_request'),reference:text(160).refine(v=>v.trim().length>0),summary:text(1000).refine(v=>v.trim().length>0)}).strict(),
  items:z.array(item).min(1).max(25),
};
export const validFieldProposal=a=>Buffer.byteLength(JSON.stringify(a),'utf8')<=262144
  &&new Set(a.items.map(v=>v.target.post_id??v.target.attachment_id)).size===a.items.length;
