/** Launched only by PRO's isolated SQL harness. Loopback HTTP is a fixture, not native WP routing. */
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {mkdtemp,realpath,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScanReceiptStore} from '../src/scan-receipt-store.js';
import {ScanReceiptRecovery} from '../src/scan-receipt-recovery.js';
import {WorkflowClient} from '../src/workflow-rest.js';

const lines=createInterface({input:process.stdin});const messages=[],waiting=[];
lines.on('line',line=>{const data=JSON.parse(line);if(waiting.length)waiting.shift()(data);else messages.push(data);});
const receive=()=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Fixture peer timed out')),15000);waiting.push(value=>{clearTimeout(timer);resolve(value);});});
const initial=await receive();assert.ok(['pretty','query'].includes(initial.style));
const directory=await mkdtemp(join(await realpath(tmpdir()),'tamrank-receipt-chain-'));
const pat='tamrank_pat_synthetic_receipt_chain_only';let total=0,privatePacket;
const http=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1'),path=url.searchParams.get('rest_route')||url.pathname;
    assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer '+pat);
    assert.ok(path.startsWith('/tamrank/v2/')||path.startsWith('/wp-json/tamrank/v2/'));
    const op=path.endsWith('/fixture/attempt')?'measure':path.endsWith('/receipt-review')?'review':path.endsWith('/settle')?'settle':null;
    assert.ok(op);let bytes='';for await(const chunk of req){bytes+=chunk;assert.ok(bytes.length<=16384);}
    total++;process.stdout.write(JSON.stringify({op,body:JSON.parse(bytes)})+'\n');
    const answer=await receive();if(answer.data?.data?.result_receipt)privatePacket=answer.data.data.result_receipt;
    res.writeHead(answer.status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(answer.data));
  } catch {res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'fixture_error'}));}
});
const safe=value=>{const text=JSON.stringify(value);assert.ok(!text.includes('trsr1.'));assert.ok(!text.includes(pat));};
try {
  await new Promise(r=>http.listen(0,'127.0.0.1',r));const siteUrl='http://127.0.0.1:'+http.address().port;
  const store=new ScanReceiptStore({directory}),client=new WorkflowClient({siteUrl,pat,receiptStore:store,routeStyle:initial.style});
  let ref;
  await assert.rejects(client.request('POST','/fixture/attempt',{body:initial.attempt,retainScanReceipt:true}),err=>{
    safe(err);assert.equal(err.data.receipt_retained,true);ref=err.data.receipt_reference;return true;});
  const names=await readdir(directory);assert.deepEqual(names,[ref+'.json']);const original=await readFile(join(directory,names[0]));
  assert.ok(original.toString().includes(privatePacket));assert.ok(!original.toString().includes(pat));
  // Reconstruct driver and file store without sharing capture client state.
  const recovery=new ScanReceiptRecovery({siteUrl,pat,receiptStore:new ScanReceiptStore({directory}),routeStyle:initial.style});
  const ctx={receipt_reference:ref,execution_id:initial.attempt.execution_id};
  const prepared=await recovery.review(ctx);safe(prepared);
  assert.notEqual(prepared.review.expected_runtime_hash,initial.attempt.expected_runtime_hash);
  const input={...ctx,client_request_id:'client-settlement-0001',expected_review_hash:prepared.review_hash,confirmed:true};
  const before=total;await assert.rejects(recovery.settle({...input,confirmed:false}),{code:'scan_receipt_input_invalid'});assert.equal(total,before);
  await assert.rejects(recovery.settle({...input,expected_review_hash:'f'.repeat(64)}),{code:'scan_receipt_review_changed'});assert.equal(total,before+1);
  if(initial.scenario==='lost_settlement_commit')await assert.rejects(recovery.settle(input),err=>{safe(err);assert.equal(err.code,'scan_execution_commit_uncertain');return true;});
  else {
    const out=await recovery.settle(input);safe(out);
    assert.equal(out.view,initial.scenario==='lost_result_commit'?'result_settlement_not_needed':'result_settlement');
    assert.equal(out.provider_requested_this_call,false);
  }
  const current=await recovery.review(ctx);safe(current);
  assert.equal(current.review.action,initial.scenario==='lost_result_commit'?'already_recorded':'already_settled');
  const noWrite=await recovery.settle({...input,expected_review_hash:current.review_hash});safe(noWrite);assert.equal(noWrite.view,'result_settlement_not_needed');
  assert.deepEqual(await readdir(directory),names);assert.deepEqual(await readFile(join(directory,names[0])),original);
  process.stdout.write(JSON.stringify({done:true})+'\n');
} finally {http.closeAllConnections();await new Promise(r=>http.close(r));lines.close();await rm(directory,{recursive:true,force:true});}
