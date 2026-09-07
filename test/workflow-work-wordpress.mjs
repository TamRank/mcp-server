/** Only invoked by PRO's disposable clone harness; credentials are stdin-only. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input=''; for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input);
assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(token=config.token,style='pretty') {
  const client=new Client({name:'tamrank-disposable-research-test',version:'1.0.0'}); clients.push(client);
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
  const client=await connect();
  const caps=await call(client,'get_capabilities');
  assert.equal(caps.full_v2_compatible,false); assert.equal(caps.execution_enabled,false);
  assert.equal(caps.work_administration.available,true);
  assert.deepEqual(caps.work_administration.operations,['work.review_target','work.complete','work.reopen']);
  const before=await state(client);
  assert.equal(before.reviewed_count,0); assert.equal(before.target_count,2);
  const targets=await call(client,'get_work_queue',{work_id:config.work_id,section:'targets'});
  assert.equal(targets.items.length,2);
  const payload={client_request_id:'http-mcp-review-0001',operation:'work.review_target',work_id:config.work_id,
    expected_revision:before.work_revision,target_key:targets.items[0].key,reviewed:true};
  assert.match(payload.target_key,/^relation:/);
  const reviewed=await call(client,'update_work_item',payload);
  assert.equal(reviewed.reviewed_count,1); assert.equal(reviewed.status,'open');
  assert.equal(reviewed.website_changed,false); assert.notEqual(reviewed.revision,before.work_revision);
  assert.deepEqual(await call(client,'update_work_item',payload),reviewed);
  await assert.rejects(call(client,'update_work_item',{...payload,reviewed:false}),/workflow_request_conflict/);
  await assert.rejects(call(client,'update_work_item',{...payload,client_request_id:'http-mcp-stale-0002'}),/workflow_work_changed/);
  const after=await state(client); assert.equal(after.work_revision,reviewed.revision);
  assert.equal(after.reviewed_count,1);
  const query=await connect(config.token,'query');
  const done=await call(query,'update_work_item',{client_request_id:'http-mcp-complete-0003',operation:'work.complete',
    work_id:config.work_id,expected_revision:after.work_revision});
  assert.equal(done.status,'completed'); assert.equal(done.completion_kind,'research_only'); assert.equal(done.outcome,'not_measured');
  const completedQueue=await call(client,'get_work_queue',{kind:'research',status:'completed'});
  assert.ok(completedQueue.items.some(w=>w.work_id===config.work_id));
  const reopened=await call(client,'update_work_item',{client_request_id:'http-mcp-reopen-0004',operation:'work.reopen',
    work_id:config.work_id,expected_revision:(await state(client)).work_revision});
  assert.equal(reopened.status,'open'); assert.equal(reopened.reviewed_count,1);
  const current=await state(client);
  // A very old exact retry returns its old receipt; it must not revert new state.
  assert.deepEqual(await call(query,'update_work_item',payload),reviewed);
  assert.deepEqual(await state(client),current);
  const readonly=await connect(config.read_token);
  assert.equal((await call(readonly,'get_capabilities')).work_administration.available,false);
  await assert.rejects(call(readonly,'update_work_item',payload),/workflow_operation_unavailable/);
  await assert.rejects(call(client,'execute_change_set',{}),/workflow_operation_unavailable/);
  const listing=await client.listTools(); assert.equal(listing.tools.length,12);
  assert.ok(JSON.stringify(listing).length<16000); assert.ok(client.getInstructions().length<1500);
  console.log('WORKFLOW RESEARCH E2E OK: real MCP/HTTP/WP, review + complete + reopen, both URL styles, revision conflicts, exact replay and scope refusal; no website execution.');
} finally { for(const client of clients) await client.close(); }
