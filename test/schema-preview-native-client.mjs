/** Invoked only inside the owned PRO native fixture; no source acquisition. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
let bytes='';for await(const chunk of process.stdin)bytes+=chunk;
const f=JSON.parse(bytes),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
assert.ok(f.token?.startsWith('tamrank_pat_'));assert.equal(f.comparisons.length,3);
let checks=0;const check=(v,message)=>{checks++;assert.ok(v,message);};
for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
  const client=new Client({name:'Owned native schema client',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,
    args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(repo,'index-workflow.js')],cwd:repo,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
      TAMRANK_PAT:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
  let errors='';transport.stderr?.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
  try{
    await client.connect(transport);
    const listing=await client.listTools();check(listing.tools.length===(profile==='core'?12:20),'Canonical tool count');
    check(JSON.stringify(listing).length<16000,'Complete native-enabled catalog stays under budget');
    const caps=JSON.parse((await client.callTool({name:'get_capabilities',arguments:{}})).content[0].text);
    check(caps.schema_preview?.available===true&&caps.schema_preview.schema_proposals_available===false,'Actual native capabilities advertise comparison only');
    for(const comparison of f.comparisons){
      const item={operation:comparison.operation,target:comparison.operation==='schema_settings.update'?{site:'current',sample_post_id:comparison.post_id}:{post_id:comparison.post_id},fields:comparison.input};
      const r=await client.callTool({name:'plan_changes',arguments:{schema_preview:item}});
      check(!r.isError,`Native preview ${profile}/${style}/${comparison.operation}: ${r.isError?r.content[0]?.text:''}`);
      const data=JSON.parse(r.content[0].text);checks++;assert.deepEqual(data.comparison,comparison,'Real WordPress comparison exactly matches independent native baseline');
      check(data.proposal_item.fields.expected_revision===comparison.revision&&!data.plan_persisted&&!data.approval_recorded&&!data.execution_available,'Exact non-executable preview receipt');
    }
    const comparison=f.comparisons[0],item={operation:comparison.operation,target:{post_id:comparison.post_id},fields:{...comparison.input,expected_revision:comparison.revision}};
    check(!(await client.callTool({name:'plan_changes',arguments:{schema_preview:item}})).isError,'Exact preview revision replays');
    for(const change of [x=>x.fields.expected_revision='f'.repeat(64),x=>x.fields.source_job={...x.fields.source_job,job_id:'ffffffff-ffff-ffff-ffff-ffffffffffff'},x=>x.target.post_id=f.other_post_id]){
      const bad=structuredClone(item);change(bad);check((await client.callTool({name:'plan_changes',arguments:{schema_preview:bad}})).isError,'Native stale/source/target boundary refuses');
    }
    check((await client.callTool({name:'plan_changes',arguments:{schema_preview:item,execute:true}})).isError,'Cannot mix execution into preview');
    check((await client.callTool({name:'execute_change_set',arguments:{}})).isError,'Website execution remains unavailable');
    check(!errors.includes(f.token),'No PAT in stderr');
  }finally{await client.close();}
}
process.stdout.write(JSON.stringify({ok:true,checks}));
