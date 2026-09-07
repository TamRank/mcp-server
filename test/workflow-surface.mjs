/** No WordPress mutations: inert registry + strict real HTTP transport fixtures. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerWorkflowTools, WORKFLOW_INSTRUCTIONS } from '../src/workflow-tools.js';
import { WorkflowClient } from '../src/workflow-rest.js';

let calls = [];
const fake = { get: async (path, query) => { calls.push({ path, query }); return { contract_version: 2, items: [], next_cursor: null }; },
  post: async (path,body) => { calls.push({path,body}); return {contract_version:2,website_changed:false}; } };
function registry(profile,capabilities=null) { const tools = new Map(); registerWorkflowTools({ registerTool: (n,c,h) => tools.set(n,{c,h}) },fake,{profile,capabilities}); return tools; }
const core = registry('core'), legacy = registry('legacy'), specialist = registry('specialist');
assert.equal(core.size,12); assert.equal(legacy.size,42); assert.equal(specialist.size,19);
assert.ok(WORKFLOW_INSTRUCTIONS.length<1500);
assert.equal(core.has('get_gsc_pages'),false);
await specialist.get('get_gsc_pages').h({q:'/category/?x=%2B',order:'impressions_desc',period:28,limit:50,cursor:'opaque'});
assert.deepEqual(calls.pop(),{path:'/gsc/pages',query:{q:'/category/?x=%2B',order:'impressions_desc',period:28,limit:50,cursor:'opaque'}});
assert.equal(specialist.get('get_gsc_pages').c.annotations.readOnlyHint,true);
for(const args of [{refresh:true},{period:30},{period:'28'},{order:'score'},{limit:51},{q:'é'.repeat(101)},{q:'bad\u0000input'},{url:'https://fixture.invalid/'}]) {
  assert.equal((await specialist.get('get_gsc_pages').h(args)).isError,true);assert.equal(calls.length,0);
}
for(const caps of [{},{specialist_reads:{get_gsc_pages:{available:false}}}]) {
  assert.equal((await registry('specialist',caps).get('get_gsc_pages').h({})).isError,true);assert.equal(calls.length,0);
}
await registry('specialist',{specialist_reads:{get_gsc_pages:{available:true}}}).get('get_gsc_pages').h({});
assert.deepEqual(calls.pop(),{path:'/gsc/pages',query:{}});
assert.equal((await legacy.get('get_gsc_pages').h({period:28})).isError,true);assert.equal(calls.length,0);
for(const name of ['get_site_diagnostics','get_redirects','get_images_missing_alt','get_topical_authority','start_scan','get_scan_status']) {
  assert.equal((await specialist.get(name).h({})).isError,true);assert.equal(calls.length,0);
}
for (const name of ['update_work_item','plan_changes','execute_change_set','rollback_change_set']) {
  assert.equal((await core.get(name).h({})).isError,true);
  assert.equal(calls.length,0);
}
for (const name of ['update_meta','update_meta_batch','manage_redirects','detect_schema','request_recrawl','rescore_page','rollback']) {
  assert.equal((await legacy.get(name).h({execute:true})).isError,true); assert.equal(calls.length,0);
}
assert.equal((await core.get('get_page').h({post_id:1,secret:'not allowed'})).isError,true); assert.equal(calls.length,0);
await core.get('diagnose_page').h({post_id:1,section:'pagespeed'});
assert.deepEqual(calls.pop(),{path:'/pages/1/diagnosis',query:{section:'pagespeed'}});
await core.get('diagnose_page').h({post_id:1,section:'stability',query:'akoestiek',limit:50,cursor:'opaque'});
assert.deepEqual(calls.pop(),{path:'/pages/1/diagnosis',query:{section:'stability',query:'akoestiek',limit:50,cursor:'opaque'}});
await core.get('diagnose_page').h({post_id:1,section:'comparison'});
assert.deepEqual(calls.pop(),{path:'/pages/1/diagnosis',query:{section:'comparison'}});
const keywordArgs={post_id:1,section:'keywords',window:'2026-08-10/2026-09-06',compare_to:'2026-07-13/2026-08-09',limit:50};
await core.get('diagnose_page').h(keywordArgs);
assert.deepEqual(calls.pop(),{path:'/pages/1/diagnosis',query:{section:'keywords',window:keywordArgs.window,compare_to:keywordArgs.compare_to,limit:50}});
for(const args of [{...keywordArgs,window:undefined},{...keywordArgs,compare_to:keywordArgs.window},
  {...keywordArgs,window:'2026-02-30/2026-03-06'},{...keywordArgs,compare_to:'2026-08-03/2026-08-09'},
  {...keywordArgs,refresh:true},{post_id:1,section:'stability',window:keywordArgs.window}]) {
  assert.equal((await core.get('diagnose_page').h(args)).isError,true); assert.equal(calls.length,0);
}
for(const args of [{post_id:1,section:'comparison',period:7},{post_id:1,section:'comparison',limit:1},{post_id:1,section:'comparison',query:'x'}]) {
  assert.equal((await core.get('diagnose_page').h(args)).isError,true); assert.equal(calls.length,0);
}
for(const args of [{post_id:1,section:'gsc',query:'x'},{post_id:1,section:'stability',query:'é'.repeat(257)},
  {post_id:1,section:'stability',query:'x\u0000y'},{post_id:1,section:'stability',refresh:true}]) {
  assert.equal((await core.get('diagnose_page').h(args)).isError,true); assert.equal(calls.length,0);
}
assert.equal((await core.get('diagnose_page').h({post_id:1,section:'pagespeed',refresh:true})).isError,true);
assert.equal(calls.length,0);
const exactUrl='https://fixture.invalid/category/panels/?q=%2B&color=blue&color=green';
await core.get('diagnose_page').h({url:exactUrl,section:'keywords',limit:50});
assert.deepEqual(calls.pop(),{path:'/gsc/diagnosis',query:{url:exactUrl,section:'keywords',limit:50}});
await core.get('diagnose_page').h({url:exactUrl});
assert.deepEqual(calls.pop(),{path:'/gsc/diagnosis',query:{url:exactUrl}});
for(const args of [{},{url:exactUrl,post_id:1},{url:exactUrl,section:'metadata'},{url:exactUrl,section:'content'},
  {url:exactUrl,section:'index'},{url:exactUrl,section:'pagespeed'},{url:exactUrl,refresh:true},
  ...['/relative','ftp://fixture.invalid/','https://fixture.invalid/#part','https://user@fixture.invalid/',
    'https://fixture.invalid/a/%2e%2E/b','https://fixture.invalid/%2fsecret','https://fixture.invalid/%ZZ',
    'https://fixture.invalid:0/','https://fixture.invalid:65536/','https://fixture.invalid\\evil.invalid/',
    'https://fixture.invalid/'+ 'é'.repeat(1020)].map(url=>({url}))]) {
  assert.equal((await core.get('diagnose_page').h(args)).isError,true);assert.equal(calls.length,0);
}
for(const caps of [{reads:{diagnose_page:{available:true}}},{reads:{diagnose_page:{available:true,url_target:{available:false}}}}]) {
  assert.equal((await registry('core',caps).get('diagnose_page').h({url:exactUrl})).isError,true);assert.equal(calls.length,0);
}
await core.get('get_work_queue').h({work_id:'automatic:grp_missing_title',section:'targets',limit:50,cursor:'opaque'});
assert.deepEqual(calls.pop(),{path:'/work-queue/automatic:grp_missing_title',query:{section:'targets',limit:50,cursor:'opaque'}});
await legacy.get('get_next_action').h({}); assert.equal(calls.pop().query.limit,1);
await legacy.get('get_next_action').h({work_id:'manual_1'}); assert.deepEqual(calls.pop(),{path:'/work-queue/manual_1',query:{}});
await legacy.get('get_priority_actions').h({refresh:true}); assert.equal(calls.length,0);
await core.get('get_work_queue').h({work_id:'pickup_'+'a'.repeat(32),section:'administration'});
assert.deepEqual(calls.pop(),{path:'/work-items/pickup_'+'a'.repeat(32),query:{}});
await legacy.get('get_next_action').h({work_id:'pickup_'+'a'.repeat(32),section:'administration'});
assert.deepEqual(calls.pop(),{path:'/work-items/pickup_'+'a'.repeat(32),query:{}});
await core.get('get_work_queue').h({section:'administration'}); assert.equal(calls.length,0);
const work={client_request_id:'fixture-request-1',operation:'work.review_target',work_id:'pickup_'+'a'.repeat(32),expected_revision:'a'.repeat(64),target_key:'relation:1',reviewed:true};
assert.equal((await core.get('update_work_item').h(work)).isError,true); assert.equal(calls.length,0);
const enabled=registry('core',{work_administration:{available:true,operations:['work.review_target','work.complete','work.reopen']}});
await enabled.get('update_work_item').h(work); assert.deepEqual(calls.pop(),{path:'/work-items',body:work});
assert.equal(enabled.get('update_work_item').c.annotations.readOnlyHint,false);
assert.equal(enabled.get('update_work_item').c.annotations.destructiveHint,true);
for(const bad of [{...work,reviewed:'true'},{...work,actor_id:1},{...work,operation:'work.complete'},{...work,target_key:undefined}]) {
  assert.equal((await enabled.get('update_work_item').h(bad)).isError,true); assert.equal(calls.length,0);
}
const pickup={client_request_id:'fixture-pickup-1',operation:'work.pickup',signal_id:1,snapshot_hash:'b'.repeat(64),
  target_keys:['c'.repeat(64),'d'.repeat(64)],research_operation:'investigate.near_win',title:'Investigate chosen pages',priority:'middel'};
assert.equal((await enabled.get('update_work_item').h(pickup)).isError,true); assert.equal(calls.length,0);
const pickupEnabled=registry('core',{work_administration:{available:true,operations:['work.pickup']}});
await pickupEnabled.get('update_work_item').h(pickup); assert.deepEqual(calls.pop(),{path:'/work-items',body:pickup});
for(const bad of [{...pickup,title:undefined},{...pickup,target_keys:[]},{...pickup,target_keys:[...pickup.target_keys,pickup.target_keys[0]]},
  {...pickup,work_id:work.work_id},{...pickup,expected_revision:work.expected_revision},{...pickup,reviewed:true},
  {...pickup,signal_id:'1'},{...pickup,research_operation:'technical.resolve_404'},{...pickup,priority:'urgent'},
  {...pickup,title:'🎯'.repeat(61)},{...pickup,note:'🎯'.repeat(1001)},{...pickup,target_keys:Array(201).fill('e'.repeat(64))}]) {
  assert.equal((await pickupEnabled.get('update_work_item').h(bad)).isError,true); assert.equal(calls.length,0);
}

let targetCalls=0;
const note={client_request_id:'fixture-note-0001',operation:'work.note',work_id:work.work_id,expected_revision:work.expected_revision,note:'Shared note'};
assert.equal((await enabled.get('update_work_item').h(note)).isError,true); assert.equal(calls.length,0);
const noteEnabled=registry('core',{work_administration:{available:true,operations:['work.note']}});
await noteEnabled.get('update_work_item').h(note); assert.deepEqual(calls.pop(),{path:'/work-items',body:note});
await noteEnabled.get('update_work_item').h({...note,note:''}); assert.equal(calls.pop().body.note,'');
for(const bad of [{...note,note:undefined},{...note,note:null},{...note,note:7},{...note,target_key:work.target_key},
  {...note,reviewed:true},{...note,title:'No rename'},{...note,signal_id:1},{...note,expected_revision:undefined},
  {...note,work_id:'manual_pending'},{...note,note:'🎯'.repeat(1001)},{...note,operation:'work.complete'}]) {
  assert.equal((await noteEnabled.get('update_work_item').h(bad)).isError,true); assert.equal(calls.length,0);
}
const manualOps=['work.note','work.complete','work.reopen'];
const manualEnabled=registry('core',{work_administration:{available:true,operations:manualOps,
  manual:{available:true,operations:manualOps}}});
for(const operation of manualOps) {
  const input={client_request_id:'fixture-manual-0001',operation,work_id:'manual_existing.1',expected_revision:work.expected_revision,
    ...(operation==='work.note'?{note:''}:{})};
  await manualEnabled.get('update_work_item').h(input); assert.deepEqual(calls.pop(),{path:'/work-items',body:input});
  assert.equal(manualEnabled.get('update_work_item').c.inputSchema.safeParse(input).success,true);
  for(const manual of [undefined,{available:false,operations:manualOps},{available:true,operations:[] }]) {
    const gated=registry('core',{work_administration:{available:true,operations:manualOps,manual}});
    assert.equal((await gated.get('update_work_item').h(input)).isError,true); assert.equal(calls.length,0);
  }
}
for(const bad of [{...work,work_id:'manual_existing.1'},
  {...note,work_id:'manual_'},{...note,work_id:'manual_existing/1'},
  {...note,work_id:'manual_existing',operation:'work.create'},{...note,work_id:'manual_existing',title:'No rename'}]) {
  assert.equal((await manualEnabled.get('update_work_item').h(bad)).isError,true); assert.equal(calls.length,0);
}
await core.get('get_work_queue').h({work_id:'manual_existing',section:'administration'});
assert.deepEqual(calls.pop(),{path:'/work-items/manual_existing',query:{}});
const importance={client_request_id:'fixture-importance-0001',operation:'importance.update',post_id:205,expected_value:'standard',value:'money'};
const importanceEnabled=registry('core',{work_administration:{available:true,operations:['importance.update'],importance:{available:true}}});
await importanceEnabled.get('update_work_item').h(importance);assert.deepEqual(calls.pop(),{path:'/work-items',body:importance});
for(const bad of [{...importance,work_id:'manual_1'},{...importance,expected_revision:'a'.repeat(64)},
  {...importance,post_id:'205'},{...importance,value:'high'},{...importance,expected_value:undefined},{...importance,actor_id:1},
  {...importance,operation:'work.note',note:'Unrelated'},{...note,post_id:205}]) {
  assert.equal((await importanceEnabled.get('update_work_item').h(bad)).isError,true);assert.equal(calls.length,0);
}
for(const gate of [core,manualEnabled,registry('core',{work_administration:{available:true,operations:['importance.update']}})]) {
  assert.equal((await gate.get('update_work_item').h(importance)).isError,true);assert.equal(calls.length,0);
}
await core.get('get_page').h({post_id:205,section:'importance'});
assert.deepEqual(calls.pop(),{path:'/pages/205',query:{section:'importance'}});
const server=createServer((req,res)=> {
  targetCalls++;
  if(req.url.includes('/redirect')) { res.writeHead(302,{Location:'/wp-json/tamrank/v2/leak'}); res.end(); return; }
  if(req.url.includes('/oversize')) { res.writeHead(200); res.end('x'.repeat(524289)); return; }
  if(req.url.includes('/html')) { res.writeHead(200); res.end('<html>Error</html>'); return; }
  if(req.url.includes('/slow')) { res.writeHead(200); res.write('{'); return; }
  if(req.url.includes('/old')) { res.writeHead(200); res.end(JSON.stringify({contract_version:1})); return; }
  if(req.url.includes('/echo-error')) { res.writeHead(403); res.end(JSON.stringify({code:'fixture-not-a-real-token',message:'fixture-not-a-real-token'+'x'.repeat(1000)})); return; }
  res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({contract_version:2,path:req.url}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try {
  const client=new WorkflowClient({siteUrl:base+'/subdir',pat:'fixture-not-a-real-token'});
  assert.equal((await client.get('/capabilities')).path,'/subdir/wp-json/tamrank/v2/capabilities');
  const queryClient=new WorkflowClient({siteUrl:base+'/subdir',pat:'fixture',routeStyle:'query'});
  assert.match((await queryClient.get('/pages',{limit:50,cursor:'a+b'})).path,/rest_route=%2Ftamrank%2Fv2%2Fpages&limit=50&cursor=a%2Bb/);
  const count=targetCalls;
  await assert.rejects(client.get('/redirect'),e=>e.code==='workflow_redirect_refused'); assert.equal(targetCalls,count+1);
  await assert.rejects(client.get('/oversize'),e=>e.code==='workflow_response_limit');
  await assert.rejects(client.get('/html'),e=>e.code==='invalid_response');
  await assert.rejects(client.get('/old'),e=>e.code==='workflow_upgrade_required');
  await assert.rejects(client.get('/echo-error'),e=>e.code==='workflow_request_failed'&&!e.message.includes('fixture-not-a-real-token')&&e.message.length<=500);
  await assert.rejects(new WorkflowClient({siteUrl:base,pat:'fixture',timeoutMs:100}).get('/slow'),e=>e.code==='timeout');
  for(const siteUrl of ['http://real-site.invalid','https://user:pass@site.invalid','https://site.invalid/?key=secret']) assert.throws(()=>new WorkflowClient({siteUrl,pat:'fixture'}));
  console.log('WORKFLOW SURFACE OK: 12/19/42 profiles, gated research/manual administration, unavailable website writers, strict inputs, full-target mapping, bounded HTTP/timeout/redirect protection.');
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
