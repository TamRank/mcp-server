/** stdio profile gate = hosted profile gate (decision 30 Sep 2026): workflow-v2-1 is admitted with the
 * safe-beta-1 tool profile, safe-beta-1 is unchanged, an unknown profile still needs an upgrade. No network. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {discoverWorkflows} from '../src/scan-maintenance.js';
import {buildWorkflowServer} from '../src/workflow-server.js';
import {createWorkflowServer} from '../src/hosted/factory.js';
import {createStubVps} from './hosted/stub-vps.mjs';
import {context} from './hosted/factory-fixtures.mjs';

const readNames=['get_site_context','get_capabilities','get_work_queue','get_signals','search_pages','get_page','diagnose_page'];
const specialistNames=['get_site_diagnostics','get_gsc_pages','get_redirects','get_images_missing_alt','get_topical_authority'];
const hash='a'.repeat(64);

/** What PRO advertises under workflow-v2-1 (tammarketing.nl shape): the safe-beta surface plus
 * schema, scan, recovery and mixed-set lanes. */
const v21=(overrides={})=>({contract_version:2,full_v2_compatible:false,mcp_bridge_compatibility:'workflow-v2-1',
  reads:Object.fromEntries([...readNames,'get_legacy_fixture'].map(name=>[name,{available:true}])),
  field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:true,
    operations:['meta.update','social.update','image_alt.update']},
  field_proposals:{contract_version:2,available:true,read_available:true,origin_kinds:['user_request'],
    operations:['meta.update','social.update','image_alt.update','redirect.create','schema.select']},
  redirect_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,mixed_available:true,
    recovery_available:true,recovery_delivery_available:true,operations:['redirect.create','redirect.update','schema.select']},
  schema_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:true,
    record_contract:'schema_execution_view_v1',private_proofs_omitted:true},
  schema_preview:{contract_version:2,available:true,schema_proposals_available:true},
  scan_proposals:{available:true,read_available:true,modes:['plan']},
  specialist_reads:{...Object.fromEntries(specialistNames.map(name=>[name,{available:true}])),
    start_scan:{available:true,modes:['preview'],types:['index','pagespeed']}},
  work_administration:{available:true,operations:['work.note','importance.update','bulk.delete'],
    importance:{available:true},manual:{available:true,operations:['work.note','bulk.delete']}},
  ...overrides,
});

/** The hosted filterCapabilities result for v21() with every scope and both hosted flags on
 * (tamrank-api src/mcp/hosted/scopes.ts), transcribed so this test does not trust the clamp it checks. */
const hostedFiltered=()=>({contract_version:2,mcp_bridge_compatibility:'safe-beta-1',full_v2_compatible:false,
  reads:Object.fromEntries(readNames.map(name=>[name,{available:true}])),
  field_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,recovery_available:false,
    operations:['meta.update','social.update','image_alt.update']},
  field_proposals:{contract_version:2,available:true,read_available:true,origin_kinds:['user_request'],
    operations:['meta.update','social.update','image_alt.update']},
  redirect_execution:{contract_version:1,available:true,read_available:true,rollback_available:true,mixed_available:false,
    recovery_available:false,recovery_delivery_available:false,operations:['redirect.create','redirect.update']},
  specialist_reads:Object.fromEntries(specialistNames.map(name=>[name,{available:true}])),
  work_administration:{available:true,operations:['work.note','importance.update'],
    importance:{available:true},manual:{available:true,operations:['work.note']}},
});

const site=caps=>{const calls=[];return {calls,get:async path=>{calls.push(path);
  if(path==='/capabilities')return structuredClone(caps);throw new Error('Unexpected route '+path);},
  post:async path=>{throw new Error('Unexpected write '+path);}};};

