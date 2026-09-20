/** Actual native records and SDK/TLS requests. No mocked WordPress response. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {validSchemaExecutionResponse} from '../src/schema-execution.js';
import {validSchemaRecoveryResult} from '../src/schema-recovery.js';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
let wire='';for await(const part of process.stdin)wire+=part;
const f=JSON.parse(wire),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=ownedInstalledRuntime(repo);
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
for(const key of ['token','reader','other'])assert.ok(f[key]?.startsWith('tamrank_pat_'));
const h=f.record.history,id=h.change_set_id,hash=h.original_plan_hash,expected={contract_version:1,record:f.record};
const recovery=f.recovery_input,proposal=recovery?.proposal;
const approval=recovery||f.approval;
const args=recovery?{change_set_id:id,change_token:proposal.recovery_token,recovery_plan:proposal.plan,
  confirmation:{plan_hash:proposal.plan_hash,confirmed:true,acknowledgements:proposal.plan.required_acknowledgements}}:
  {change_set_id:id,change_token:approval.change_token,confirmation:{plan_hash:hash,confirmed:true,acknowledgements:approval.confirmation.acknowledgements}};
let checks=0;const check=(v,label)=>{checks++;assert.ok(v,label);};
check(validSchemaExecutionResponse(expected,id,hash),'Actual native historical projection: '+JSON.stringify({label:f.label,state:h.state,kind:h.change_kind,items:h.items.map(i=>({operation:i.operation,keys:Object.keys(i),result:i.result}))}));
if(recovery)check(validSchemaRecoveryResult(expected,proposal),'Actual erased recovery receipt matches the original confirmation');
check(!validSchemaExecutionResponse(expected,'00000000-0000-4000-8000-000000000000',hash),'Wrong requested identity rejected');
check(!validSchemaExecutionResponse(expected,id,'0'.repeat(64)),'Wrong requested hash rejected');
for(const change of [d=>{d.record.envelope={change_token:'trse1.'+'a'.repeat(64)};},d=>{d.record.history.security={schema_storage:{raw:'private'}};},
  d=>{d.record.history.execution.attestation.operator_id=9;},d=>{d.record.history.items[0].original_schema_storage={raw:'private'};},
  d=>{d.record.history.execution_available=true;},d=>{d.record.approval_recorded=false;},
  d=>{d.record.history.execution.attestation.plan_hash='0'.repeat(64);},d=>{d.record.history.items[0].result.item_id='00000000-0000-4000-8000-000000000000';}]){
  const bad=structuredClone(expected);change(bad);check(!validSchemaExecutionResponse(bad,id,hash),'Altered/private historical proof rejected');
}
// Cover both tool profiles and REST forms over this same real stored history.
for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
  const client=new Client({name:'Owned schema history client',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,TAMRANK_PAT:f.token,
      TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
  const call=(name,args)=>client.callTool({name,arguments:args}),read=()=>call('get_changes',{kind:'execution',change_set_id:id});
  const decode=(r,label)=>{check(!r.isError,label+(r.isError?': '+r.content[0]?.text:''));return JSON.parse(r.content[0].text);};
  try{
    await client.connect(transport);const list=await client.listTools();check(list.tools.length===(profile==='core'?12:20),'No additional tools');
    const first=decode(await read(),'Read schema history');checks++;assert.deepEqual(first,expected);
    const replay=decode(await call('execute_change_set',args),'Exact old schema approval returns non-executable history');checks++;assert.deepEqual(replay,first);
    check((await call('execute_change_set',{...args,confirmation:{...args.confirmation,plan_hash:'0'.repeat(64)}})).isError,'Changed approval refused');
    if(recovery){
      check(validSchemaRecoveryResult(replay,proposal),'REST recovery receipt retains all approved dispositions');
      for(const changed of [{...args,change_token:'trscr1.'+'0'.repeat(64)},
        {...args,confirmation:{...args.confirmation,acknowledgements:[]}},
        {...args,recovery_plan:{...args.recovery_plan,execution_id:'00000000-0000-4000-8000-000000000000'}}])
        check((await call('execute_change_set',changed)).isError,'Different recovery token, acknowledgement or execution refused');
    }
    check((await call('get_changes',{kind:'execution',change_set_id:id,include_private_proofs:true})).isError,'No private-proof escape hatch');
    checks++;assert.deepEqual(decode(await read(),'Repeated historical read'),first);
  }finally{await client.close();await transport.close();}
}
for(const key of ['reader','other',...(recovery?['original','changed-client']:[])]){
  const client=new Client({name:key==='changed-client'?'Different owned history client':'Owned schema history client',version:'1'}),transport=new StdioClientTransport({command:process.execPath,
    args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,TAMRANK_PAT:key==='changed-client'?f.token:f[key],TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:'core',TAMRANK_WORKFLOW_PREVIEW:'1'}});
  try{await client.connect(transport);const response=await client.callTool({name:'get_changes',arguments:{kind:'execution',change_set_id:id}});
    if(key!=='other'){check(!response.isError,'Same-owner PAT can read history');checks++;assert.deepEqual(JSON.parse(response.content[0].text),expected);}
    else check(response.isError,'Other owner receives no history');
    const denied=await client.callTool({name:'execute_change_set',arguments:args});
    check(denied.isError,'Read-only, foreign owner, different PAT or changed client cannot reuse approval');
    if(key==='original'||key==='changed-client')check(JSON.parse(denied.content[0].text).error==='field_recovery_request_conflict'
      ||JSON.parse(denied.content[0].text).code==='field_recovery_request_conflict','Native private request/token binding refuses a different original consent');
  }finally{await client.close();await transport.close();}
}
process.stdout.write(JSON.stringify({ok:true,checks}));
