/** Reads against the exact shipped-beta upgrade, via real SDK/stdio/TLS and native PATs. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runBetaReadClient({origin,fixture:f,inspect,tlsRoot}){
  const runtime=ownedInstalledRuntime(cwd);let checks=f.checks;
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
  const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const ok=(v,label)=>{assert.ok(v,label);checks++;};
  const connect=async(profile,style,token)=>{
    const client=new Client({name:'owned-post-beta-read-client',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',
      env:{PATH:process.env.PATH,TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',
        TAMRANK_PAT:token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    return client;
  };
  const before=inspect();
  for(const profile of ['core','specialist','legacy'])for(const style of ['pretty','query']){
    const client=await connect(profile,style,f.tokens[profile+'-'+style]);
    try{
      const call=async(name,args={})=>{
        const r=await client.callTool({name,arguments:args});ok(!r.isError,`${profile}/${style}/${name}: ${JSON.stringify(r)}`);
        return JSON.parse(r.content[0].text);
      };
      const pages=async(name,args={},unwrap=false)=>{
        const items=[];let cursor;const seen=new Set();let first;
        do{
          let r=await call(name,{...args,limit:50,...cursor?{cursor}:{}});if(unwrap)r=r.data;first??=r;
          ok(Array.isArray(r.items)&&r.items.length<=50,'Bounded page');items.push(...r.items);cursor=r.next_cursor;
          if(cursor){ok(!seen.has(cursor)&&seen.size<20,'Cursor advances within owned dataset');seen.add(cursor);}
        }while(cursor);
        equal(items.length,first.total,'No truncated result list');return items;
      };
      const listing=await client.listTools();equal(listing.tools.length,{core:12,specialist:20,legacy:42}[profile]);
      if(profile!=='legacy')ok(JSON.stringify(listing).length<16000,'Catalog remains bounded');
      if(profile==='legacy'){
        const alias=await call('get_priority_actions',{work_id:f.group,section:'targets',limit:1});
        equal(alias.deprecated,true);equal(alias.remove_in,'0.5.0');
        const targets=await pages('get_priority_actions',{work_id:f.group,section:'targets'},true);
        equal(targets.map(t=>t.post_id).sort((a,b)=>a-b),f.missing_titles,'Legacy targets remain complete after upgrade');
        equal((await call('get_next_action')).data.items[0].work_id,f.queue_order[0]);
        ok((await client.callTool({name:'update_meta',arguments:{post_id:f.old_post,meta_title:'MUST NOT WRITE',execute:true}})).isError,'Old writer not silently re-enabled');
      }else{
        const caps=await call('get_capabilities');equal(caps.contract_version,2);equal(caps.execution_enabled,false);
        const found=await pages('search_pages');equal(found.map(p=>p.id).sort((a,b)=>a-b),f.all_posts,'All published posts, including beta content');
        equal(found.find(p=>p.id===f.page).url,f.page_url,'Prepared measurement URL matches a fresh native read');
        const queue=await pages('get_work_queue');equal(queue.map(w=>w.work_id),f.queue_order,'Same complete native dashboard order');
        ok(queue.every(w=>w.kind!=='research'),'Reading observations did not create research tasks');
        const targets=await pages('get_work_queue',{work_id:f.group,section:'targets'});
        equal(targets.map(t=>t.post_id).sort((a,b)=>a-b),f.missing_titles,'All missing-title targets, not four preview URLs');
        equal(new Set(targets.map(t=>t.key)).size,targets.length,'No duplicate target identities');
        const signals=await pages('get_signals',{signal_id:f.signal_id,section:'targets'});
        equal(signals.map(t=>t.url).sort(),[...f.signal_urls].sort(),'All 200 supported signal URLs remain observations');
        const old=await call('get_page',{post_id:f.old_post,section:'metadata'});
        equal(old.metadata.meta_title,{present:true,value:'Bèta titel – behouden'});
        equal(old.metadata.meta_description,{present:true,value:'Fictieve bestaande beschrijving.'});
        const psi=await call('diagnose_page',{post_id:f.page,section:'pagespeed'});
        ok(psi.facts?.pagespeed?.mobile,`Stored PageSpeed evidence available: ${JSON.stringify(psi)}`);
        equal(psi.facts.pagespeed.mobile.performance_score,83);equal(psi.facts.pagespeed.mobile.lab_metrics.lcp_ms,2350.5);
        equal(psi.product_writes_performed,false);equal(psi.facts.pagespeed.desktop.available,false);
        const comparison=await call('diagnose_page',{post_id:f.page,section:'comparison'});
        equal(comparison.facts.comparison.delta.clicks,-110);
        const queries=await pages('diagnose_page',{post_id:f.page,section:'keywords'});
        equal(queries.length,205);equal(new Set(queries.map(q=>q.query)).size,205);
        const first=await call('search_pages',{limit:1});
        ok((await client.callTool({name:'get_work_queue',arguments:{work_id:f.group,section:'targets',limit:1,cursor:first.next_cursor}})).isError,'Cross-resource cursor refused');
        ok((await client.callTool({name:'diagnose_page',arguments:{post_id:f.page,section:'pagespeed',refresh:true}})).isError,'Read cannot start a provider refresh');
        if(profile==='specialist'){
          const redirects=await pages('get_redirects');
          ok(redirects.some(r=>r.source_url==='/owned-beta-old'&&r.target_url==='/owned-beta-new'),'Original beta redirect still readable');
        }
      }
      equal(inspect(),before,'Reads preserve every native table/schema, except explicit token-use/read-rate bookkeeping');
      console.log(`PASS: beta stored reads ${profile}/${style}, blog ${f.blog_id}; original records and all targets preserved.`);
    }finally{await client.close();}
  }
  for(const token of f.invalid_tokens){const client=await connect('core','pretty',token);
    try{ok((await client.callTool({name:'get_capabilities',arguments:{}})).isError,'Revoked/expired beta PAT stays rejected');}
    finally{await client.close();}
  }
  equal(inspect(),before,'Invalid beta credentials leave all product/authority state unchanged');
  return checks;
}
