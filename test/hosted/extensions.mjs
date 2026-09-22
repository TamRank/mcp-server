import assert from 'node:assert/strict';
import {z} from 'zod';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createWorkflowServer} from '../../src/hosted/factory.js';
import {context,fullCaps} from './factory-fixtures.mjs';
import {createStubVps} from './stub-vps.mjs';
const caps=fullCaps();for(const name of ['portfolio_before','portfolio_after','portfolio_renamed'])caps.reads[name]={available:true};
const stub=createStubVps(),server=createWorkflowServer(context(stub,{capabilities:caps}));
const seen=[];
const add=name=>server.registerTool(name,{description:'Hosted-only fixture.',inputSchema:z.object({selection:z.string().min(1)}).strict()},async args=>{
  seen.push([name,args.selection]);return {content:[{type:'text',text:JSON.stringify({selection:args.selection})}]};
});
const before=add('portfolio_before');
const client=new Client({name:'hosted-extension-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
await server.connect(a);await client.connect(b);
const names=async()=>(await client.listTools()).tools.map(t=>t.name);
try{
  assert.ok((await names()).includes('portfolio_before'));
  assert.equal((await client.callTool({name:'portfolio_before',arguments:{selection:'before'}})).isError,undefined);
  const after=add('portfolio_after');
  assert.ok((await names()).includes('portfolio_after'));
  assert.equal((await client.callTool({name:'portfolio_after',arguments:{selection:'after'}})).isError,undefined);
  assert.equal((await client.callTool({name:'portfolio_after',arguments:{selection:'after',account_id:'foreign'}})).isError,true);
  assert.equal(seen.length,2,'SDK strict validation still owns arguments');
  after.disable();assert.ok(!(await names()).includes('portfolio_after'));
  assert.equal((await client.callTool({name:'portfolio_after',arguments:{selection:'disabled'}})).isError,true);
  after.enable();assert.ok((await names()).includes('portfolio_after'));
  after.update({name:'portfolio_renamed'});assert.ok(!(await names()).includes('portfolio_after'));assert.ok((await names()).includes('portfolio_renamed'));
  assert.equal((await client.callTool({name:'portfolio_renamed',arguments:{selection:'renamed'}})).isError,undefined);
  after.remove();assert.ok(!(await names()).includes('portfolio_renamed'));
  assert.equal((await client.callTool({name:'portfolio_renamed',arguments:{selection:'removed'}})).isError,true);
  add('unadvertised_extension');assert.ok(!(await names()).includes('unadvertised_extension'),'Positive capability filter stays intact');
  before.remove();assert.ok(!(await names()).includes('portfolio_before'));
  assert.equal(stub.calls.length,0,'No local client, keyring or WordPress dispatch');
  console.log('PASS hosted extensions: before/after initialize, call/list parity, strict inputs, disable/enable/rename/remove, positive caps, zero upstream');
}finally{await client.close();await server.close();}
