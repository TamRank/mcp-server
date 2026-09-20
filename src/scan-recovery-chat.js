/** Same-user received-result closure; distinct from administrative unknown closure. */
import {z} from 'zod';
export const receiptReference=z.string().regex(/^(?:server_)?receipt_[a-f0-9]{64}$/);
export const recoveryAcks=['record_only_the_received_result','stop_all_unstarted_measurements',
  'no_remeasurement_or_website_change','preserve_original_results_and_approval'];
const text=bytes=>z.string().min(1).max(bytes).refine(v=>v.trim().length>0 && Buffer.byteLength(v,'utf8')<=bytes && !/[\x00-\x1f\x7f<>]/.test(v));
export const recoveryConfirmation=z.object({mode:z.literal('chat_attested'),review_hash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true),
  client:z.object({name:text(80),version:text(40).nullable()}).strict(),agent:z.object({name:text(80)}).strict(),
  acknowledgements:z.array(z.string()).length(4).refine(v=>v.every((item,i)=>item===recoveryAcks[i]))}).strict();

export async function discoverRecovery(client,{preview=false,profile='core',preflight,maintenanceOnly=false}={}){
  if(!preview || profile!=='specialist' || !preflight?.ok || maintenanceOnly)return null;
  try {const c=(await client.get('/scans/recovery/capabilities')).scan_recovery;
    return c?.chat_review_contract===1?c:null;
  } catch {return null;}
}