async function listed(server){
  const client=new Client({name:'Synthetic MCP client',version:'2.4'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  const tools=(await client.listTools()).tools.map(tool=>tool.name).sort();
  return {tools,client,async close(){await client.close();await server.close();}};
}
async function stdio(caps,options={}){
  const wire=site(caps),found=await discoverWorkflows(wire,{profile:'core',...options});
  const server=buildWorkflowServer(wire,{profile:'core',capabilities:found.capabilities,preflight:found.preflight,
    maintenanceOnly:found.maintenanceOnly,profileClamp:found.profileClamp});
  return {found,wire,...await listed(server)};
}
async function hosted(filteredCapabilities){
  const stub=createStubVps();
  return listed(createWorkflowServer(context(stub,{capabilities:filteredCapabilities,
    scopes:['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write','redirects:write']})));
}

test('workflow-v2-1 with full_v2_compatible:false passes discovery, clamped to the hosted capabilities',async()=>{
  const {found}=await stdio(v21());
  assert.deepEqual(found.preflight,{ok:true});
  assert.equal(found.profileClamp,true);
  assert.deepEqual(found.capabilities,hostedFiltered());
  for(const lane of ['schema_execution','schema_preview','scan_proposals'])assert.equal(found.capabilities[lane],undefined,lane);
});

test('workflow-v2-1 lists exactly the hosted toolset for the same site',async()=>{
  const local=await stdio(v21()),remote=await hosted(hostedFiltered());
  try{
    assert.deepEqual(local.tools,remote.tools);
    assert.deepEqual(local.tools,[...readNames,...specialistNames,'update_work_item','plan_changes','execute_change_set',
      'get_changes','rollback_change_set'].sort());
    for(const hidden of ['start_scan','get_scan_status','close_scan'])assert.equal(local.tools.includes(hidden),false,hidden);
    const instructions=local.client.getInstructions();
    assert.match(instructions,/For this site profile, recovery and specialist modes are unavailable, except the listed stored-data reads\./);
    assert.equal(instructions.includes('Recovery: get_changes(kind=recovery)'),false);
  }finally{await local.close();await remote.close();}
});

test('a narrower workflow-v2-1 site hides the same tools as hosted',async()=>{
  const narrow=v21({field_execution:undefined,redirect_execution:undefined,
    specialist_reads:{get_gsc_pages:{available:false},get_redirects:{available:true}},work_administration:{available:false,operations:[]}});
  const local=await stdio(narrow);
  const filtered=hostedFiltered();delete filtered.field_execution;delete filtered.redirect_execution;
  filtered.specialist_reads={get_gsc_pages:{available:false},get_redirects:{available:true}};
  filtered.work_administration={available:false,operations:[]};
  assert.deepEqual(local.found.capabilities,filtered);
  const remote=await hosted(filtered);
  try{
    assert.deepEqual(local.tools,remote.tools);
    for(const hidden of ['execute_change_set','rollback_change_set','update_work_item','get_gsc_pages','get_topical_authority'])
      assert.equal(local.tools.includes(hidden),false,hidden);
    assert.equal(local.tools.includes('get_redirects'),true);
  }finally{await local.close();await remote.close();}
});

test('get_capabilities on a clamped site reports the clamp, not the raw superset',async()=>{
  const local=await stdio(v21());
  try{
    const result=await local.client.callTool({name:'get_capabilities',arguments:{}});
    assert.equal(result.isError,undefined);
    assert.deepEqual(JSON.parse(result.content[0].text),hostedFiltered());
  }finally{await local.close();}
});

test('a schema execution token is refused locally on a clamped site; nothing is sent',async()=>{
  const local=await stdio(v21());
  try{
    const result=await local.client.callTool({name:'execute_change_set',arguments:{change_set_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      change_token:'trse1.'+'b'.repeat(64),confirmation:{plan_hash:hash,confirmed:true}}});
    assert.equal(result.isError,true);
    assert.deepEqual(local.wire.calls,['/capabilities']);
  }finally{await local.close();}
});

test('safe-beta-1 is unchanged: raw capabilities, no clamp, the same twelve core tools',async()=>{
  const raw=v21({mcp_bridge_compatibility:'safe-beta-1'});
  const local=await stdio(raw);
  try{
    assert.deepEqual(local.found.preflight,{ok:true});
    assert.equal(local.found.profileClamp,false);
    assert.deepEqual(local.found.capabilities,raw);
    assert.deepEqual(local.tools,[...readNames,'update_work_item','plan_changes','execute_change_set','get_changes','rollback_change_set'].sort());
    const result=await local.client.callTool({name:'get_capabilities',arguments:{}});
    assert.deepEqual(JSON.parse(result.content[0].text),raw);
  }finally{await local.close();}
});

test('an unknown or missing profile still needs a workflow upgrade',async()=>{
  for(const profile of ['workflow-v3-0','not_advertised',undefined,'Workflow-V2-1']){
    const found=await discoverWorkflows(site(v21({mcp_bridge_compatibility:profile})),{profile:'core'});
    assert.equal(found.preflight.code,'workflow_upgrade_required',String(profile));
    assert.equal(found.profileClamp,false);
  }
});

test('full v2 and explicit development preview keep their unclamped capabilities',async()=>{
  const full=v21({full_v2_compatible:true});
  const fullFound=await discoverWorkflows(site(full),{profile:'core'});
  assert.equal(fullFound.profileClamp,false);assert.deepEqual(fullFound.capabilities,full);
  const previewFound=await discoverWorkflows(site(v21()),{profile:'core',preview:true});
  assert.equal(previewFound.profileClamp,false);assert.deepEqual(previewFound.capabilities,v21());
});
