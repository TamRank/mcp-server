/** Private receipt bridge for explicit opt-in recovery. No scan start or automatic retry. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {WorkflowClient} from './workflow-rest.js';
import {ApiError} from './rest.js';
import {isScanReceipt, receiptSite} from './scan-receipt-store.js';
import {recoveryConfirmation,recoveryAcks} from './scan-recovery-chat.js';

const uuid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const request=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/);
const context=z.object({execution_id:uuid,receipt_reference:z.string().regex(/^receipt_[a-f0-9]{64}$/)}).strict();
const settlement=context.extend({client_request_id:request,expected_review_hash:hash,confirmed:z.literal(true),
  expected_runtime_hash:hash.optional(),confirmation:recoveryConfirmation.optional()}).strict();
const attemptSchema=z.object({execution_id:uuid,measurement_id:hash,client_request_id:request,expected_runtime_hash:hash}).strict();
const metric=z.number().finite().min(0).max(86400000).nullable();
const result=z.object({performance_score:z.number().finite().min(0).max(100),fcp_ms:metric,lcp_ms:metric,tbt_ms:metric,
  cls:z.number().finite().min(0).max(100).nullable(),provenance:z.object({provider:z.literal('google_pagespeed_insights'),
    request_hash:hash,fetch_time:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),lighthouse_version:z.string().min(1).max(32)}).strict().optional()}).strict();
const outcome=z.discriminatedUnion('outcome',[
  z.object({outcome:z.literal('succeeded'),request_hash:hash,result,error_code:z.null()}).strict(),
  z.object({outcome:z.literal('failed'),request_hash:hash,result:z.null(),error_code:z.literal('provider_rejected')}).strict()
]);
const id=z.number().int().positive().safe();
const state=z.enum(['not_started','started','succeeded','failed','uncertain','cancelled']);
const proposalSchema=z.object({policy:z.literal('pagespeed-settlement-chat-1'),operation:z.enum(['settle_and_stop','none']),
  execution_id:uuid,expected_runtime_hash:hash,actor:z.object({installation_id:uuid,blog_id:id,operator_id:id,token_id:id}).strict(),
  receipt_hash:hash,received_outcome:outcome,targets:z.array(z.object({measurement_id:hash,url:z.string().url().max(4096),
    strategy:z.enum(['mobile','desktop']),stored_state:state,after_state:state}).strict()).min(1).max(50),
  required_acknowledgements:z.array(z.string()).length(4).refine(v=>v.every((x,i)=>x===recoveryAcks[i]))}).strict();
const reviewSchema=z.object({contract_version:z.literal(2),view:z.literal('result_settlement_review'),execution_id:uuid,
  measurement_id:hash,attempt_input_hash:hash,expected_runtime_hash:hash,current_runtime_hash:hash,
  action:z.enum(['settle_and_stop','already_recorded','already_settled']),can_settle:z.boolean(),
  cancel_remaining:z.number().int().min(0).max(49),received_at:z.number().int().positive().safe(),
  observed_at:z.number().int().positive().safe(),received_outcome:outcome,
  execution_enabled:z.literal(false),provider_requested_this_call:z.literal(false),automatic_retry_allowed:z.literal(false),
  proposal:proposalSchema.optional(),proposal_hash:hash.optional(),proposal_json:z.string().max(262144).optional()}).strict();
const canonical=value=>JSON.stringify(sort(value));
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const error=code=>new ApiError(409,code,'Receipt reconciliation was refused. Read the current result; do not repeat the measurement.');
function parse(schema,input){const parsed=schema.safeParse(input);if(!parsed.success)throw error('scan_receipt_input_invalid');return parsed.data;}

export class ScanReceiptRecovery {
  #client; #store; #site;
  constructor({siteUrl,pat,receiptStore,timeoutMs=30000,routeStyle='pretty'}){
    if(!receiptStore || typeof receiptStore.load!=='function')throw error('scan_receipt_configuration_invalid');
    this.#site=receiptSite(siteUrl);this.#store=receiptStore;
    // Configuration is private and fixed for this driver; callers cannot switch sites during a load.
    this.#client=new WorkflowClient({siteUrl:this.#site,pat,timeoutMs,routeStyle});
  }
  async #load(input){
    try {
      const record=await this.#store.load(input.receipt_reference,{site_url:this.#site,execution_id:input.execution_id});
      const saved=record.receipt;
      if(saved.site_url!==this.#site || saved.execution_id!==input.execution_id || !isScanReceipt(saved.result_receipt))throw new Error();
      const attempt=parse(attemptSchema,{execution_id:saved.execution_id,measurement_id:saved.measurement_id,
        client_request_id:saved.attempt_request_id,expected_runtime_hash:saved.attempt_runtime_hash});
      return {attempt_input:attempt,result_receipt:saved.result_receipt};
    } catch {throw error('scan_receipt_load_failed');}
  }
  async #review(input,body){
    const raw=await this.#client.post('/scans/recovery/'+input.execution_id+'/receipt-review',body);
    const checked=reviewSchema.safeParse(raw);if(!checked.success)throw error('scan_receipt_review_invalid');
    const review=checked.data,canSettle=review.action==='settle_and_stop';
    if(review.execution_id!==input.execution_id || review.measurement_id!==body.attempt_input.measurement_id
      || review.attempt_input_hash!==digest(body.attempt_input) || review.can_settle!==canSettle
      || review.observed_at<review.received_at || (!canSettle && review.cancel_remaining!==0)
      || (canSettle && review.current_runtime_hash!==review.expected_runtime_hash))throw error('scan_receipt_review_invalid');
    if(review.proposal || review.proposal_hash || review.proposal_json){
      const p=review.proposal;
      // Preserve full hash validation across PHP's 0.0/exponent formatting and JavaScript JSON numbers.
      // Check the exact server canonical bytes AND equality of every parsed proposal field.
      let decoded;try{decoded=JSON.parse(review.proposal_json);}catch{throw error('scan_receipt_review_invalid');}
      if(!p || Buffer.byteLength(review.proposal_json,'utf8')>262144
        || createHash('sha256').update(review.proposal_json,'utf8').digest('hex')!==review.proposal_hash
        || canonical(decoded)!==canonical(p) || p.execution_id!==review.execution_id
        || p.expected_runtime_hash!==review.current_runtime_hash || digest(p.received_outcome)!==digest(review.received_outcome)
        || p.operation!==(canSettle?'settle_and_stop':'none') || new Set(p.targets.map(t=>t.measurement_id)).size!==p.targets.length
        || p.targets.filter(t=>t.stored_state==='not_started' && t.after_state==='cancelled').length!==review.cancel_remaining
        || p.targets.filter(t=>t.measurement_id===review.measurement_id).length!==1)throw error('scan_receipt_review_invalid');
      for(const t of p.targets){const expected=canSettle?(t.measurement_id===review.measurement_id?review.received_outcome.outcome:t.stored_state==='not_started'?'cancelled':t.stored_state):t.stored_state;
        if(t.after_state!==expected)throw error('scan_receipt_review_invalid');}
    }
    // Poll time is not consent material. Exact stored version, outcome and remainder are.
    // The duplicate canonical JSON is verified privately, not added to model context.
    const display={...review};delete display.proposal_json;
    const material={...display};delete material.observed_at;
    return {receipt_reference:input.receipt_reference,review_hash:digest({receipt_reference:input.receipt_reference,review:material}),review:display};
  }
  /** One read-only POST: the private packet is never placed in a URL or returned to a model. */
  async review(input){const parsed=parse(context,input);return this.#review(parsed,await this.#load(parsed));}
  /** Tool-facing review requires the full server proposal, not the earlier count-only format. */
  async reviewChat(input){const prepared=await this.review(input);
    if(!prepared.review.proposal || !prepared.review.proposal_hash)throw error('scan_receipt_review_upgrade_required');return prepared;}
  /** Explicit internal call only, after showing the exact review. confirmed is a client assertion, not human proof. */
  async settle(input){
    const parsed=parse(settlement,input),body=await this.#load(parsed),prepared=await this.#review(parsed,body);
    if(prepared.review_hash!==parsed.expected_review_hash)throw error('scan_receipt_review_changed');
    if(parsed.confirmation && (!prepared.review.proposal_hash || parsed.confirmation.review_hash!==prepared.review_hash
      || parsed.expected_runtime_hash!==prepared.review.expected_runtime_hash))throw error('scan_receipt_review_changed');
    if(!prepared.review.can_settle)return {contract_version:2,view:'result_settlement_not_needed',review:prepared.review,
      provider_requested_this_call:false,automatic_retry_allowed:false};
    // The WordPress transaction verifies this exact signed start again. Never use the local pre-start hash here.
    const response=await this.#client.post('/scans/recovery/'+parsed.execution_id+'/settle',{
      execution_id:parsed.execution_id,client_request_id:parsed.client_request_id,
      expected_runtime_hash:prepared.review.expected_runtime_hash,result_receipt:body.result_receipt,
      ...(parsed.confirmation?{confirmation:{...parsed.confirmation,review_hash:prepared.review.proposal_hash}}:{})});
    if(response.view!=='result_settlement' || response.execution_enabled!==false || response.provider_requested_this_call!==false
      || response.progress?.execution_id!==parsed.execution_id || typeof response.replayed!=='boolean'
      || typeof response.settlement_recorded!=='boolean')throw error('scan_receipt_result_invalid');
    return response;
  }
}
