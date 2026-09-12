/** Same real stdio/TLS route with other-owner and read-only site credentials. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
export async function verifySchemaAuthority(f,original,check){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),id=original.record.envelope.plan.change_set_id;
  const runtime=ownedInstalledRuntime(root);
  for(const [actor,token] of [['reader',f.reader],['other',f.other]]){
    const client=new Client({name:'Owned schema authority client',version:'1'});
    const transport=new StdioClientTransport({command:process.execPath,args:['--import',path.join(root,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],
      cwd:runtime,stderr:'pipe',env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
        TAMRANK_PAT:token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:f.profile,TAMRANK_REST_STYLE:f.style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
    try{
      await client.connect(transport);
      const capsReply=await client.callTool({name:'get_capabilities',arguments:{}});check(!capsReply.isError,'Actual '+actor+' capabilities');
      const caps=JSON.parse(capsReply.content[0].text).schema_execution;
      check(caps.read_available===true&&caps.available===(actor==='other'),'Other owner has own write rights; reader gains no writer');
      const read=await client.callTool({name:'get_changes',arguments:{kind:'execution',change_set_id:id}});
      if(actor==='reader'){
        check(!read.isError,'Same-owner audit reader can inspect proposal');assert.deepEqual(JSON.parse(read.content[0].text),original);
        check(true,'Same-owner reader gets exactly the immutable proposal');
      }else check(read.isError&&!read.content[0].text.includes(original.record.envelope.change_token),'Other owner cannot read proposal/token');
      const result=await client.callTool({name:'execute_change_set',arguments:{change_set_id:id,change_token:original.record.envelope.change_token,
        confirmation:{plan_hash:original.record.envelope.plan_hash,confirmed:true,acknowledgements:original.record.envelope.plan.required_acknowledgements}}});
      check(result.isError,'Actual '+actor+' cannot execute original owner proposal');
      check(!result.content[0].text.includes(original.record.envelope.change_token),'Denied execution exposes no stored token');
    }finally{await client.close();await transport.close();}
  }
}
