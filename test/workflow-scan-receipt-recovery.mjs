import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScanReceiptStore} from '../src/scan-receipt-store.js';
import {ScanReceiptRecovery} from '../src/scan-receipt-recovery.js';

const siteUrl='https://fixture.invalid/client-a',pat='tamrank_pat_private_fixture';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const packet='trsr1.'+Buffer.from('not a real server signature').toString('base64url')+'.'+'a'.repeat(64);
const attempt={execution_id:id,measurement_id:'b'.repeat(64),client_request_id:'original-attempt-1',expected_runtime_hash:'c'.repeat(64)};
const attemptHash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(attempt).sort()))).digest('hex');
const saved={site_url:siteUrl,execution_id:id,measurement_id:attempt.measurement_id,attempt_request_id:attempt.client_request_id,
  attempt_runtime_hash:attempt.expected_runtime_hash,result_receipt:packet};
const fresh=()=>({contract_version:2,view:'result_settlement_review',execution_id:id,measurement_id:attempt.measurement_id,
  attempt_input_hash:attemptHash,expected_runtime_hash:'d'.repeat(64),current_runtime_hash:'d'.repeat(64),action:'settle_and_stop',
  can_settle:true,cancel_remaining:3,received_at:1800000000,observed_at:1800000001,
  received_outcome:{outcome:'succeeded',request_hash:'f'.repeat(64),result:{performance_score:0,fcp_ms:0,lcp_ms:null,tbt_ms:2,cls:0},error_code:null},
  execution_enabled:false,provider_requested_this_call:false,automatic_retry_allowed:false});
const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
const safe=value=>{const text=JSON.stringify(value);assert.ok(!text.includes('trsr1.'));assert.ok(!text.includes(pat));};

await test('Internal recovery bridge: explicit exact review, no private leakage or implicit writes',async t=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'tamrank-receipt-recovery-'));
  const store=new ScanReceiptStore({directory});const {receipt_reference}=await store.save(saved),ctx={execution_id:id,receipt_reference};
  const original=await readFile(join(directory,receipt_reference+'.json'));
  const realFetch=globalThis.fetch;let calls=[],review=fresh(),responseFault=null;
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),body:JSON.parse(options.body)});
    if(responseFault)return responseFault();
    return reply(String(url).endsWith('/receipt-review')?review:{contract_version:2,view:'result_settlement',execution_enabled:false,
      provider_requested_this_call:false,replayed:false,settlement_recorded:true,progress:{execution_id:id,runtime:{settlement:{result_receipt:packet}}}});
  };
  const driver=new ScanReceiptRecovery({siteUrl,pat,receiptStore:store});
  const input=async()=>({...ctx,client_request_id:'settlement-client-1',expected_review_hash:(await driver.review(ctx)).review_hash,confirmed:true});
  try {
    await t.test('Missing/local wrong-site evidence refuses before HTTP',async()=>{
      const before=calls.length;
      for(const v of [{...ctx,execution_id:other},{...ctx,receipt_reference:'receipt_'+'0'.repeat(64)}])
        await assert.rejects(driver.review(v),{code:'scan_receipt_load_failed'});
      const otherSite=new ScanReceiptRecovery({siteUrl:'https://fixture.invalid/client-b',pat,receiptStore:store});
      await assert.rejects(otherSite.review(ctx),{code:'scan_receipt_load_failed'});assert.equal(calls.length,before);
    });
    await t.test('Strict input and explicit confirmation: no model-provided result or force',async()=>{
      const valid=await input(),before=calls.length;
      for(const value of [{...valid,confirmed:false},{...valid,confirmed:undefined},{...valid,force:true},
        {...valid,result_receipt:packet},{...valid,client_request_id:'short'}, {...valid,expected_review_hash:1}])
        await assert.rejects(driver.settle(value),{code:'scan_receipt_input_invalid'});
      assert.equal(calls.length,before);
    });
    await t.test('Exact attempt is posted privately; output never contains packet or key',async()=>{
      const prepared=await driver.review(ctx);safe(prepared);
      assert.deepEqual(calls.at(-1).body,{attempt_input:attempt,result_receipt:packet});
      assert.ok(!calls.at(-1).url.includes(packet));assert.notEqual(prepared.review.expected_runtime_hash,saved.attempt_runtime_hash);
      const out=await driver.settle(await input());safe(out);
      assert.equal(calls.at(-1).body.expected_runtime_hash,'d'.repeat(64));assert.equal(calls.at(-1).body.result_receipt,packet);
    });
    await t.test('Observation time may advance, but changed evidence/version/remainder refuses the write',async()=>{
      const valid=await input();review.observed_at++;const out=await driver.settle(valid);safe(out);
      for(const patch of [{cancel_remaining:2},{received_outcome:{...review.received_outcome,result:{...review.received_outcome.result,performance_score:1}}},
        {expected_runtime_hash:'e'.repeat(64),current_runtime_hash:'e'.repeat(64)}]){
        review=fresh();const old=await input();review={...review,...patch};const before=calls.length;
        await assert.rejects(driver.settle(old),{code:'scan_receipt_review_changed'});assert.equal(calls.length,before+1);
      }
      review=fresh();
    });
    await t.test('Invalid/extra/cross-attempt server fields never become an approved plan',async()=>{
      for(const patch of [{execution_id:other},{measurement_id:'f'.repeat(64)},{attempt_input_hash:'f'.repeat(64)},
        {result_receipt:packet},{can_settle:false},{cancel_remaining:50},{observed_at:1},{execution_enabled:true},
        {current_runtime_hash:'e'.repeat(64)},{action:'force_release'},{received_outcome:{outcome:'uncertain'}}]){
        review={...fresh(),...patch};await assert.rejects(driver.review(ctx),err=>{safe(err);return err.code==='scan_receipt_review_invalid';});
      }
      review=fresh();
    });
    await t.test('Already recorded/settled results perform only a review, never another settlement',async()=>{
      for(const action of ['already_recorded','already_settled']){
        review={...fresh(),action,can_settle:false,cancel_remaining:0,current_runtime_hash:'e'.repeat(64)};
        const valid=await input(),before=calls.length,out=await driver.settle(valid);
        assert.equal(out.view,'result_settlement_not_needed');safe(out);assert.equal(calls.length,before+1);
      }
      review=fresh();
    });
    await t.test('Lost/failed review transport never submits settlement or invents a receipt',async()=>{
      const valid=await input();
      for(const factory of [()=>new Response('{bad',{status:500}),()=>new Response('',{status:302}),()=>{throw Error(packet+' '+pat);},
        ()=>new Response(JSON.stringify({code:'denied',message:packet+' '+pat}),{status:403})]){
        const before=calls.length;responseFault=factory;
        await assert.rejects(driver.settle(valid),err=>{safe(err);return true;});assert.equal(calls.length,before+1);
      }
      responseFault=null;
    });
    await t.test('Unexpected settlement response stays uncertain; no automatic retry',async()=>{
      const valid=await input(),before=calls.length;let count=0;
      responseFault=()=>reply(++count===1?fresh():{contract_version:2,view:'different_operation'});
      await assert.rejects(driver.settle(valid),err=>{safe(err);return err.code==='scan_receipt_result_invalid';});
      assert.equal(calls.length,before+2);responseFault=null;
    });
    assert.deepEqual(await readdir(directory),[receipt_reference+'.json']);assert.deepEqual(await readFile(join(directory,receipt_reference+'.json')),original);
  } finally {globalThis.fetch=realFetch;await rm(directory,{recursive:true,force:true});}
});
