/** Called by PRO's disposable-table harness; credentials arrive only on stdin. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input=''; for await(const chunk of process.stdin) input+=chunk;
const config=JSON.parse(input);
assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(profile='core',token=config.token,preview='1',style='pretty') {
  const client=new Client({name:'tamrank-disposable-workflow-test',version:'1.0.0'});
  clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'index-workflow.js'],cwd:root,
    env:{PATH:process.env.PATH,TAMRANK_PAT:token,TAMRANK_SITE_URL:config.site_url,TAMRANK_WORKFLOW_PREVIEW:preview,
      TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style},stderr:'pipe'}));
  return client;
}
async function call(client,name,args={}) {
  const r=await client.callTool({name,arguments:args});
  const text=r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if(r.isError) throw new Error(text);
  return JSON.parse(text);
}
try {
  const client=await connect(); const listing=await client.listTools();
  assert.equal(listing.tools.length,12);
  const surface=JSON.stringify(listing).length; assert.ok(surface<16000,`Core tools/list too large: ${surface}`);
  assert.ok(client.getInstructions().length<1500);
  const caps=await call(client,'get_capabilities'); assert.equal(caps.contract_version,2); assert.equal(caps.execution_enabled,false);
  const pages=[]; let cursor;
  do { const data=await call(client,'search_pages',{limit:50,...(cursor?{cursor}:{})}); pages.push(...data.items); cursor=data.next_cursor; } while(cursor);
  assert.equal(pages.length,205); assert.equal(new Set(pages.map(p=>p.id)).size,205);
  const queue=await call(client,'get_work_queue',{limit:50});
  const large=queue.items.find(item=>item.target_count===205 || item.total_targets===205 || item.count===205);
  const targetGroup=large || queue.items.find(item=>item.kind==='automatic'); assert.ok(targetGroup,'No automatic work fixture');
  const targets=[]; cursor=null;
  do { const data=await call(client,'get_work_queue',{work_id:targetGroup.work_id,section:'targets',limit:50,...(cursor?{cursor}:{})}); targets.push(...data.items); cursor=data.next_cursor; } while(cursor);
  assert.equal(targets.length,205); assert.equal(new Set(targets.map(t=>t.key)).size,205);
  await call(client,'get_signals',{signal_id:1,section:'targets'});
  await call(client,'diagnose_page',{post_id:1,section:'index'});
  const psi=await call(client,'diagnose_page',{post_id:1,section:'pagespeed'});
  assert.equal(psi.facts.pagespeed.mobile.performance_score,83);
  assert.equal(psi.facts.pagespeed.mobile.lab_metrics.lcp_ms,2350.5);
  assert.equal(psi.facts.pagespeed.desktop.available,false);
  assert.ok(psi.facts.pagespeed.mobile.age_seconds>=3600);
  assert.equal(psi.product_writes_performed,false);
  assert.equal((await client.callTool({name:'diagnose_page',arguments:{post_id:1,section:'pagespeed',refresh:true}})).isError,true);
  assert.equal((await client.callTool({name:'get_page',arguments:{post_id:1,unknown:'must reject'}})).isError,true);
  assert.equal((await client.callTool({name:'execute_change_set',arguments:{}})).isError,true);
  const legacy=await connect('legacy'); assert.equal((await legacy.listTools()).tools.length,42);
  const migrated=await call(legacy,'get_priority_actions',{work_id:targetGroup.work_id,section:'targets',limit:50});
  assert.equal(migrated.deprecated,true); assert.equal(migrated.remove_in,'0.5.0'); assert.equal(migrated.data.total,205);
  const legacyTargets=[...migrated.data.items]; cursor=migrated.data.next_cursor;
  while(cursor) { const more=await call(legacy,'get_priority_actions',{work_id:targetGroup.work_id,section:'targets',limit:50,cursor}); legacyTargets.push(...more.data.items); cursor=more.data.next_cursor; }
  assert.deepEqual(legacyTargets,targets);
  assert.equal((await call(legacy,'get_next_action')).data.items.length,1);
  assert.equal((await legacy.callTool({name:'update_meta',arguments:{post_id:1,meta_title:'MUST NOT WRITE',execute:true}})).isError,true);
  const query=await connect('core',config.token,'1','query'); assert.equal((await call(query,'search_pages',{limit:1})).total,205);
  const noPreview=await connect('core',config.token,''); await assert.rejects(call(noPreview,'get_capabilities'),/workflow_upgrade_required/);
  const editor=await connect('core',config.editor_token); await assert.rejects(call(editor,'get_capabilities'),/workflow_operator_unavailable/);
  const expired=await connect('core',config.expired_token); await assert.rejects(call(expired,'get_capabilities'),/agent_token_expired/);
  console.log(`WORKFLOW WORDPRESS E2E OK: real MCP stdio + HTTP + native WP; 205 search results and 205 identical canonical/legacy targets; 12/42 tools, ${surface} core surface chars; unsafe/unavailable calls refused.`);
} finally { for(const client of clients) await client.close(); }
