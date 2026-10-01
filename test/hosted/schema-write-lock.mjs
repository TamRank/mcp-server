/** The hosted schema write lock, both layers (decision 1 Oct 2026). Layer 1 is the VPS
 * `filterCapabilities` (tamrank-api src/mcp/hosted/scopes.ts): it clamps `mcp_bridge_compatibility` to
 * the safe-beta-1 tool profile and copies only allowlisted sections, so `schema_execution` never
 * reaches the factory. Layer 2 is this bridge: a hosted session drops schema execution/preview again,
 * whatever the VPS sends. Each test feeds a workflow-v2-1 site, once as layer 1 should deliver it and
 * once as if layer 1 had only relabelled the superset. No network. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createWorkflowServer} from '../../src/hosted/factory.js';
import {buildWorkflowServer} from '../../src/workflow-server.js';
import {clampToToolProfile} from '../../src/workflow-profile.js';
import {createStubVps} from './stub-vps.mjs';
import {context,nativeReply,id,hash} from './factory-fixtures.mjs';

const readNames=['get_site_context','get_capabilities','get_work_queue','get_signals','search_pages','get_page','diagnose_page'];
const HOSTED_PLAN_OPERATIONS=['image_alt.update','meta.update','redirect.create','redirect.delete','redirect.update','social.update'];
const SCHEMA_OPERATIONS=['schema.select','schema.detect','schema_settings.update'];
const SCHEMA_LANES=['schema_execution','schema_preview','scan_proposals'];
const scopes=['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write','redirects:write'];

/** What PRO advertises under workflow-v2-1 (tammarketing.nl shape), schema lanes fully on. */
const v21=()=>({contract_version:2,full_v2_compatible:false,mcp_bridge_compatibility:'workflow-v2-1',
  reads:Object.fromEntries(readNames.map(name=>[name,{available:true}])),
  field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:true,
    operations:['meta.update','social.update','image_alt.update']},
  field_proposals:{contract_version:2,available:true,read_available:true,origin_kinds:['user_request'],
    operations:['meta.update','social.update','image_alt.update','redirect.create','schema.select','schema_settings.update']},
  redirect_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,mixed_available:true,
    recovery_available:true,recovery_delivery_available:true,operations:['redirect.create','redirect.update','redirect.delete','schema.select']},
  schema_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:true,
    rollback_preview_available:true,rollback_preview_contract:'schema_rollback_preview_v1',
    recovery_contract:'schema_journal_recovery_v1',record_contract:'schema_execution_view_v1',private_proofs_omitted:true},
  schema_preview:{contract_version:2,available:true,schema_proposals_available:true},
  scan_proposals:{available:true,read_available:true,modes:['plan']},
});

/** Layer 1 as it should be: filterCapabilities(v21(), every scope, both hosted flags on), transcribed
 * from scopes.ts:207-323 so this file does not trust the stdio mirror it also checks. */
const layerOne=()=>({contract_version:2,mcp_bridge_compatibility:'safe-beta-1',full_v2_compatible:false,
  reads:Object.fromEntries(readNames.map(name=>[name,{available:true}])),
  field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:false,
    operations:['meta.update','social.update','image_alt.update']},
  field_proposals:{contract_version:2,available:true,read_available:true,origin_kinds:['user_request'],
    operations:['meta.update','social.update','image_alt.update']},
  redirect_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,mixed_available:false,
    recovery_available:false,recovery_delivery_available:false,operations:['redirect.create','redirect.update','redirect.delete']},
});
/** Layer 1 failing open: the profile label clamped, every v2-1 section passed through. */
const layerOneLeaked=()=>({...v21(),mcp_bridge_compatibility:'safe-beta-1'});
const feeds=[['layer 1 intact',layerOne],['layer 1 leaked the superset',layerOneLeaked]];

async function linked(server){
  const client=new Client({name:'Synthetic MCP client',version:'2.4'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  return {client,async close(){await client.close();await server.close();}};
}
async function hosted(capabilities,responses=[]){
  const stub=createStubVps({responses});
  return {stub,...await linked(createWorkflowServer(context(stub,{capabilities,scopes})))};
}
/** Every operation enum in a listed input schema, through unions and nesting. */
function operationEnums(schema){
  const found=new Set();
  (function walk(node){
    if(Array.isArray(node))return node.forEach(walk);
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node.properties?.operation?.enum))node.properties.operation.enum.forEach(op=>found.add(op));
    if(typeof node.properties?.operation?.const==='string')found.add(node.properties.operation.const);
    Object.values(node).forEach(walk);
  })(schema);
  return [...found].sort();
}
const listedTool=async(client,name)=>(await client.listTools()).tools.find(tool=>tool.name===name);
const plan=items=>({client_request_id:'synthetic-plan-001',
  origin:{kind:'user_request',reference:'synthetic',summary:'Synthetic user instruction'},items});
