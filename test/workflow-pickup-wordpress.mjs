/** Real signal selection -> grouped research via the disposable WP/MCP fixture. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input=''; for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input); assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(style='pretty',token=config.token) {
  const client=new Client({name:'tamrank-disposable-pickup-test',version:'1.0.0'}); clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'index-workflow.js'],cwd:root,
    env:{PATH:process.env.PATH,TAMRANK_PAT:token,TAMRANK_SITE_URL:config.site_url,TAMRANK_WORKFLOW_PREVIEW:'1',
      TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:style},stderr:'pipe'}));
  return client;
}
async function call(client,name,args={}) {
  const result=await client.callTool({name,arguments:args});
  const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(result.isError) throw new Error(text);
  return JSON.parse(text);
}
async function targets(client,signal_id,limit=50) {
  const rows=[]; let cursor,hash;
  do { const page=await call(client,'get_signals',{signal_id,section:'targets',limit,...(cursor?{cursor}:{})});
    if(hash) assert.equal(page.snapshot_hash,hash); hash=page.snapshot_hash; rows.push(...page.items); cursor=page.next_cursor;
  } while(cursor);
  return {rows,hash};
}
try {
  const client=await connect(); const query=await connect('query');
  const caps=await call(client,'get_capabilities'); assert.ok(caps.work_administration.operations.includes('work.pickup'));
  const signal=(await call(client,'get_signals',{signal_id:config.signal_id})).signal;
  assert.ok(signal.research_operations.includes('investigate.near_win'));
  const all=await targets(client,config.signal_id,3); assert.equal(all.rows.length,8);
  const keys=all.rows.map(r=>r.key); assert.equal(new Set(keys).size,8);
  const first={client_request_id:'mcp-pickup-first-0001',operation:'work.pickup',signal_id:config.signal_id,
    snapshot_hash:all.hash,target_keys:keys.slice(0,2),research_operation:'investigate.near_win',title:'MCP original research',note:'Original note',priority:'hoog'};
  const picked=await call(client,'update_work_item',first);
  assert.equal(picked.created_target_count,2); assert.equal(picked.remaining_target_count,6); assert.equal(picked.work_ids.length,1);
  assert.equal(picked.website_changed,false); assert.equal(picked.outcome,'not_measured');
  const work_id=picked.work_ids[0];
  const workTargets=await call(client,'get_work_queue',{work_id,section:'targets'});
  assert.equal(workTargets.total,2);
  const workBefore=await call(client,'get_work_queue',{work_id,section:'administration'});
  await call(client,'update_work_item',{client_request_id:'mcp-pickup-reviewed-0002',operation:'work.review_target',work_id,
    expected_revision:workBefore.work_revision,target_key:workTargets.items[0].key,reviewed:true});
  const reviewed=await call(client,'get_work_queue',{work_id,section:'administration'});
  assert.deepEqual(await call(query,'update_work_item',first),picked);
  assert.deepEqual(await call(client,'get_work_queue',{work_id,section:'administration'}),reviewed);
  await assert.rejects(call(client,'update_work_item',{...first,title:'Changed under same ID'}),/workflow_request_conflict/);
  const overlap=await call(query,'update_work_item',{...first,client_request_id:'mcp-pickup-overlap-0003',target_keys:keys.slice(1,3),title:'Only new research'});
  assert.equal(overlap.created_target_count,1); assert.equal(overlap.reused_target_count,1);
  assert.equal(overlap.remaining_target_count,5); assert.equal(overlap.work_ids.length,2); assert.ok(overlap.work_ids.includes(work_id));
  const remaining=(await call(client,'get_signals',{signal_id:config.signal_id})).signal;
  assert.equal(remaining.remaining_targets,5); assert.equal(remaining.covered_targets,3);
  const total=await call(client,'update_work_item',{...first,client_request_id:'mcp-pickup-rest-0004',target_keys:keys,title:'Remaining research'});
  assert.equal(total.created_target_count,5); assert.equal(total.reused_target_count,3); assert.equal(total.remaining_target_count,0);
  assert.equal((await call(client,'get_signals',{signal_id:config.signal_id})).signal.state,'tasked');
  const reused=await call(client,'update_work_item',{...first,client_request_id:'mcp-pickup-reuse-0005',title:'Must not replace the original'});
  assert.equal(reused.created_target_count,0); assert.equal(reused.reused_target_count,2);
  assert.equal(reused.source_selection_reused,true); assert.equal(reused.remaining_target_count,0);
  assert.deepEqual(reused.work_ids,picked.work_ids);
  const queue=await call(client,'get_work_queue',{kind:'research',status:'open'});
  for(const id of total.work_ids) assert.ok(queue.items.some(w=>w.work_id===id));

  const large=await targets(query,config.large_signal_id); assert.equal(large.rows.length,200);
  const big={client_request_id:'mcp-pickup-large-0006',operation:'work.pickup',signal_id:config.large_signal_id,snapshot_hash:large.hash,
    target_keys:large.rows.map(r=>r.key),research_operation:'investigate.404',title:'All 200 URLs',note:'é'.repeat(2000),priority:'middel',deadline:'2026-12-01'};
  assert.ok(Buffer.byteLength(JSON.stringify(big))>4096);
  const bigResult=await call(query,'update_work_item',big);
  assert.equal(bigResult.created_target_count,200); assert.equal(bigResult.remaining_target_count,0); assert.equal(bigResult.work_ids.length,1);
  const bigState=await call(client,'get_work_queue',{work_id:bigResult.work_ids[0],section:'administration'}); assert.equal(bigState.target_count,200);
  const readonly=await connect('pretty',config.read_token);
  await assert.rejects(call(readonly,'update_work_item',first),/workflow_operation_unavailable/);
  const surface=JSON.stringify(await client.listTools()).length; assert.ok(surface<16000); assert.ok(client.getInstructions().length<1500);
  console.log(`WORKFLOW PICKUP E2E OK: explicit 2-of-8 selection, overlap/reuse, shared progress, both URL styles, all 200 targets, exact replay and scope refusal; ${surface} core surface chars.`);
} finally { for(const client of clients) await client.close(); }
