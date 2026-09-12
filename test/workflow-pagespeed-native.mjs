/** MCP stdio -> native WordPress HTTP -> owned SQL/cron -> synthetic Google only. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=ownedInstalledRuntime(source);
const requireRuntime=createRequire(path.join(runtime,'package.json'));
const {Client}=await import(pathToFileURL(requireRuntime.resolve('@modelcontextprotocol/sdk/client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(requireRuntime.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const pro=process.env.TAMRANK_MAINT_PRO,core=process.env.TAMRANK_MAINT_CORE,free=process.env.TAMRANK_MAINT_FREE;
const php=process.env.TAMRANK_TEST_PHP||'/opt/homebrew/bin/php';
assert.ok(pro&&core&&free,'Explicit owned PRO/core/FREE paths required');
assert.match(process.env.TAMRANK_SCAN_TEST_SOCKET||'',/^\/private\/tmp\/tr-scan-mysql\.[A-Za-z0-9]{6}\/mysql.sock$/);
let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const network of [false,true]){
  const root=mkdtempSync('/private/tmp/tr-maint-wp-'),db='tr_maint_'+randomBytes(8).toString('hex'),listen=await port(),origin='http://127.0.0.1:'+listen;
  writeFileSync(path.join(root,'owned-fixture'),'Disposable synthetic fixture\n',{mode:0o600});
  for(const d of ['plugins','mu-plugins','themes'])mkdirSync(path.join(root,'content',d),{recursive:true});
  symlinkSync(realpathSync(free),path.join(root,'content/plugins/tam-rank'));symlinkSync(realpathSync(pro),path.join(root,'content/plugins/tam-rank-pro'));
  const env={...process.env,TAMRANK_MAINT_ROOT:root,TAMRANK_MAINT_DB:db,TAMRANK_MAINT_ORIGIN:origin,TAMRANK_MAINT_MULTISITE:'0'};
  const router=path.join(pro,'docs/fixtures/maintenance-wordpress.php');let owned=false,server,stderr='';
  function cli(mode,input={}){
    const r=spawnSync(php,[router,mode],{env,input:JSON.stringify(input),encoding:'utf8',timeout:180000,maxBuffer:4e6});
    // Do not print a seed response containing the owned ephemeral token on failure.
    assert.equal(r.status,0,`${mode}: ${r.stderr}\n${mode==='pagespeed-mcp-fixture'?'[seed response omitted]':r.stdout.slice(-3000)}`);
    const line=r.stdout.split('\n').find(l=>l.startsWith('MAINT_FIXTURE:'));assert.ok(line,`Missing ${mode} output`);return JSON.parse(line.slice(14));
  }
  try{
    cli('create');owned=true;cli('install',{network});if(network){env.TAMRANK_MAINT_MULTISITE='1';cli('site');}
    const fixtures=new Map();for(const blog_id of network?[1,2]:[1])fixtures.set(blog_id,cli('pagespeed-mcp-fixture',{blog_id}));
    server=spawn(php,['-S','127.0.0.1:'+listen,router],{env:{...env,TAMRANK_PAGESPEED_WORKER_HTTP:'1'},stdio:['ignore','ignore','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned HTTP server did not start')),10000);
      server.once('error',reject);server.once('exit',()=>{clearTimeout(timer);reject(new Error('Owned HTTP server exited'));});
      server.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.includes('Development Server')&&stderr.includes('started')){clearTimeout(timer);resolve();}});});
    for(const [blog_id,f] of fixtures){
      const control=(operation,more={})=>cli('pagespeed-mcp-control',{blog_id,operation,...more});
      for(const style of ['pretty','query']){
        const site=origin+(blog_id===2?'/client-two':''),client=new Client({name:'Owned PageSpeed MCP',version:'1'});
        async function call(name,args){const r=await client.callTool({name,arguments:args});const d=JSON.parse(r.content[0].text);
          assert.ok(!r.isError,`${name}: ${JSON.stringify(d)}`);checks++;return d;}
        try{
          await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',
            env:{PATH:process.env.PATH,TAMRANK_PAT:f.token,TAMRANK_SITE_URL:site,TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style}}));
          equal((await client.listTools()).tools.length,20,'No extra tool names');
          const caps=await call('get_capabilities',{});equal(caps.pagespeed_execution.available,true,'Real native capabilities');
          const preview=await call('start_scan',{type:'pagespeed',mode:'preview',post_ids:f.pages});
          const draft=await call('start_scan',{type:'pagespeed',mode:'plan',post_ids:f.pages,expected_revision:preview.preview_revision,client_request_id:'native-plan-'+style});
          equal(draft.proposal.targets.map(t=>t.post_id),f.pages,'All exact targets in native proposal');equal(control('inspect').event_count,0,'Plan is not dispatch');
          const run={type:'pagespeed',mode:'run',proposal_id:draft.proposal_id,client_request_id:'native-lost-'+style,
            confirmation:{plan_hash:draft.proposal_hash,confirmed:true,agent:'not trusted',acknowledgements:draft.proposal.required_acknowledgements}};
          const wrong={...run,confirmation:{...run.confirmation,plan_hash:'a'.repeat(64)}};
          equal((await client.callTool({name:'start_scan',arguments:wrong})).isError,true,'Changed approved hash is refused before start');
          const lost=await client.callTool({name:'start_scan',arguments:run});equal(lost.isError,true,'Lost admission response remains uncertain, not auto-retried');
          equal(JSON.parse(lost.content[0].text).client_request_id,run.client_request_id,'Preserve exact identity after lost response');
          equal(control('inspect').event_count,1,'Lost response still has precisely one scheduled event');
          let progress=await call('start_scan',run);equal(progress.dispatch_state,'queued');equal(progress.targets.length,25);
          const before=control('inspect');equal(before.event_count,1);
          // Locate by the response ID, not UUID sort order.
          const actual=JSON.parse(before.registrations.find(r=>r.execution_id===progress.execution_id).registration_json);
          equal(actual.attestation.client,{name:'Owned PageSpeed MCP',version:'1'});equal(actual.attestation.agent,{name:'unknown'});
          const other=new Client({name:'Owned other user',version:'1'});
          try{
            await other.connect(new StdioClientTransport({command:process.execPath,args:[path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',
              env:{PATH:process.env.PATH,TAMRANK_PAT:f.foreign_token,TAMRANK_SITE_URL:site,TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style}}));
            equal((await other.callTool({name:'get_scan_status',arguments:{type:'pagespeed',execution_id:progress.execution_id}})).isError,true,'Another actor cannot read this private scan');
          }finally{await other.close();}
          await call('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id});
          const after=control('inspect');equal(after.runtime_hash,before.runtime_hash,'Reading never measures');equal(after.cron_hash,before.cron_hash,'Reading never schedules');
          equal((await call('start_scan',run)).execution_id,progress.execution_id,'Exact replay has same execution');equal(control('inspect').event_count,1);
          equal(control('tick',{repeat:true}),{calls:1,event_count:1},'Duplicate event cannot send twice');
          progress=await call('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id});
          equal(progress.targets[0].devices[0].state,'succeeded');equal(progress.targets[0].devices[0].result.performance_score,0,'Zero score is real data');
          equal(control('tick',{count:49,repeat:true}),{calls:49,event_count:0});
          progress=await call('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id});
          equal(progress.dispatch_state,'completed');equal(progress.reservation_state,'released');equal(progress.targets.at(-1).post_id,f.pages.at(-1));
          equal(progress.targets.every(t=>t.devices.every(d=>d.state==='succeeded')),true);equal((await call('start_scan',run)).dispatch_state,'completed');
          equal(control('inspect').legacy_queue,null,'No legacy queue writes');
          if(style==='query'){
            const pv=await call('start_scan',{type:'pagespeed',mode:'preview',post_ids:[f.pages[0]]});
            const dr=await call('start_scan',{type:'pagespeed',mode:'plan',post_ids:[f.pages[0]],expected_revision:pv.preview_revision,client_request_id:'native-fault-plan'});
            const args={...run,proposal_id:dr.proposal_id,client_request_id:'native-fault-start',confirmation:{...run.confirmation,plan_hash:dr.proposal_hash}};
            const queued=await call('start_scan',args);control('revoke',{token_id:f.token_id});
            equal(control('tick'),{calls:0,event_count:0},'Revoked original key prevents scheduled provider call');
            equal((await client.callTool({name:'get_scan_status',arguments:{type:'pagespeed',execution_id:queued.execution_id}})).isError,true,'Same-session stale capabilities cannot read after revocation');
            control('revoke',{token_id:f.token_id,revoked:false});await call('start_scan',args);
            equal(control('tick',{fault:'timeout',repeat:true}),{calls:1,event_count:0});
            const unknown=await call('get_scan_status',{type:'pagespeed',execution_id:queued.execution_id});
            equal(unknown.dispatch_state,'reconciliation_required');equal(unknown.reservation_state,'held');
            equal(unknown.targets[0].devices[0].state,'uncertain');await call('start_scan',args);equal(control('inspect').event_count,0,'Uncertain consumed attempt never starts again');
          }
          console.log(`PASS native MCP PageSpeed: ${network?'multisite':'single-site'} blog ${blog_id}, ${style}, 25 URLs/50 devices.`);
        }finally{await client.close();}
      }
    }
  }finally{
    if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}
    if(owned)cli('drop',{owned:db});
    if(/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/.test(root))rmSync(root,{recursive:true});
  }
}
console.log(`PASS: ${checks} native PageSpeed MCP checks; ${runtime===source?'source':'installed'} entry; fictitious provider only; owned databases removed.`);
