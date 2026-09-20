/** Actual SDK/stdio -> TLS/REST -> native multiple-schema/mixed private storage. */
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
assert.ok(f.token?.startsWith('tamrank_pat_'));assert.deepEqual(f.batches.map(b=>b.items.length),[8,25]);
let checks=0;const drafts=[];const check=(v,label)=>{checks++;assert.ok(v,label);};
for(const style of ['pretty','query']){
  const client=new Client({name:'Owned schema batch client',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,
    args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(repo,'index-workflow.js')],cwd:repo,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
      TAMRANK_PAT:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
  let errors='';transport.stderr?.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
  const call=(name,args)=>client.callTool({name,arguments:args});
  const ok=async(name,args)=>{const r=await call(name,args);check(!r.isError,`${name}: ${r.isError?r.content[0]?.text:''}`);return JSON.parse(r.content[0].text);};
  try{
    await client.connect(transport);
    const caps=await ok('get_capabilities',{});
    check(caps.schema_preview.schema_proposals_available&&caps.field_proposals.operations.includes('meta.update'),'Schema and metadata are independently advertised');
    const comparisons=[];
    for(const item of f.batches[0].items){
      const preview=await ok('plan_changes',{schema_preview:item});
      check(preview.proposal_item.fields.expected_revision===item.fields.expected_revision,'Each page keeps the exact native preview revision');
      comparisons.push(preview.comparison);
    }
    for(const batch of f.batches){
      const args=structuredClone(batch);args.client_request_id+='-mcp-'+style;
      const saved=await ok('plan_changes',args);const plan=saved.envelope.plan;
      drafts.push({id:plan.change_set_id,hash:saved.envelope.plan_hash});
      check(saved.plan_persisted&&!saved.approval_recorded&&!saved.execution_available,'Full batch is a private draft, not execution');
      check(plan.items.length===args.items.length,'All eight/25 items returned without truncation');
      for(let n=0;n<plan.items.length;n++){
        checks++;assert.deepEqual(plan.items[n].target,args.items[n].target,'Exact ordered target');
        checks++;assert.deepEqual(plan.items[n].fields,args.items[n].fields,'Exact ordered requested fields');
        if(n<8){checks++;assert.deepEqual(plan.items[n].dependencies.comparison,comparisons[n],'Exact per-page native comparison');}
      }
      if(args.origin.kind==='action')check(plan.origin_evidence.selected_targets.length===25,'Task evidence covers every item, not UI previews');
      checks++;assert.deepEqual(await ok('get_changes',{change_set_id:plan.change_set_id}),saved,'Complete unchanged private history');
      checks++;assert.deepEqual(await ok('plan_changes',args),saved,'Exact full batch replay');
      const changed=structuredClone(args);changed.items.reverse();
      check((await call('plan_changes',changed)).isError,'Reordered request cannot reuse identity');
      const stale=structuredClone(args);stale.client_request_id+='-stale';stale.items[7].fields.expected_revision='0'.repeat(64);
      check((await call('plan_changes',stale)).isError,'Later schema revision conflict refuses entire batch');
      const duplicated=structuredClone(args);duplicated.items[1].target=duplicated.items[0].target;
      check((await call('plan_changes',duplicated)).isError,'Duplicate targets rejected');
      check((await call('plan_changes',{...args,execute:true})).isError,'No execution flag on batch planner');
    }
    const oversized=structuredClone(f.batches[1]);oversized.items.push(oversized.items[0]);
    check((await call('plan_changes',oversized)).isError,'Twenty-six items rejected by actual SDK');
    check(!errors.includes(f.token),'No bearer token leaked to stderr');
  }finally{await client.close();}
}
process.stdout.write(JSON.stringify({ok:true,checks,drafts}));
