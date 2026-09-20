/** Native MCP importance flow against the disposable WordPress fixture only. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input='';for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input);assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(token,style='pretty') {
  const client=new Client({name:'tamrank-disposable-importance-test',version:'1.0.0'});clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'index-workflow.js'],cwd:root,
    env:{PATH:process.env.PATH,TAMRANK_PAT:token,TAMRANK_SITE_URL:config.site_url,TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:style},stderr:'pipe'}));return client;
}
async function call(client,name,args={}) {
  const result=await client.callTool({name,arguments:args});const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(result.isError) throw new Error(text);return JSON.parse(text);
}
const state=c=>call(c,'get_page',{post_id:205,section:'importance'});
try {
  const client=await connect(config.token);const query=await connect(config.token,'query');const read=await connect(config.read_token);
  const caps=await call(client,'get_capabilities');assert.deepEqual(caps.write_operations,['importance.update']);
  assert.equal(caps.work_administration.manual.available,false);assert.equal(caps.execution_enabled,false);
  const initial=await state(read);assert.equal(initial.importance.value,'standard');assert.equal(initial.importance.present,false);
  const queue=await call(read,'get_work_queue',{limit:1});
  const first={client_request_id:'mcp-importance-money-0001',operation:'importance.update',post_id:205,expected_value:'standard',value:'money'};
  const money=await call(client,'update_work_item',first);assert.equal(money.changed,true);assert.equal(money.after.value,'money');
  assert.equal(money.before.present,false);assert.equal(money.actor_type,'agent');assert.equal(money.website_changed,false);
  assert.equal((await state(read)).importance.value,'money');assert.equal(money.outcome,'not_measured');
  assert.notEqual((await call(read,'get_work_queue',{limit:1})).revision,queue.revision);
  assert.deepEqual(await call(query,'update_work_item',first),money);
  await assert.rejects(call(client,'update_work_item',{...first,value:'important'}),/workflow_request_conflict/);
  await assert.rejects(call(client,'update_work_item',{...first,client_request_id:'importance-stale-0002'}),/importance_value_changed/);
  await assert.rejects(call(read,'update_work_item',first),/workflow_operation_unavailable/);
  await assert.rejects(call(client,'update_work_item',{client_request_id:'importance-not-task-0001',operation:'work.complete',work_id:'manual_fixture_one',expected_revision:'a'.repeat(64)}),/workflow_operation_unavailable/);
  const important=await call(query,'update_work_item',{...first,client_request_id:'importance-important-0003',expected_value:'money',value:'important'});
  assert.equal(important.after.value,'important');assert.deepEqual(await call(client,'update_work_item',first),money);
  assert.equal((await state(read)).importance.value,'important');
  const same=await call(client,'update_work_item',{...first,client_request_id:'importance-same-0004',expected_value:'important',value:'important'});assert.equal(same.changed,false);
  const standard=await call(query,'update_work_item',{...first,client_request_id:'importance-standard-0005',expected_value:'important',value:'standard'});
  assert.equal(standard.after.present,false);assert.equal((await state(read)).importance.value,'standard');
  const listing=await client.listTools();assert.equal(listing.tools.length,12);assert.ok(JSON.stringify(listing).length<16000);
  console.log(`WORKFLOW IMPORTANCE E2E OK: explicit independent permission, current value, all three states, exact replay, stale refusal, shared queue revision and both REST styles; ${JSON.stringify(listing).length} core surface chars.`);
} finally {for(const client of clients) await client.close();}
