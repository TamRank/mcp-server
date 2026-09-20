/** Actual MCP -> WP manual tasks, never a fabricated parallel task store. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input='';for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input);assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(token=config.token,style='pretty') {
  const client=new Client({name:'tamrank-disposable-manual-test',version:'1.0.0'});clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'index-workflow.js'],cwd:root,
    env:{PATH:process.env.PATH,TAMRANK_PAT:token,TAMRANK_SITE_URL:config.site_url,TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:style},stderr:'pipe'}));return client;
}
async function call(client,name,args={}) {
  const result=await client.callTool({name,arguments:args});const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(result.isError) throw new Error(text);return JSON.parse(text);
}
const state=c=>call(c,'get_work_queue',{work_id:config.work_id,section:'administration'});
try {
  const client=await connect();const query=await connect(config.token,'query');const read=await connect(config.read_token);
  const caps=await call(client,'get_capabilities');assert.equal(caps.work_administration.manual.available,true);
  const initial=await state(read);assert.equal(initial.note,'Original manual note');assert.equal(initial.completion_kind,'manual_only');
  const first={client_request_id:'mcp-manual-note-0001',operation:'work.note',work_id:config.work_id,expected_revision:initial.work_revision,note:'MCP manual note'};
  const note=await call(client,'update_work_item',first);assert.equal(note.website_changed,false);
  assert.equal((await state(read)).note,first.note);assert.notEqual(note.revision,initial.work_revision);
  assert.deepEqual(await call(query,'update_work_item',first),note);
  await assert.rejects(call(client,'update_work_item',{...first,note:'Wrong same ID'}),/workflow_request_conflict/);
  await assert.rejects(call(client,'update_work_item',{...first,client_request_id:'manual-stale-0002'}),/workflow_work_changed/);
  await assert.rejects(call(read,'update_work_item',first),/workflow_operation_unavailable/);
  await assert.rejects(call(client,'update_work_item',{client_request_id:'manual-review-0003',operation:'work.review_target',work_id:config.work_id,
    expected_revision:note.revision,target_key:'relation:1',reviewed:true}),/invalid_request/);
  const done=await call(query,'update_work_item',{client_request_id:'manual-complete-0004',operation:'work.complete',work_id:config.work_id,expected_revision:note.revision});
  assert.equal(done.status,'completed');assert.equal(done.completion_kind,'manual_only');assert.equal(done.outcome,'not_measured');
  const queue=await call(client,'get_work_queue',{kind:'manual',status:'completed'});assert.ok(queue.items.some(w=>w.work_id===config.work_id));
  const large=await call(client,'update_work_item',{...first,client_request_id:'manual-large-0005',expected_revision:done.revision,note:'é'.repeat(2000)});
  assert.equal(large.status,'completed');assert.equal(Buffer.byteLength((await state(read)).note),4000);
  const clear=await call(query,'update_work_item',{...first,client_request_id:'manual-clear-0006',expected_revision:large.revision,note:''});
  assert.equal((await state(client)).note,'');assert.equal(clear.status,'completed');
  const final=await call(client,'update_work_item',{...first,client_request_id:'manual-final-0007',expected_revision:clear.revision,note:'Final manual note'});
  const same=await call(query,'update_work_item',{...first,client_request_id:'manual-same-0008',expected_revision:final.revision,note:'Final manual note'});assert.equal(same.revision,final.revision);
  const opened=await call(client,'update_work_item',{client_request_id:'manual-reopen-0009',operation:'work.reopen',work_id:config.work_id,expected_revision:final.revision});
  assert.equal(opened.status,'open');assert.equal((await state(client)).note,'Final manual note');
  const current=await state(client);assert.deepEqual(await call(query,'update_work_item',first),note);assert.deepEqual(await state(read),current);
  const listing=await client.listTools();assert.equal(listing.tools.length,12);assert.ok(JSON.stringify(listing).length<16000);
  console.log(`WORKFLOW MANUAL E2E OK: existing tasks, shared notes, 4000 bytes/clear, complete/reopen, exact version/replay and both REST styles; ${JSON.stringify(listing).length} core surface chars.`);
} finally {for(const client of clients) await client.close();}
