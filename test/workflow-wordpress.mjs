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
  let queryPeriods=await call(client,'diagnose_page',{post_id:1,section:'keywords',limit:50});
  const periodWindows=queryPeriods.available_windows.map(w=>w.window), queryRows=[...queryPeriods.items];
  while(queryPeriods.next_cursor){queryPeriods=await call(client,'diagnose_page',{post_id:1,section:'keywords',limit:50,cursor:queryPeriods.next_cursor});queryRows.push(...queryPeriods.items);}
  assert.equal(queryRows.length,205); assert.equal(new Set(queryRows.map(r=>r.query)).size,205);
  const queryComparisonArgs={post_id:1,section:'keywords',window:periodWindows[0],compare_to:periodWindows[1],limit:50};
  let queryComparison=await call(client,'diagnose_page',queryComparisonArgs); const queryUnion=[...queryComparison.items];
  while(queryComparison.next_cursor){queryComparison=await call(client,'diagnose_page',{...queryComparisonArgs,cursor:queryComparison.next_cursor});queryUnion.push(...queryComparison.items);}
  assert.equal(queryUnion.length,206); assert.equal(new Set(queryUnion.map(r=>r.query)).size,206);
  assert.equal(queryUnion.find(r=>r.query==='zoekwoord 001').delta.clicks,-11);
  assert.equal(queryUnion.find(r=>r.query==='alleen eerder').current,null);
  assert.equal(queryUnion.find(r=>r.query==='alleen nu').previous,null);
  assert.equal((await client.callTool({name:'diagnose_page',arguments:{...queryComparisonArgs,refresh:true}})).isError,true);
  const comparison=await call(client,'diagnose_page',{post_id:1,section:'comparison'});
  assert.equal(comparison.diagnosis_status,'stored_comparison_only');
  assert.equal(comparison.facts.comparison.delta.clicks,-110);
  assert.ok(Math.abs(comparison.facts.comparison.delta.ctr_percentage_points+2.2)<1e-12);
  assert.equal(comparison.data_quality.url_match,'exact_single_source_row');
  assert.equal((await client.callTool({name:'diagnose_page',arguments:{post_id:1,section:'comparison',refresh:true}})).isError,true);
  const psi=await call(client,'diagnose_page',{post_id:1,section:'pagespeed'});
  assert.equal(psi.facts.pagespeed.mobile.performance_score,83);
  assert.equal(psi.facts.pagespeed.mobile.lab_metrics.lcp_ms,2350.5);
  assert.equal(psi.facts.pagespeed.desktop.available,false);
  assert.ok(psi.facts.pagespeed.mobile.age_seconds>=3600);
  assert.equal(psi.product_writes_performed,false);
  let stability=await call(client,'diagnose_page',{post_id:1,section:'stability',limit:50});
  const firstStabilityCursor=stability.next_cursor;
  const keywords=[...stability.items];
  while(stability.next_cursor) { stability=await call(client,'diagnose_page',{post_id:1,section:'stability',limit:50,cursor:stability.next_cursor}); keywords.push(...stability.items); }
  assert.equal(keywords.length,205); assert.equal(new Set(keywords.map(k=>k.query)).size,205);
  assert.equal(keywords[0].stability,'stable'); assert.equal(keywords[0].position_daily_mean,4.3);
  const dailyArgs={post_id:1,section:'stability',query:'zoekwoord 001',limit:50};
  let daily=await call(client,'diagnose_page',dailyArgs); const dates=[...daily.items];
  while(daily.next_cursor) { daily=await call(client,'diagnose_page',{...dailyArgs,cursor:daily.next_cursor}); dates.push(...daily.items); }
  assert.equal(dates.length,90); assert.equal(new Set(dates.map(d=>d.date)).size,90);
  assert.equal((await client.callTool({name:'diagnose_page',arguments:{...dailyArgs,cursor:firstStabilityCursor}})).isError,true);
  assert.equal((await client.callTool({name:'diagnose_page',arguments:{post_id:1,section:'stability',refresh:true}})).isError,true);
  assert.equal((await client.callTool({name:'diagnose_page',arguments:{post_id:1,section:'pagespeed',refresh:true}})).isError,true);
  const archiveUrl='https://fixture.invalid/category/panels/?q=%2B&color=blue&color=green';
  assert.equal(caps.reads.diagnose_page.url_target.available,true);
  const urlOverview=await call(client,'diagnose_page',{url:archiveUrl});
  assert.equal(urlOverview.page.id,null);assert.equal(urlOverview.page.url,archiveUrl);
  assert.equal(urlOverview.target_scope.wordpress_relationship,'not_resolved');assert.equal(urlOverview.target_scope.content_access,false);
  const urlFacts=await call(client,'diagnose_page',{url:archiveUrl,section:'gsc'});
  assert.equal(urlFacts.facts.gsc.clicks,13);assert.equal(urlFacts.facts.gsc.url,archiveUrl);
  const urlComparison=await call(client,'diagnose_page',{url:archiveUrl,section:'comparison'});
  assert.equal(urlComparison.facts.comparison.delta.clicks,-110);
  let urlKeywords=await call(client,'diagnose_page',{url:archiveUrl,section:'keywords',limit:50});
  const urlCursor=urlKeywords.next_cursor, urlWindows=urlKeywords.available_windows.map(w=>w.window), urlRows=[...urlKeywords.items];
  while(urlKeywords.next_cursor){urlKeywords=await call(client,'diagnose_page',{url:archiveUrl,section:'keywords',limit:50,cursor:urlKeywords.next_cursor});urlRows.push(...urlKeywords.items);}
  assert.equal(urlRows.length,205);assert.equal(new Set(urlRows.map(r=>r.query)).size,205);
  const urlCompareArgs={url:archiveUrl,section:'keywords',window:urlWindows[0],compare_to:urlWindows[1],limit:50};
  let urlKwComparison=await call(client,'diagnose_page',urlCompareArgs);const urlUnion=[...urlKwComparison.items];
  while(urlKwComparison.next_cursor){urlKwComparison=await call(client,'diagnose_page',{...urlCompareArgs,cursor:urlKwComparison.next_cursor});urlUnion.push(...urlKwComparison.items);}
  assert.equal(urlUnion.length,206);assert.equal(urlUnion.find(r=>r.query==='alleen eerder').current,null);
  let urlDaily=await call(client,'diagnose_page',{url:archiveUrl,section:'stability',query:'zoekwoord 001',limit:50});
  const urlDates=[...urlDaily.items];
  while(urlDaily.next_cursor){urlDaily=await call(client,'diagnose_page',{url:archiveUrl,section:'stability',query:'zoekwoord 001',limit:50,cursor:urlDaily.next_cursor});urlDates.push(...urlDaily.items);}
  assert.equal(urlDates.length,90);assert.equal(new Set(urlDates.map(r=>r.date)).size,90);
  for(const args of [{url:archiveUrl,post_id:1},{url:archiveUrl,section:'metadata'},{url:archiveUrl,section:'index'},
    {url:archiveUrl,section:'pagespeed'},{url:archiveUrl,refresh:true},{url:'https://fixture.invalid.evil.invalid/',section:'gsc'},
    {post_id:1,section:'keywords',limit:50,cursor:urlCursor}])
    assert.equal((await client.callTool({name:'diagnose_page',arguments:args})).isError,true);
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
  const specialist=await connect('specialist');const specialistListing=await specialist.listTools();
  assert.equal(specialistListing.tools.length,19);
  const specialistSurface=JSON.stringify(specialistListing).length;assert.ok(specialistSurface<16000);
  assert.equal(caps.specialist_reads.get_gsc_pages.available,true);
  const discovered=[];let discovery=await call(specialist,'get_gsc_pages',{limit:50});const discoveryCursor=discovery.next_cursor;
  discovered.push(...discovery.items);
  while(discovery.next_cursor){discovery=await call(specialist,'get_gsc_pages',{limit:50,cursor:discovery.next_cursor});discovered.push(...discovery.items);}
  assert.equal(discovered.length,205);assert.equal(new Set(discovered.map(r=>r.url)).size,205);
  assert.deepEqual(discovery.data_quality.omitted_rows,{outside_property:1,unsupported_url:1});
  assert.equal(discovery.data_quality.provider_inventory_complete,null);
  assert.equal(JSON.stringify(discovered).includes('PRIVATE_'),false);
  const archiveResult=await call(specialist,'get_gsc_pages',{q:'?q=%2B&color=blue&color=green'});
  assert.equal(archiveResult.total,1);assert.equal(archiveResult.items[0].url,archiveUrl);
  const discoveredDiagnosis=await call(specialist,'diagnose_page',{url:archiveResult.items[0].url,section:'gsc'});
  assert.deepEqual(discoveredDiagnosis.facts.gsc,archiveResult.items[0]);
  const lowRanked=await call(specialist,'get_gsc_pages',{q:'00001',limit:1});assert.equal(lowRanked.total,1);assert.equal(lowRanked.items[0].clicks,1);
  const absentPeriod=await call(specialist,'get_gsc_pages',{period:7});assert.equal(absentPeriod.total,null);assert.equal(absentPeriod.data_quality.reason,'period_not_in_snapshot');
  const querySpecialist=await connect('specialist',config.token,'1','query');
  const queryList=await call(querySpecialist,'get_gsc_pages',{order:'url_asc',period:28,limit:1});assert.equal(queryList.total,205);
  for(const args of [{refresh:true},{order:'score'},{period:30},{q:'category',limit:50,cursor:discoveryCursor}])
    assert.equal((await specialist.callTool({name:'get_gsc_pages',arguments:args})).isError,true);
  assert.equal((await legacy.callTool({name:'get_gsc_pages',arguments:{period:28}})).isError,true);
  console.log(`GSC DISCOVERY E2E OK: 205 eligible stored URLs, exact discovery-to-diagnosis, both REST URL styles, missing-period refusal; ${specialistSurface} specialist surface chars.`);
  const editor=await connect('core',config.editor_token); await assert.rejects(call(editor,'get_capabilities'),/workflow_operator_unavailable/);
  const expired=await connect('core',config.expired_token); await assert.rejects(call(expired,'get_capabilities'),/agent_token_expired/);
  console.log(`WORKFLOW WORDPRESS E2E OK: real MCP stdio + HTTP + native WP; 205 search results/targets, URL analytics with 205 keywords, 206-term union and 90 daily rows; 12/42 tools, ${surface} core surface chars; unsafe/unavailable calls refused.`);
} finally { for(const client of clients) await client.close(); }
