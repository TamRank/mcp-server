/** Every emitted schema keeps the same constraints; real SDK calls still validate. */
import assert from 'node:assert/strict';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {normalizeObjectSchema} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {toJsonSchemaCompat} from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {compactWorkflowSchema,expandLocalSchema,simplifyWorkflowSchema} from '../src/workflow-catalog.js';
let checks=0;const equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const ajv2020=new Ajv2020({strict:false});addFormats(ajv2020);
const oldValidator=new AjvJsonSchemaValidator(),newValidator=new AjvJsonSchemaValidator(ajv2020);
const scalar=[null,false,true,0,1,-1,1.5,Number.MAX_SAFE_INTEGER+1,'','wrong','a'.repeat(64),[],{},['wrong']];
function sample(s){
  if(!s||typeof s!=='object')return null;
  if(Object.hasOwn(s,'const'))return s.const;if(s.enum)return s.enum[0];
  if(s.anyOf)return sample(s.anyOf[0]);
  if(s.type==='object')return Object.fromEntries((s.required||[]).map(k=>[k,sample(s.properties[k])]));
  if(s.type==='array')return Array.from({length:s.minItems||0},()=>sample(s.items));
  if(s.type==='integer'||s.type==='number')return Math.max(1,s.minimum||0);
  if(s.type==='boolean')return true;
  return 'fixture';
}
for(const profile of ['core','specialist','legacy'])for(const enabled of [false,true,'storage']){
  const server=new McpServer({name:'catalog-fixture',version:'1'}),client=new Client({name:'catalog-client',version:'1'}),handles=new Map();
  const nativeRegister=server.registerTool.bind(server);server.registerTool=(name,config,handler)=>{
    const handle=nativeRegister(name,config,handler);handles.set(name,handle);return handle;
  };
  registerWorkflowTools(server,{}, {profile,capabilities:enabled?{schema_preview:{contract_version:2,available:true,operations:['schema.detect'],schema_proposals_available:enabled==='storage'},
    ...(enabled==='storage'?{field_proposals:{contract_version:2,available:true,operations:['schema.detect']}}:{})}:null});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
    const listing=await client.listTools();equal(listing.tools.length,{core:12,specialist:20,legacy:42}[profile],'Tool names/count preserved');
    const size=JSON.stringify(listing).length;if(profile!=='legacy')assert.ok(size<16000,`${profile} ${enabled}: ${size}`);
    console.log(`${profile}, schema preview ${enabled}: ${size} characters`);
    for(const tool of listing.tools){
      const handle=handles.get(tool.name),raw=toJsonSchemaCompat(normalizeObjectSchema(handle.inputSchema),{strictUnions:true,pipeStrategy:'input'});
      equal(tool.annotations,handle.annotations,'Safety annotations preserved');
      let expected=expandLocalSchema(raw);if(!tool.inputSchema.$schema){delete expected.$schema;expected=simplifyWorkflowSchema(expected);}
      equal(expandLocalSchema(tool.inputSchema),expected,'All properties/constraints survive reference compaction');
      const before=oldValidator.getValidator(raw),after=(tool.inputSchema.$schema?oldValidator:newValidator).getValidator(tool.inputSchema);
      const corpus=[...scalar,sample(expected),Object.fromEntries(Object.entries(expected.properties||{}).map(([k,s])=>[k,sample(s)]))];
      for(const [k,s]of Object.entries(expected.properties||{}))for(const value of [...scalar,sample(s)])corpus.push({...sample(expected),[k]:value});
      for(const value of corpus)equal(before(value).valid,after(value).valid,'Draft-7 and compact/default-dialect validation agree');
    }
    if(profile==='core'){
      const handle=handles.get('get_site_context');handle.disable();equal((await client.listTools()).tools.some(t=>t.name==='get_site_context'),false,'Disabled handle stays hidden');
      handle.enable();equal((await client.listTools()).tools.length,12,'Re-enabled handle restored');
      const invalid=await client.callTool({name:'get_capabilities',arguments:{execute:true}});equal(invalid.isError,true,'SDK original strict input validation stays active');
    }
  }finally{await client.close();await server.close();}
}
for(const unsafe of [{$schema:'https://other.invalid/dialect',type:'object'},
  {$schema:'http://json-schema.org/draft-07/schema#',type:'object',dependencies:{x:['y']}},
  {$schema:'http://json-schema.org/draft-07/schema#',type:'array',items:[{type:'string'}]},
  {$schema:'http://json-schema.org/draft-07/schema#',type:'object',properties:{x:{$ref:'https://other.invalid/x'}}}]){
  equal(compactWorkflowSchema(unsafe),unsafe,'Unknown dialect, vocabulary, tuple or external reference is not rewritten');
}
console.log(`PASS: ${checks} catalog equivalence checks; full enabled specialist profile stays under 16,000 characters.`);
