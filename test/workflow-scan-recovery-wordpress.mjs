/** Invoked by PRO's owned full-WordPress fixture. Native REST/auth; synthetic saved result. */
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScanReceiptStore} from '../src/scan-receipt-store.js';
import {ScanReceiptRecovery} from '../src/scan-receipt-recovery.js';
import {WorkflowClient} from '../src/workflow-rest.js';
let bytes='';for await(const chunk of process.stdin){bytes+=chunk;assert.ok(bytes.length<250000);}
const {origin,fixture:f,style,scenario}=JSON.parse(bytes);
assert.match(origin,/^http:\/\/127\.0\.0\.1:[0-9]+(?:\/client-two)?$/);
assert.ok(['pretty','query'].includes(style));assert.ok(['pending','recorded'].includes(scenario));
const directory=await mkdtemp(join(await realpath(tmpdir()),'tamrank-native-recovery-'));
try {
  const store=new ScanReceiptStore({directory}),a=f.attempt_input;
  const saved=await store.save({site_url:origin,execution_id:f.execution_id,measurement_id:a.measurement_id,
    attempt_request_id:a.client_request_id,attempt_runtime_hash:a.expected_runtime_hash,result_receipt:f.result_receipt});
  const before=await readFile(join(directory,saved.receipt_reference+'.json'));
  const make=pat=>new ScanReceiptRecovery({siteUrl:origin,pat,receiptStore:new ScanReceiptStore({directory}),routeStyle:style});
  const driver=make(f.tokens.replacement.token),ctx={execution_id:f.execution_id,receipt_reference:saved.receipt_reference};
  const safe=v=>{const text=JSON.stringify(v);assert.ok(!text.includes('trsr1.'));assert.ok(!text.includes('tamrank_pat_'));};
  await assert.rejects(make(f.tokens.foreign.token).review(ctx),{code:'scan_execution_not_found'});
  const prepared=await driver.review(ctx);safe(prepared);
  assert.equal(prepared.review.can_settle,scenario==='pending');
  const input={...ctx,client_request_id:'native-client-settle-'+style,expected_review_hash:prepared.review_hash,confirmed:true};
  await assert.rejects(driver.settle({...input,confirmed:false}),{code:'scan_receipt_input_invalid'});
  await assert.rejects(driver.settle({...input,expected_review_hash:'f'.repeat(64)}),{code:'scan_receipt_review_changed'});
  const out=await driver.settle(input);safe(out);
  assert.equal(out.view,scenario==='pending'?'result_settlement':'result_settlement_not_needed');
  const reread=await make(f.tokens.replacement.token).review(ctx);safe(reread);
  assert.equal(reread.review.action,scenario==='pending'?'already_settled':'already_recorded');
  const noop=await driver.settle({...input,expected_review_hash:reread.review_hash});safe(noop);assert.equal(noop.view,'result_settlement_not_needed');
  const client=new WorkflowClient({siteUrl:origin,pat:f.tokens.replacement.token,routeStyle:style});
  const progress=await client.get('/scans/recovery/'+f.execution_id);safe(progress);
  assert.equal(progress.progress.state,scenario==='pending'?'cancelled':'reserved');
  assert.equal(progress.progress.runtime.measurements.length,50);
  assert.deepEqual(await readdir(directory),[saved.receipt_reference+'.json']);
  assert.deepEqual(await readFile(join(directory,saved.receipt_reference+'.json')),before);
  console.log(`PASS: native WordPress recovery client, ${style}/${scenario}, private reload/review/explicit settlement and redaction; no provider or MCP-tool mapping.`);
} finally {await rm(directory,{recursive:true,force:true});}
