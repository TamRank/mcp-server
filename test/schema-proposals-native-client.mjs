/** Owned PRO fixture only: typed schema preview -> private proposal -> exact own read. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const f=JSON.parse(input),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
assert.ok(f.token?.startsWith('tamrank_pat_'));assert.ok(f.requests.length>0&&f.requests.length<=6);
const styles=f.styles??['pretty','query'];assert.ok(styles.length>0&&styles.every(s=>['pretty','query'].includes(s)));
let checks=0;const drafts=[];const check=(v,label)=>{checks++;assert.ok(v,label);};
for(const style of styles){
  const client=new Client({name:'Owned schema proposal client',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,
    args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(repo,'index-workflow.js')],cwd:repo,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
      TAMRANK_PAT:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
  const call=(name,args)=>client.callTool({name,arguments:args});
  const ok=async(name,args)=>{const r=await call(name,args);check(!r.isError,`${name}: ${r.isError?r.content[0]?.text:''}`);return JSON.parse(r.content[0].text);};
  try{
    await client.connect(transport);const listing=await client.listTools();
    check(listing.tools.length===20&&JSON.stringify(listing).length<16000,'Complete schema-storage tool surface under budget');
    const caps=await ok('get_capabilities',{});
    check(caps.schema_preview.schema_proposals_available===true&&caps.field_proposals.operations.length===3,'Only native schema storage granted');
    for(const request of f.requests){
      const args=structuredClone(request);args.client_request_id+='-mcp-'+style;
      const preview=await ok('plan_changes',{schema_preview:args.items[0]});
      check(!preview.plan_persisted&&preview.schema_proposals_available,'Preview remains unsaved even when storage is available');
      args.items=[preview.proposal_item];
      const result=await ok('plan_changes',args);
      drafts.push({id:result.envelope.plan.change_set_id,hash:result.envelope.plan_hash});
      check(result.plan_persisted&&!result.approval_recorded&&!result.execution_available,'Private schema draft is not approved or executable');
      checks++;assert.deepEqual(result.envelope.plan.origin,args.origin,'Exact requested origin retained');
      if(args.origin.kind==='action'){
        const proof=result.envelope.plan.origin_evidence;
        check(proof.action_id===args.origin.action_id&&proof.revision===args.origin.revision&&proof.snapshot_hash===args.origin.snapshot_hash,'Native canonical task evidence retained');
        check(proof.selected_targets.length===args.items.length,'Every selected target has original task evidence');
        const wrong=structuredClone(args);wrong.client_request_id+='-origin';wrong.origin.snapshot_hash='0'.repeat(64);
        check((await call('plan_changes',wrong)).isError,'A task ID without its current evidence cannot create a draft');
      }
      checks++;assert.deepEqual(result.envelope.plan.items[0].dependencies.comparison,preview.comparison,'Same exact comparison in stored proposal');
      const read=await ok('get_changes',{change_set_id:result.envelope.plan.change_set_id});checks++;assert.deepEqual(read,result,'Exact private own history');
      const replay=await ok('plan_changes',args);checks++;assert.deepEqual(replay,result,'Exact idempotent public proposal replay');
      const stale=structuredClone(args);stale.client_request_id+='-stale';stale.items[0].fields.expected_revision='0'.repeat(64);
      check((await call('plan_changes',stale)).isError,'Stale comparison refused by native REST');
      const missing=structuredClone(args);delete missing.items[0].fields.expected_revision;
      check((await call('plan_changes',missing)).isError,'A draft must bind the exact preview revision');
      check((await call('plan_changes',{...args,execute:true})).isError,'No execution through planning');
    }
    check((await call('execute_change_set',{})).isError,'Executor stays unavailable');
    check((await call('rollback_change_set',{})).isError,'Rollback stays unavailable');
  }finally{await client.close();}
}
process.stdout.write(JSON.stringify({ok:true,checks,drafts}));
