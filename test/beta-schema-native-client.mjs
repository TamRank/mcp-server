/** Installed stdio MCP -> native API -> independently rendered TLS frontend, after the shipped beta. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {request} from 'node:https';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
import {validSchemaExecutionResponse,matchesSchemaExecutionRequest} from '../src/schema-execution.js';
import {validSchemaRollbackPreview,matchesSchemaRollbackRequest} from '../src/schema-rollback.js';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=ownedInstalledRuntime(cwd);
export async function runBetaSchemaClient({origin,fixture:f,tlsRoot,inspect}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
  let checks=0;
  const ok=(v,label)=>{assert.ok(v,label);checks++;},equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const sends=()=>existsSync(tlsRoot+'/native-source-sends')?readFileSync(tlsRoot+'/native-source-sends','utf8').trim().split('\n').length:0;
  const graph=()=>new Promise((resolve,reject)=>{
    const url=new URL(f.page_url);assert.equal(url.origin,'https://schema-source.example.org');url.port=new URL(origin).port;
    const req=request(url,{ca:readFileSync(tlsRoot+'/ca.pem'),headers:{'X-Owned-Blog':String(f.blog_id)},
      lookup:(_host,opts,callback)=>callback(null,opts.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4)},res=>{
      let body='';res.on('data',b=>{body+=b;if(Buffer.byteLength(body)>1048576)req.destroy(new Error('Owned frontend too large'));});
      res.on('end',()=>{try{
        equal(res.statusCode,200,'Independent ordinary frontend HTTP status');
        const scripts=[...body.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
        equal(scripts.length,1,'One actual native JSON-LD graph');resolve(JSON.parse(scripts[0][1]));
      }catch(e){reject(e);}});
    });req.on('error',reject);req.setTimeout(20000,()=>req.destroy(new Error('Owned frontend timed out')));req.end();
  });
  const business=s=>({post:s.post,raw_meta:s.raw_meta,meta:s.meta,settings:s.settings});
  const initial=inspect();equal(initial.meta.tamrank_schema_bron,['handmatig']);equal(initial.meta._tamrank_schema_manual_type,['BlogPosting']);
  equal(initial.meta._tamrank_schema_manual_extras,[['FAQPage']]);const initialGraph=await graph();equal(inspect(),initial,'Ordinary render does not rewrite beta page data');
  async function connect(profile,style,token){
    const client=new Client({name:'Owned post-beta schema client',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_SITE_URL:origin,TAMRANK_PAT:token,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const raw=async(name,args)=>{
      for(let n=0;n<8;n++){
        const r=await client.callTool({name,arguments:args});let data;try{data=JSON.parse(r.content[0].text);}catch{return r;}
        if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit','change_execution_rate_limited'].includes(data.code))return r;
        assert.ok(n<7,'Native request window must reopen');console.log('WAIT: confirmed native pre-execution rate limit; no quota reset.');
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
    };
    const call=async(name,args)=>{const r=await raw(name,args);ok(!r.isError,name+': '+(r.isError?r.content[0]?.text:''));return JSON.parse(r.content[0].text);};
    return {client,raw,call};
  }
  for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
    const key=profile+'-'+style,access=f.tokens[key],c=await connect(profile,style,access.token);
    // Source acquisition is a specialist tool; the same operator can then use
    // the core workflow. No private PHP source/approval helper substitutes for it.
    const acquisition=profile==='specialist'?c:await connect('specialist',style,access.token);
    try{
      equal((await c.client.listTools()).tools.length,profile==='core'?12:20);
      const caps=await c.call('get_capabilities',{});ok(caps.schema_execution.available&&caps.schema_execution.rollback_available&&caps.schema_preview.available,'Actual post-upgrade capabilities');
      async function capture(label){
        const before=inspect(),count=sends();
        const prepared=await acquisition.call('start_scan',{type:'schema_source',mode:'preview',post_ids:[f.post_id],capture_mode:'native_render'});
        equal(sends(),count);equal(inspect(),before,'Source preparation is passive');
        const draft=await acquisition.call('start_scan',{type:'schema_source',mode:'plan',post_ids:[f.post_id],capture_mode:'native_render',probe_content:true,
          expected_revision:prepared.source.revision,client_request_id:'beta-source-'+key+'-'+label});
        equal(draft.state,'planned');equal(draft.attestation,null);equal(inspect(),before,'Source plan does not edit a page');
        const run={type:'schema_source',mode:'run',source_job_id:draft.plan.job_id,client_request_id:'beta-source-run-'+key+'-'+label,
          confirmation:{plan_hash:draft.plan_hash,confirmed:true,agent:'Owned beta schema test',acknowledgements:draft.plan.required_acknowledgements}};
        ok((await acquisition.raw('start_scan',{...run,confirmation:{...run.confirmation,plan_hash:'0'.repeat(64)}})).isError,'Wrong capture approval refused');
        equal(sends(),count);
        const done=await acquisition.call('start_scan',run);equal(done.state,'received');ok(done.source_available,'Native source received');equal(sends(),count+1);
        equal((await acquisition.call('start_scan',run)),done,'Capture replay retains exact receipt');equal(sends(),count+1,'No duplicate frontend request');
        equal(inspect(),before,'Capture does not rewrite original beta page/settings/audits');
        ok(!done.render_capture&&!done.result?.source?.body,'Private source bytes stay out of public response');
        return {job_id:draft.plan.job_id,revision:prepared.source.revision};
      }
      const confirmation=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
        confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true,acknowledgements:p.envelope.plan.required_acknowledgements}});
      for(const operation of ['schema.select','schema.detect','schema_settings.update']){
        const before=inspect(),count=sends(),ref=await capture(operation+'-forward');
        const fields={source_job:ref,...(operation==='schema.select'?{main_type:'WebPage',extra_types:['FAQPage'],replace_manual:true}:
          operation==='schema_settings.update'?{fields:{organization_name:'Fictieve gewijzigde organisatie – bèta'},facts_confirmed:true}:{})};
        const item={operation,target:operation==='schema_settings.update'?{site:'current',sample_post_id:f.post_id}:{post_id:f.post_id},fields};
        const comparison=await c.call('plan_changes',{schema_preview:item});
        equal(inspect(),before,'Schema comparison has no business writes');equal(sends(),count+1,'Comparison reuses approved source');
        ok(!comparison.plan_persisted&&!comparison.approval_recorded&&!comparison.execution_available,'Preview is not permission to execute');
        const input={client_request_id:'beta-schema-'+key+'-'+operation,origin:{kind:'user_request',reference:'owned-beta',summary:'Exact fictitious post-beta schema change'},items:[comparison.proposal_item]};
        const data=await c.call('plan_changes',input),p=data.record;
        ok(matchesSchemaExecutionRequest(data,input),'Native execution proposal exactly matches typed request');equal(p.state,'planned');equal(p.approval_recorded,false);
        equal((await c.call('plan_changes',input)),data,'Exact proposal retry');equal(inspect(),before);
        const args=confirmation(p);ok((await c.raw('execute_change_set',{...args,confirmation:{...args.confirmation,plan_hash:'0'.repeat(64)}})).isError,'Wrong execution approval refused');
        if(args.confirmation.acknowledgements.length)ok((await c.raw('execute_change_set',{...args,confirmation:{...args.confirmation,acknowledgements:[]}})).isError,'Required acknowledgement enforced');
        equal(inspect(),before);
        const done=await c.call('execute_change_set',args);ok(validSchemaExecutionResponse(done,p.envelope.plan.change_set_id,p.envelope.plan_hash),'Native public execution proof');
        equal(done.record.state,'executed');equal(done.record.registration.attestation.human_verified,false);
        equal(done.record.registration.attestation.client,{name:'Owned post-beta schema client',version:'1'});
        const after=inspect();equal(after.audits.length,before.audits.length+1);equal(after.post,before.post,'Body and original WordPress row untouched');
        equal(await graph(),comparison.comparison.proposed_graph,'Independent frontend matches the actual approved write');
        equal((await c.call('execute_change_set',args)),done);equal(inspect(),after,'Execution replay adds no writes or audits');
        const inverseRef=await capture(operation+'-inverse'),id=p.envelope.plan.items[0].item_id;
        const pick={change_set_id:p.envelope.plan.change_set_id,item_ids:[id],source_jobs:{[id]:inverseRef}};
        const inverseComparison=await c.call('rollback_change_set',pick);ok(validSchemaRollbackPreview(inverseComparison,pick),'Fresh source-bound inverse comparison');
        equal(inspect(),after,'Rollback comparison does not edit');
        const inverseInput={...pick,client_request_id:'beta-inverse-'+key+'-'+operation,expected_revision:inverseComparison.comparison.revision};
        const inverse=await c.call('rollback_change_set',inverseInput);ok(matchesSchemaRollbackRequest(inverse,inverseInput),'Exact selected rollback proposal');equal(inspect(),after);
        const undone=await c.call('execute_change_set',confirmation(inverse.record));equal(undone.record.state,'executed');
        const restored=inspect();equal(business(restored),business(before),'Original raw schema/identity values and absence restored without fixture reset');
        equal(restored.audits.length,before.audits.length+2);equal(await graph(),initialGraph,'Independent frontend matches original beta graph');
        equal(await c.call('execute_change_set',confirmation(inverse.record)),undone);equal(inspect(),restored,'Rollback replay retains original audit history');
        const original=(await c.call('get_changes',{kind:'execution',change_set_id:p.envelope.plan.change_set_id})).record;
        equal(original.item_results[0].reversal.change_set_id,inverse.record.envelope.plan.change_set_id,'Reciprocal history retained');
        console.log('PASS: post-beta '+key+' '+operation+' -> source -> preview -> approval -> write -> fresh approved rollback.');
      }
    }finally{if(acquisition!==c)await acquisition.client.close();await c.client.close();}
  }
  equal(business(inspect()),business(initial),'All profile cases preserve original beta business data');
  return checks;
}
