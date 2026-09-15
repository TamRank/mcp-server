/** Administrative closure is separate from scan starts and all read tools. */
import { z } from 'zod';
import { rateLimitAdvice } from './workflow-rest.js';
export const scanId=z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
export const maintenanceAcks=['outcome_remains_unknown','inflight_provider_request_may_continue',
  'release_only_this_reservation_without_retry','preserve_original_results_and_approval'];
export const sourceMaintenanceAcks=['outcome_remains_unknown','inflight_provider_request_may_continue',
  'preserve_consumed_attempt_without_retry','preserve_original_results_and_approval'];
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const text=bytes=>z.string().min(1).max(bytes).refine(v=>v.trim().length>0 && Buffer.byteLength(v,'utf8')<=bytes && !/[\x00-\x1f\x7f<>]/.test(v));
export const closeScanSchema={execution_id:scanId,client_request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/),
  expected_runtime_hash:hash,confirmation:z.object({mode:z.literal('chat_attested'),review_hash:hash,confirmed:z.literal(true),
    client:z.object({name:text(80),version:text(40).nullable()}).strict(),agent:z.object({name:text(80)}).strict(),
    acknowledgements:z.array(z.string()).length(4).refine(v=>v.every((item,i)=>item===maintenanceAcks[i]))}).strict()};
export async function discoverSourceScans(client){
  try{const r=await client.get('/scans/sources/capabilities');return r.contract_version===2?r.schema_source_jobs||{available:false}:{available:false};}
  catch{return {available:false,read_available:false,execute_available:false};}
}

/** Only explicit development/specialist mode may discover this separate lane.
 * A licence denial may enter maintenance-only mode; auth/network failures may not.
 */
export async function discoverWorkflows(client,{preview=false,profile='core'}={}) {
  let capabilities=null,preflight={ok:true},maintenanceOnly=false;
  try {
    capabilities=await client.get('/capabilities');
    const compatible=capabilities.full_v2_compatible===true || capabilities.mcp_bridge_compatibility==='safe-beta-1';
    if(!compatible && !preview)
      preflight={ok:false,code:'workflow_upgrade_required',message:'This site has not activated a compatible TamRank workflow profile. Activate the safe beta profile in WordPress or use an explicit development preview; no legacy writer fallback.'};
  } catch(err) {
    preflight={ok:false,code:err.code || 'workflow_unavailable',message:'Workflow connection check failed. Check site, token and readiness, then restart.'};
    if(err.status===429)preflight={...preflight,message:'Connection check rate-limited. Wait before restarting; no automatic retry.',...rateLimitAdvice(err.data)};
  }
  if(preview && profile==='specialist' && (preflight.ok || preflight.code==='pro_required')) {
    try {
      const maintenance=await client.get('/scans/maintenance/capabilities');
      if(maintenance.scan_maintenance?.read_available===true || maintenance.scan_maintenance?.schema_source?.read_available===true) {
        maintenanceOnly=!preflight.ok;
        capabilities=maintenanceOnly?maintenance:{...capabilities,scan_maintenance:maintenance.scan_maintenance};
        preflight={ok:true};
      }
    } catch(err) {
      // Report maintenance throttling instead of asking an unpaid administrator to buy access.
      // A successful primary lane stays available; auth/network failures never gain access.
      if(!preflight.ok && preflight.code==='pro_required' && err.status===429)
        preflight={ok:false,code:'scan_maintenance_rate_limit',message:'Administrative maintenance is rate-limited. Wait before restarting; no automatic retry.',...rateLimitAdvice(err.data)};
    }
  }
  if(preview && profile==='specialist' && preflight.ok && !maintenanceOnly){
    // Load after this module's shared schemas initialize (source confirmations reuse them).
    const {discoverPageSpeedScans}=await import('./pagespeed-scans.js');
    capabilities={...capabilities,schema_source_jobs:await discoverSourceScans(client),pagespeed_execution:await discoverPageSpeedScans(client)};
  }
  return {capabilities,preflight,maintenanceOnly};
}
