/** Canonical field workflow. Client provenance comes from MCP, never approval text. */
import {z} from 'zod';
import {scanId} from './scan-maintenance.js';
import {validHistoricalExecution} from './execution-history.js';
export const fieldOperations=['meta.update','social.update','image_alt.update'];
export const fieldExecutionPolicies=['workflow-field-execution-1','workflow-field-rollback-1'];
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const requestId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/);
export const executionSchema={change_set_id:scanId,change_token:z.string().regex(/^(?:trce1|trcr1)\.[a-f0-9]{64}$/),
  confirmation:z.object({plan_hash:digest,confirmed:z.literal(true)}).strict()};
export const rollbackSchema={change_set_id:scanId,client_request_id:requestId,
  item_ids:z.array(scanId).min(1).max(25).refine(v=>new Set(v).size===v.length)};
const label=(v,n)=>typeof v==='string'&&v.trim()!==''&&Buffer.byteLength(v,'utf8')<=n&&!/[<>\p{C}]/u.test(v);
export function confirmationBody(input,clientInfo){
  // An execution proposal is single-use. Exact retries derive the same request
  // identity, instead of inviting an agent to invent a new execution request.
  return {...input,client_request_id:'mcp-execute-'+input.confirmation.plan_hash,confirmation:{...input.confirmation,mode:'chat_attested',acknowledgements:[],
    client:{name:label(clientInfo?.name,80)?clientInfo.name:'unknown',version:label(clientInfo?.version,40)?clientInfo.version:null},
    agent:{name:'unknown'}}};
}
export function isFieldExecutionPlan(input,support){
  return support?.contract_version===1&&support.available===true&&Array.isArray(input.items)&&input.items.length>0
    &&input.items.every(i=>fieldOperations.includes(i.operation)&&support.operations?.includes(i.operation));
}
export function validExecutionResponse(data,id=null,hash=null,policies=fieldExecutionPolicies){
  if(data?.contract_version!==1||!data.record||typeof data.record!=='object'||Array.isArray(data.record))return false;
  const r=data.record,p=r.envelope?.plan,h=r.history??r.history_record?.record?.history;
  // Internal signed storage records are never valid public tool output.
  if(r.history_record!==undefined)return false;
  if(h&&policies.some(v=>v.startsWith('workflow-field-')||v.startsWith('workflow-redirect-')))
    return validHistoricalExecution(data,id,hash,policies);
  const resultId=p?.change_set_id??h?.change_set_id,resultHash=r.envelope?.plan_hash??h?.original_plan_hash;
  if(!scanId.safeParse(resultId).success||!digest.safeParse(resultHash).success||(id!==null&&id!==resultId)||(hash!==null&&hash!==resultHash))return false;
  if(p&&!policies.includes(p.policy_version))return false;
  if(h&&!['field_execution_history','unused_execution_history'].includes(h.kind))return false;
  if(h?.source_policy!==undefined&&!policies.includes(h.source_policy))return false;
  return ['planned','expired','running','executed','partial','failed','cancelled','retired','attribution_purged','attribution_retired'].includes(r.state);
}
