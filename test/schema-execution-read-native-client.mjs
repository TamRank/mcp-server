/** Owned SDK/TLS readback only. Never creates, executes or rolls back a change. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {validSchemaExecutionResponse} from '../src/schema-execution.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const f=JSON.parse(input),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
for(const token of [f.token,f.reader,f.other])assert.ok(token?.startsWith('tamrank_pat_'));
const id=f.record?.envelope?.plan?.change_set_id;assert.ok(validSchemaExecutionResponse({contract_version:1,record:f.record},id));
let checks=0;const check=(v,label)=>{checks++;assert.ok(v,label);};
for(const style of ['pretty','query'])for(const profile of ['core','specialist']){
  // The authenticated owner can inspect with a separate, read-only PAT too.
  const client=new Client({name:'Owned schema execution reader',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,
    args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(repo,'index-workflow.js')],cwd:repo,stderr:'pipe',
    env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
      TAMRANK_PAT:profile==='core'?f.reader:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
  const call=(name,args)=>client.callTool({name,arguments:args});
  try{
    await client.connect(transport);const listing=await client.listTools();
    check(listing.tools.length===(profile==='core'?12:20)&&JSON.stringify(listing).length<=16000,'Existing tool surface remains bounded');
    const capsReply=await call('get_capabilities',{});check(!capsReply.isError,'Native capabilities available');
    const caps=JSON.parse(capsReply.content[0].text),c=caps.schema_execution;
    check(c.contract_version===1&&c.read_available&&c.record_contract==='schema_execution_view_v1'&&c.private_proofs_omitted,'Explicit semantic schema-read capability');
    check(!c.available&&!c.rollback_available&&!c.recovery_available&&c.operations.length===0,'Read availability grants no website writes or recovery');
    const reply=await call('get_changes',{kind:'execution',change_set_id:id});
    check(!reply.isError,'Actual native schema execution read: '+(reply.isError?reply.content[0]?.text:''));
    const data=JSON.parse(reply.content[0].text);
    check(validSchemaExecutionResponse(data,id,f.record.envelope.plan_hash),'Native response passes the strict semantic validator');
    checks++;assert.deepEqual(data.record,f.record,'All exact items, values, schema samples, approval and states survive SDK/TLS');
    const again=await call('get_changes',{kind:'execution',change_set_id:id});check(!again.isError,'Historical repeated read remains available');
    checks++;assert.deepEqual(JSON.parse(again.content[0].text),data,'Read does not manufacture another execution or change history');
    check((await call('execute_change_set',{change_set_id:id,change_token:f.record.envelope.change_token,
      confirmation:{plan_hash:f.record.envelope.plan_hash,confirmed:true}})).isError,'Read-only advertisement cannot activate an old schema token');
    check((await call('get_changes',{kind:'execution',change_set_id:id,include_private_proofs:true})).isError,'Private-proof selector is not a tool argument');
  }finally{await client.close();await transport.close();}
}
// A different actual owner gets no record through the same MCP route.
const client=new Client({name:'Owned other schema reader',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['--import',path.join(repo,'test/owned-schema-dns.mjs'),path.join(repo,'index-workflow.js')],
  cwd:repo,stderr:'pipe',env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
    TAMRANK_PAT:f.other,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:'pretty',TAMRANK_WORKFLOW_PREVIEW:'1'}});
try{await client.connect(transport);const r=await client.callTool({name:'get_changes',arguments:{kind:'execution',change_set_id:id}});
  check(r.isError,'Another owner cannot read the real native record');
  check(!r.content[0].text.includes(f.record.envelope.change_token),'Foreign response exposes no stored token');
}finally{await client.close();await transport.close();}
process.stdout.write(JSON.stringify({ok:true,checks}));
