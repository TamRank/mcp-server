/** Same real network, installed runtime, no transport stubs or source overrides. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const runtime=ownedInstalledRuntime(fileURLToPath(new URL('../',import.meta.url)));
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input),[one,two]=config.sites;
for(const site of config.sites)site.token=site.isolation_token;
assert.match(one.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);assert.equal(two.site_url,one.site_url+'/client-two');
assert.deepEqual(config.sites.map(s=>s.blog_id),[1,2]);
const clients=[];let checks=0;
async function connect(site,token=site.token,style='pretty'){
  const c=new Client({name:'owned-network-read-test',version:'1.0.0'});clients.push(c);
  await c.connect(new StdioClientTransport({command:process.execPath,args:[join(runtime,'index-workflow.js')],cwd:runtime,
    env:{PATH:process.env.PATH,TAMRANK_SITE_URL:site.site_url,TAMRANK_PAT:token,TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style},stderr:'pipe'}));return c;
}
async function call(c,name,args={}){const r=await c.callTool({name,arguments:args});
  const text=r.content.filter(v=>v.type==='text').map(v=>v.text).join('\n');
  if(r.isError)throw new Error(text);checks++;return JSON.parse(text);
}
async function denied(c,name,args,reason){await assert.rejects(call(c,name,args),reason);checks++;}
try{
  for(const style of ['pretty','query']){
    const a=await connect(one,one.token,style),b=await connect(two,two.token,style);
    if(config.mode==='isolation'){
      for(const [c,site,other]of [[a,one,two],[b,two,one]]){
        const page=await call(c,'get_page',{post_id:1});
        assert.ok(JSON.stringify(page).includes(site.page_base));assert.ok(!JSON.stringify(page).includes(other.page_base));
        const targets=await call(c,'get_signals',{signal_id:1,section:'targets'});
        assert.ok(JSON.stringify(targets).includes(site.page_base));assert.ok(!JSON.stringify(targets).includes(other.page_base));
        await denied(c,'diagnose_page',{url:other.archive_url,section:'gsc'},/workflow_url_outside_property/);
      }
      // Reuse cursors only with the same selector on the other client. Both clients
      // deliberately have the same post/signal/rule IDs and 205 source rows.
      for(const [name,args]of [['search_pages',{limit:50}],['get_work_queue',{work_id:'grp_missing_titles',section:'targets',limit:50}],
        ['diagnose_page',{post_id:1,section:'stability',limit:50}],['diagnose_page',{post_id:1,section:'keywords',limit:50}],
        ['get_gsc_pages',{limit:50}],['get_redirects',{limit:50}],['get_images_missing_alt',{limit:50}],
        ['get_site_diagnostics',{section:'metadata',limit:50}],['get_topical_authority',{section:'clusters',limit:50}]]){
        const first=await call(a,name,args),second=await call(b,name,args);assert.ok(first.next_cursor&&second.next_cursor);
        await denied(b,name,{...args,cursor:first.next_cursor},/cursor/i);
        await denied(a,name,{...args,cursor:second.next_cursor},/cursor/i);
        await call(a,name,{...args,cursor:first.next_cursor});await call(b,name,{...args,cursor:second.next_cursor});
      }
      await denied(await connect(two,one.token,style),'get_capabilities',{},/agent_token_invalid/);
      await denied(await connect(one,two.token,style),'get_capabilities',{},/agent_token_invalid/);
      await denied(await connect(two,two.network_token,style),'get_capabilities',{},/workflow_operator_unavailable/);
    }else if(config.mode==='foreign-owner'){
      await denied(await connect(two,one.token,style),'get_capabilities',{},/workflow_operator_unavailable/);
      await call(a,'get_capabilities');await call(b,'get_capabilities');
    }else if(config.mode==='revoked-membership'){
      await denied(b,'get_capabilities',{},/workflow_operator_unavailable/);await call(a,'get_capabilities');
    }else if(config.mode==='inactive-client'){
      await denied(b,'get_capabilities',{},/pro_required/);await call(a,'get_capabilities');
    }else throw new Error('Unknown network case');
  }
  console.log('NETWORK READ ISOLATION OK: '+config.mode+'; '+checks+' actual MCP assertions; '+(process.env.TAMRANK_TEST_PACKED_ROOT?'installed':'source')+' entry.');
}finally{for(const c of clients)await c.close();}
