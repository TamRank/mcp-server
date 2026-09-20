/** Real shared-note edits, version checks and replay through the disposable WP fixture. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input=''; for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input); assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(token=config.token,style='pretty') {
  const client=new Client({name:'tamrank-disposable-note-test',version:'1.0.0'}); clients.push(client);
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
const state=c=>call(c,'get_work_queue',{work_id:config.work_id,section:'administration'});
try {
  const client=await connect(); const query=await connect(config.token,'query'); const readonly=await connect(config.read_token);
  const caps=await call(client,'get_capabilities'); assert.ok(caps.work_administration.operations.includes('work.note'));
  const before=await state(client); assert.equal(before.note,'Original research note'); assert.equal(before.note_shared,true);
  const first={client_request_id:'mcp-note-first-0001',operation:'work.note',work_id:config.work_id,
    expected_revision:before.work_revision,note:'Updated from MCP'};
  const changed=await call(client,'update_work_item',first);
  assert.equal(changed.status,'open'); assert.equal(changed.website_changed,false); assert.equal(changed.outcome,'not_measured');
  assert.notEqual(changed.revision,before.work_revision);
  const after=await state(readonly); assert.equal(after.note,first.note); assert.equal(after.work_revision,changed.revision);
  assert.deepEqual(await call(query,'update_work_item',first),changed);
  await assert.rejects(call(client,'update_work_item',{...first,note:'Different same ID'}),/workflow_request_conflict/);
  await assert.rejects(call(client,'update_work_item',{...first,client_request_id:'mcp-note-stale-0002'}),/workflow_work_changed/);
  await assert.rejects(call(readonly,'update_work_item',first),/workflow_operation_unavailable/);
  const noop=await call(query,'update_work_item',{...first,client_request_id:'mcp-note-same-value-0003',expected_revision:after.work_revision});
  assert.equal(noop.revision,after.work_revision); assert.deepEqual(await state(client),after);
  const done=await call(client,'update_work_item',{client_request_id:'mcp-note-complete-0004',operation:'work.complete',
    work_id:config.work_id,expected_revision:after.work_revision});
  const note='é'.repeat(2000); assert.equal(Buffer.byteLength(note),4000);
  const large=await call(query,'update_work_item',{...first,client_request_id:'mcp-note-large-0005',expected_revision:done.revision,note});
  assert.equal(large.status,'completed'); assert.equal((await state(client)).note,note);
  // Clearing is explicit; omission/null never silently erases a note.
  const cleared=await call(client,'update_work_item',{...first,client_request_id:'mcp-note-clear-0006',expected_revision:large.revision,note:''});
  assert.equal((await state(query)).note,''); assert.equal(cleared.status,'completed');
  const final=await call(query,'update_work_item',{...first,client_request_id:'mcp-note-final-0007',expected_revision:cleared.revision,note:'Final shared note'});
  assert.equal(final.status,'completed');
  const opened=await call(client,'update_work_item',{client_request_id:'mcp-note-reopen-0008',operation:'work.reopen',
    work_id:config.work_id,expected_revision:final.revision});
  assert.equal(opened.status,'open'); assert.equal(opened.reviewed_count,before.reviewed_count);
  const current=await state(query); assert.equal(current.note,'Final shared note');
  assert.deepEqual(await call(query,'update_work_item',first),changed); assert.deepEqual(await state(client),current);
  const listing=await client.listTools(); assert.equal(listing.tools.length,12);
  const chars=JSON.stringify(listing).length; assert.ok(chars<16000); assert.ok(client.getInstructions().length<1500);
  console.log(`WORKFLOW NOTE E2E OK: shared note, exact revision/replay, same-value no-op, 4000 UTF-8 bytes, explicit clear, completed-state preservation and both REST styles; ${chars} core surface chars.`);
} finally { for(const client of clients) await client.close(); }
