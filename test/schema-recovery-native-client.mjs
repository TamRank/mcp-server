/** Recover an actual owned interrupted schema journal through MCP/verified TLS. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {validSchemaRecoveryProposal,validSchemaRecoveryResult} from '../src/schema-recovery.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const f=JSON.parse(raw),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
assert.ok(f.token?.startsWith('tamrank_pat_')&&['core','specialist'].includes(f.profile)&&['pretty','query'].includes(f.style));
assert.equal(typeof f.busy,'boolean');
let checks=0;const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const client=new Client({name:'Owned schema recovery client',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['--import',path.join(root,'test/owned-schema-dns.mjs'),path.join(root,'index-workflow.js')],
  cwd:root,stderr:'pipe',env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
    TAMRANK_PAT:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:f.profile,TAMRANK_REST_STYLE:f.style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
const call=(name,args)=>client.callTool({name,arguments:args});
const decode=(r,label)=>{check(!r.isError,label+': '+(r.isError?JSON.parse(r.content[0].text).code:''));return JSON.parse(r.content[0].text);};
try{
  await client.connect(transport);const list=await client.listTools();check(list.tools.length===(f.profile==='core'?12:20)&&JSON.stringify(list).length<16000,'Bounded existing tools');
  const c=decode(await call('get_capabilities',{}),'Capabilities').schema_execution;
  check(c.recovery_available&&c.read_available&&c.recovery_contract==='schema_journal_recovery_v1','Separate actual recovery capability');
  const before=decode(await call('get_changes',{kind:'execution',change_set_id:f.id}),'Interrupted journal').record;
  check(before.state==='running','Only an actual running journal enters recovery');
  const proposal=decode(await call('get_changes',{kind:'recovery',change_set_id:f.id}),'Read-only recovery proposal').recovery_proposal;
  check(validSchemaRecoveryProposal(proposal,f.id),'Complete native proposal has no raw proof or website-write grant');
  equal(proposal.plan.expected_state_hash,f.expected_state_hash,'Preview matches independently read native journal');
  equal(proposal.plan.items.map(i=>i.stored_state),before.item_results.map(i=>i.state),'Every native participant retained');
  equal(decode(await call('get_changes',{kind:'execution',change_set_id:f.id}),'Passive readback').record,before,'Proposal does not stop or approve');
  const args={change_set_id:f.id,change_token:proposal.recovery_token,recovery_plan:proposal.plan,
    confirmation:{plan_hash:proposal.plan_hash,confirmed:true,acknowledgements:proposal.plan.required_acknowledgements}};
  check((await call('execute_change_set',{...args,confirmation:{...args.confirmation,confirmed:false}})).isError,'New explicit consent required');
  const stale=structuredClone(args);stale.recovery_plan.expected_state_hash='0'.repeat(64);
  check((await call('execute_change_set',stale)).isError,'Native signed journal binding cannot be forged');
  const response=await call('execute_change_set',args);
  if(f.busy){
    check(response.isError&&JSON.parse(response.content[0].text).code==='change_execution_busy','Active actual worker retains mutex');
    equal(decode(await call('get_changes',{kind:'execution',change_set_id:f.id}),'Busy journal').record,before,'Busy recovery changes no approval or execution');
    process.stdout.write(JSON.stringify({ok:true,checks,busy:true}));
  }else{
    const data=decode(response,'Recover stopped worker');check(validSchemaRecoveryResult(data,proposal),'Exact source policy, new actor and item dispositions');
    equal(data.record.registration.attestation,before.registration.attestation,'Original website approval unchanged');
    equal(data.record.registration.budget,before.registration.budget,'Original reservation unchanged');
    equal(data.record.registration.recovery.attestation.client,{name:'Owned schema recovery client',version:'1'});
    equal(data.record.registration.recovery.attestation.agent,{name:'unknown'});
    equal(decode(await call('execute_change_set',args),'Explicit exact retry'),data,'No new approval, audit or website write on retry');
    equal(decode(await call('get_changes',{kind:'execution',change_set_id:f.id}),'Recovery readback'),data);
    process.stdout.write(JSON.stringify({ok:true,checks,record:data.record}));
  }
}finally{await client.close();}
