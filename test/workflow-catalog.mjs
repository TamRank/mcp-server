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
for(const profile of ['core','specialist','legacy'])for(const enabled of [false,true,'storage','execution','recovery','redirect','redirect_recovery','schema_read','schema_mixed_read']){
  const server=new McpServer({name:'catalog-fixture',version:'1'}),client=new Client({name:'catalog-client',version:'1'}),handles=new Map();
  const nativeRegister=server.registerTool.bind(server);server.registerTool=(name,config,handler)=>{
    const handle=nativeRegister(name,config,handler);handles.set(name,handle);return handle;
  };
  const storage=['storage','execution','recovery','redirect','redirect_recovery','schema_mixed_read'].includes(enabled);
  const redirect=['redirect','redirect_recovery','schema_mixed_read'].includes(enabled),recovery=['recovery','redirect_recovery','schema_mixed_read'].includes(enabled);
  registerWorkflowTools(server,{}, {profile,capabilities:enabled?{schema_preview:{contract_version:2,available:true,operations:['schema.detect'],schema_proposals_available:storage},
    ...(storage?{field_proposals:{contract_version:2,available:true,operations:['schema.detect']}}:{}),
    ...(['execution','recovery','redirect','redirect_recovery','schema_mixed_read'].includes(enabled)?{field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:recovery,operations:['meta.update','social.update','image_alt.update']}}:{}),
    ...(['schema_read','schema_mixed_read'].includes(enabled)?{schema_execution:{contract_version:1,available:false,read_available:true,rollback_available:false,
      recovery_available:false,operations:[],record_contract:'schema_execution_view_v1',private_proofs_omitted:true}}:{}),
    ...(redirect?{redirect_execution:{contract_version:1,available:true,mixed_available:true,read_available:true,rollback_available:true,recovery_available:recovery,
      operations:['meta.update','social.update','image_alt.update','redirect.create','redirect.update','redirect.delete']}}:{})}:null});
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
      const source=expandLocalSchema(raw);
      const corpus=[...scalar,sample(source),Object.fromEntries(Object.entries(source.properties||{}).map(([k,s])=>[k,sample(s)]))];
      for(const [k,s]of Object.entries(source.properties||{}))for(const value of [...scalar,sample(s)])corpus.push({...sample(source),[k]:value});
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
// Exercise the optimizations with valid inputs and each missing/extra-key case,
// not merely malformed tool arguments that both schemas would reject anyway.
const closed={type:'object',properties:{long_required_name:{type:'string'},another_required_name:{type:'integer'}},
  additionalProperties:false,required:['long_required_name','another_required_name']};
const scalarUnion={anyOf:[{type:'string',minLength:2,maxLength:4,pattern:'^a'},
  {type:'integer',minimum:2,maximum:8,multipleOf:2},{type:'boolean'},{type:'null'}]};
const focused=[closed,{...closed,minProperties:3},{...closed,maxProperties:1},
  {...closed,required:['long_required_name']},{...closed,additionalProperties:true},
  {...closed,patternProperties:{'^extra':{type:'string'}}},scalarUnion,
  {anyOf:[{type:'integer',minimum:4},{type:'number',maximum:2}]},
  {anyOf:[{type:'string',minLength:3},{type:'string',maxLength:1}]},
  {anyOf:[{type:'string',enum:['allowed']},{type:'null'}]},
  {type:'object',additionalProperties:true},{type:'object',additionalProperties:{}},
  {anyOf:[{const:7},{enum:[28,90]},{const:7}]},
  {anyOf:[{const:'a',description:'Keep annotation'},{const:'b'}]}];
const objects=[];
for(const a of [undefined,'valid',false])for(const b of [undefined,2,'2'])for(const extra of [false,true]){
  objects.push({...a!==undefined?{long_required_name:a}:{},...b!==undefined?{another_required_name:b}:{},...extra?{extra_key:'x'}:{}});
}
for(const schema of focused){
  const simplified=simplifyWorkflowSchema(schema),before=newValidator.getValidator(schema),after=newValidator.getValidator(simplified);
  for(const value of [...scalar,...objects,'a','ab','abcd','abcde','bb','allowed',2,4,6,8,10,2.5])
    equal(before(value).valid,after(value).valid,'Focused object/union validation is equivalent');
}
equal(simplifyWorkflowSchema(closed).minProperties,2,'All required closed keys compacted');
equal(simplifyWorkflowSchema(focused[5]).required,closed.required,'Pattern properties preserve required keys');
equal(simplifyWorkflowSchema(scalarUnion).type,['string','integer','boolean','null'],'Disjoint constrained scalars compacted');
equal(simplifyWorkflowSchema(focused[7]),focused[7],'Overlapping integer/number branches not merged');
equal(simplifyWorkflowSchema(focused[12]),{enum:[7,28,90]},'Literal union compacts without losing alternatives');
const leaf={type:'string',minLength:3,maxLength:100,pattern:'^[a-z]+$'};
const repeated={type:'object',properties:{first_long_key:leaf,second_long_key:leaf},additionalProperties:false,required:['first_long_key','second_long_key']};
const nested={$schema:'http://json-schema.org/draft-07/schema#',type:'object',properties:{a:repeated,b:repeated,c:leaf}};
const nestedCompact=compactWorkflowSchema(nested),expanded=expandLocalSchema(nested);delete expanded.$schema;
equal(expandLocalSchema(nestedCompact),simplifyWorkflowSchema(expanded),'Nested extracted definitions stay acyclic and equivalent');
equal(Object.keys(nestedCompact.$defs||{}).length>=2,true,'Shared leaves inside extracted definitions are compacted too');
console.log(`PASS: ${checks} catalog equivalence checks; full enabled specialist profile stays under 16,000 characters.`);
