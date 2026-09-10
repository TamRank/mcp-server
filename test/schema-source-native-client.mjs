/** Owned PRO fixture only: real MCP -> HTTPS REST -> HTTPS frontend -> preview. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {sourceAcks,sourceProbeAcks} from '../src/source-scans.js';
import {workflowIdentity} from '../src/workflow-identity.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const f=JSON.parse(input),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
assert.ok(f.token?.startsWith('tamrank_pat_'));assert.ok(Number.isSafeInteger(f.post_id)&&f.post_id>0);
let checks=0;const receipts=[];const check=(v,label)=>{checks++;assert.ok(v,label);};
const sends=()=>existsSync(f.root+'/native-source-sends')?readFileSync(f.root+'/native-source-sends','utf8').trim().split('\n').length:0;
for(const style of ['pretty','query']){
  const client=new Client({name:'Owned native acquisition client',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,
    args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(repo,'index-workflow.js')],cwd:repo,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
      TAMRANK_PAT:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
  let errors='';transport.stderr?.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
  const call=(name,args)=>client.callTool({name,arguments:args});
  const ok=async(name,args)=>{const r=await call(name,args);check(!r.isError,`${name}: ${r.isError?r.content[0]?.text:''}`);return JSON.parse(r.content[0].text);};
  try{
    await client.connect(transport);
    const listing=await client.listTools();check(listing.tools.length===20&&JSON.stringify(listing).length<16000,'Native acquisition preserves canonical tool budget');
    const caps=await ok('get_capabilities',{});check(caps.schema_preview?.available===true,'Native preview available after actual discovery');
    for(const probe of [false,true]){
      const start=sends(),suffix=style+'-'+(probe?'probe':'passive');
      const prepared=await ok('start_scan',{type:'schema_source',mode:'preview',post_ids:[f.post_id],capture_mode:'native_render'});
      check(prepared.source.source_profile==='anonymous_native_render'&&!prepared.plan_persisted&&sends()===start,'Prepare does not store or request frontend');
      const args={type:'schema_source',mode:'plan',post_ids:[f.post_id],capture_mode:'native_render',
        expected_revision:prepared.source.revision,client_request_id:'native-mcp-plan-'+suffix,...(probe?{probe_content:true}:{})};
      const draft=await ok('start_scan',args);check(draft.state==='planned'&&draft.attestation===null&&sends()===start,'Private plan precedes acquisition and approval');
      check(JSON.stringify(draft.plan.required_acknowledgements)===JSON.stringify(probe?sourceProbeAcks:sourceAcks),'Exact separate content consent in returned plan');
      const confirmation={plan_hash:draft.plan_hash,confirmed:true,agent:'Owned synthetic MCP tester',acknowledgements:draft.plan.required_acknowledgements};
      const run={type:'schema_source',mode:'run',source_job_id:draft.plan.job_id,client_request_id:'native-mcp-run-'+suffix,confirmation};
      check((await call('start_scan',{...run,confirmation:{...confirmation,plan_hash:'0'.repeat(64)}})).isError,'Wrong approved hash rejected by real REST');
      if(probe)check((await call('start_scan',{...run,confirmation:{...confirmation,acknowledgements:sourceAcks}})).isError,'Missing extra-content consent rejected by real REST');
      check(sends()===start,'Rejected requests never reach frontend');
      const result=await ok('start_scan',run);check(result.state==='received'&&result.source_available&&sends()===start+1,'Exactly one independently rendered source request');
      check(result.attestation.statement==='user approved in chat'&&result.attestation.proposal_hash===draft.plan_hash&&result.attestation.client.name===workflowIdentity.name,'Exact chat stub survives MCP and REST');
      check(!('render_capture' in result)&&!result.result?.source?.body,'Private raw observation excluded');
      const read=await ok('get_scan_status',{type:'schema_source',proposal_id:draft.plan.job_id});
      checks++;assert.deepEqual(read,result,'Private HTTP read returns same receipt');
      const replay=await ok('start_scan',run);checks++;assert.deepEqual(replay,result,'Exact explicit run replay');check(sends()===start+1,'Replay makes no second source request');
      const ref={job_id:draft.plan.job_id,revision:prepared.source.revision};
      const comparison=await ok('plan_changes',{schema_preview:{operation:'schema.detect',target:{post_id:f.post_id},fields:{source_job:ref}}});
      check(!comparison.plan_persisted&&!comparison.approval_recorded&&!comparison.execution_available,'Source approval never becomes schema execution approval');
      check(sends()===start+1,'Comparison does not fetch again');receipts.push({source_job:ref,comparison:comparison.comparison});
    }
    check(!errors.includes(f.token),'No PAT in stderr');
  }finally{await client.close();}
}
process.stdout.write(JSON.stringify({ok:true,checks,receipts}));
