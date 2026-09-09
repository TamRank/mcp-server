/** Invoked by PRO's owned full-WordPress fixture. Native REST/auth; synthetic saved result. */
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScanReceiptStore} from '../src/scan-receipt-store.js';
import {ScanReceiptRecovery} from '../src/scan-receipt-recovery.js';
import {WorkflowClient} from '../src/workflow-rest.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
let bytes='';for await(const chunk of process.stdin){bytes+=chunk;assert.ok(bytes.length<250000);}
const {origin,fixture:f,style,scenario}=JSON.parse(bytes);
assert.match(origin,/^http:\/\/127\.0\.0\.1:[0-9]+(?:\/client-two)?$/);
assert.ok(['pretty','query'].includes(style));assert.ok(['pending','recorded'].includes(scenario));
const directory=await mkdtemp(join(await realpath(tmpdir()),'tamrank-native-recovery-'));
const mcp=new Client({name:'native-recovery-test',version:'1.0.0'});
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
  await mcp.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd:process.cwd(),stderr:'pipe',
    env:{PATH:process.env.PATH,TAMRANK_PAT:f.tokens.replacement.token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:'specialist',
      TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_REST_STYLE:style,TAMRANK_SCAN_RECEIPT_DIR:directory}}));
  const tools=await mcp.listTools();assert.equal(tools.tools.length,20);assert.ok(JSON.stringify(tools).length<16000);
  const call=async(name,args)=>{const out=await mcp.callTool({name,arguments:args});safe(out);assert.ok(!out.isError,JSON.stringify(out));return JSON.parse(out.content[0].text);};
  const chatReview=await call('get_scan_status',ctx);assert.equal(chatReview.review.proposal.targets.length,50);
  const close={...ctx,client_request_id:'native-chat-settle-'+style,expected_runtime_hash:chatReview.review.expected_runtime_hash,
    confirmation:{mode:'chat_attested',review_hash:chatReview.review_hash,confirmed:true,client:{name:'Native MCP fixture',version:'1.0.0'},
      agent:{name:'Test agent'},acknowledgements:chatReview.review.proposal.required_acknowledgements}};
  for(const patch of [{force:true},{result_receipt:f.result_receipt},{confirmation:{...close.confirmation,confirmed:false}},
    {confirmation:{...close.confirmation,review_hash:'f'.repeat(64)}},{expected_runtime_hash:'f'.repeat(64)}]){
    const refused=await mcp.callTool({name:'close_scan',arguments:{...close,...patch}});safe(refused);assert.equal(refused.isError,true);
  }
  const out=await call('close_scan',close);safe(out);
  assert.equal(out.view,scenario==='pending'?'result_settlement':'result_settlement_not_needed');
  const reread=await make(f.tokens.replacement.token).review(ctx);safe(reread);
  assert.equal(reread.review.action,scenario==='pending'?'already_settled':'already_recorded');
  const noop=await driver.settle({...input,expected_review_hash:reread.review_hash});safe(noop);assert.equal(noop.view,'result_settlement_not_needed');
  const client=new WorkflowClient({siteUrl:origin,pat:f.tokens.replacement.token,routeStyle:style});
  const progress=await client.get('/scans/recovery/'+f.execution_id);safe(progress);
  assert.equal(progress.progress.state,scenario==='pending'?'cancelled':'reserved');
  assert.equal(progress.progress.runtime.measurements.length,50);
  if(scenario==='pending'){
    const stub=progress.progress.runtime.settlement.attestation;
    assert.deepEqual(stub.client,close.confirmation.client);assert.deepEqual(stub.agent,close.confirmation.agent);
    assert.equal(stub.proposal_hash,chatReview.review.proposal_hash);assert.equal(stub.human_verified,false);
    assert.equal(stub.statement,'user approved in chat');
  }
  assert.deepEqual(await readdir(directory),[saved.receipt_reference+'.json']);
  assert.deepEqual(await readFile(join(directory,saved.receipt_reference+'.json')),before);
  console.log(`PASS: native WordPress recovery via real MCP stdio, ${style}/${scenario}, all 50 devices, explicit chat attestation, private reload and redaction; no provider.`);
} finally {await mcp.close();await rm(directory,{recursive:true,force:true});}