const schemaItem={operation:'schema.select',target:{post_id:1},fields:{schema_type:{mode:'set',value:'Article'},expected_revision:{mode:'set',value:1}}};
const refusedLocally=(session,result)=>{
  assert.equal(result.isError,true);
  assert.equal(session.stub.calls.length,0,'nothing reached the site');
  assert.equal(session.stub.events.length,0,'not even an authorization call');
};

test('layer 1 transcript: the workflow-v2-1 superset reaches the factory without any schema lane',()=>{
  const out=layerOne();
  assert.equal(out.mcp_bridge_compatibility,'safe-beta-1');
  for(const lane of SCHEMA_LANES)assert.equal(Object.hasOwn(out,lane),false,lane);
  for(const section of ['field_proposals','redirect_execution'])
    for(const op of SCHEMA_OPERATIONS)assert.equal(out[section].operations.includes(op),false,section+' '+op);
});

test('the stdio mirror clamps a v2-1 or relabelled superset to the same lock',()=>{
  for(const raw of [v21(),layerOneLeaked()]){
    const out=clampToToolProfile(raw);
    assert.equal(out.mcp_bridge_compatibility,'safe-beta-1');
    for(const lane of SCHEMA_LANES)assert.equal(Object.hasOwn(out,lane),false,lane);
    assert.deepEqual(out.field_proposals.operations,['meta.update','social.update','image_alt.update']);
    assert.deepEqual(out.redirect_execution.operations,['redirect.create','redirect.update','redirect.delete']);
  }
});

test('control: an unclamped full-v2 stdio session does list schema operations, so the enum check has teeth',async()=>{
  const wire={get:async()=>{throw new Error('no reads');},post:async()=>{throw new Error('no writes');}};
  const session=await linked(buildWorkflowServer(wire,{profile:'core',capabilities:{...v21(),full_v2_compatible:true},preflight:{ok:true}}));
  try{
    const ops=operationEnums((await listedTool(session.client,'plan_changes')).inputSchema);
    assert.ok(ops.includes('schema.select'),ops.join());
  }finally{await session.close();}
});

for(const [label,caps] of feeds){
  test(`hosted plan_changes knows only meta, image_alt, social and redirect.* (${label})`,async()=>{
    const session=await hosted(caps());
    try{
      const tool=await listedTool(session.client,'plan_changes');
      assert.deepEqual(operationEnums(tool.inputSchema),HOSTED_PLAN_OPERATIONS);
      assert.equal(Object.hasOwn(tool.inputSchema.properties,'schema_preview'),false);
    }finally{await session.close();}
  });

  test(`hosted plan_changes refuses a schema item before authorization (${label})`,async()=>{
    for(const op of SCHEMA_OPERATIONS){
      const session=await hosted(caps());
      try{refusedLocally(session,await session.client.callTool({name:'plan_changes',arguments:plan([{...schemaItem,operation:op}])}));}
      finally{await session.close();}
    }
    const session=await hosted(caps());
    try{refusedLocally(session,await session.client.callTool({name:'plan_changes',arguments:{schema_preview:{source_job:'x'}}}));}
    finally{await session.close();}
  });

  test(`hosted execute_change_set refuses a schema token before authorization (${label})`,async()=>{
    const session=await hosted(caps());
    try{
      const tool=await listedTool(session.client,'execute_change_set');
      assert.equal(JSON.stringify(tool.inputSchema).includes('trse1'),false);
      refusedLocally(session,await session.client.callTool({name:'execute_change_set',arguments:{change_set_id:id,
        change_token:'trse1.'+'b'.repeat(64),confirmation:{plan_hash:hash,confirmed:true}}}));
    }finally{await session.close();}
  });

  test(`hosted get_changes never serves schema recovery (${label})`,async()=>{
    const session=await hosted(caps());
    try{
      const result=await session.client.callTool({name:'get_changes',arguments:{change_set_id:id,kind:'recovery'}});
      assert.equal(result.isError,true);
      assert.equal(session.stub.calls.length,0);
    }finally{await session.close();}
  });

  test(`positive control: field and redirect drafts still reach the site (${label})`,async()=>{
    const items=[
      [{operation:'meta.update',target:{post_id:1},fields:{meta_title:{mode:'set',value:'Synthetic title'}}}],
      [{operation:'redirect.create',target:{source_url:'/old'},fields:{target_url:{mode:'set',value:'/new'},redirect_type:{mode:'set',value:301}}}],
    ];
    for(const set of items){
      const session=await hosted(caps(),[{method:'POST',body:nativeReply()}]);
      try{
        await session.client.callTool({name:'plan_changes',arguments:plan(set)});
        assert.equal(session.stub.calls.length,1,set[0].operation);
        assert.match(session.stub.calls[0].url,/\/changes\/(?:proposals|executions)$/,session.stub.calls[0].url);
        assert.equal(JSON.parse(new TextDecoder().decode(session.stub.calls[0].bodyBytes)).items[0].operation,set[0].operation);
      }finally{await session.close();}
    }
  });
}
