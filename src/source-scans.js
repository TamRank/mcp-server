/** One source job, never a schema writer or a retrying background scan. */
import {z} from 'zod';
import {closeScanSchema} from './scan-maintenance.js';
import {workflowIdentity} from './workflow-identity.js';
export const sourceAcks=['anonymous_page_request','private_source_storage','source_is_not_verified_schema','no_automatic_retry'];
export const sourceConfirmation=z.object({
  plan_hash:closeScanSchema.expected_runtime_hash,confirmed:z.literal(true),
  agent:z.string().min(1).max(80).refine(v=>v.trim().length>0 && Buffer.byteLength(v,'utf8')<=80 && !/[\x00-\x1f\x7f<>]/.test(v)),
  acknowledgements:z.array(z.string()).length(4).refine(v=>v.every((item,i)=>item===sourceAcks[i])),
}).strict();
export function validSourceStart(a){
  if(a.mode==='run')return a.source_job_id!==undefined && a.client_request_id!==undefined && a.confirmation!==undefined
    &&a.post_ids===undefined &&a.expected_revision===undefined;
  return a.source_job_id===undefined &&a.confirmation===undefined &&a.post_ids?.length===1
    &&(a.mode==='plan'?a.expected_revision!==undefined &&a.client_request_id!==undefined:a.expected_revision===undefined &&a.client_request_id===undefined);
}
export function sourcePath(a){return '/scans/sources'+(a.mode==='run'?'/'+a.source_job_id+'/run':a.mode==='plan'?'/proposals':'/preview');}
export function sourceArgs(a){return a.mode==='run'?{source_job_id:a.source_job_id,client_request_id:a.client_request_id,
  confirmation:{...a.confirmation,mode:'chat_attested',agent:{name:a.confirmation.agent},client:{...workflowIdentity}}}
  :a.mode==='plan'?{post_id:a.post_ids[0],client_request_id:a.client_request_id,expected_revision:a.expected_revision}:{post_id:a.post_ids[0]};}
