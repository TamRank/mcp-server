/** Run only through the PRO synthetic HTTP harness; credentials via stdin. */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);assert.match(config.site_url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
const clients=[];
async function connect(token,style) {
  const client=new Client({name:'synthetic-scan-planning-test',version:'1.0.0'});clients.push(client);
  await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'index-workflow.js'],cwd:root,
    env:{PATH:process.env.PATH,TAMRANK_PAT:token,TAMRANK_SITE_URL:config.site_url,TAMRANK_WORKFLOW_PREVIEW:'1',
      TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style},stderr:'pipe'}));return client;
}
async function call(client,name,args={}) {
  const result=await client.callTool({name,arguments:args});const data=JSON.parse(result.content.find(c=>c.type==='text').text);
  if(result.isError)throw new Error(data.code);return data;
}
try {
  for(const style of ['pretty','query']) {
    const client=await connect(config.token,style),listing=await client.listTools();
    assert.equal(listing.tools.length,20);
    const size=JSON.stringify(listing).length;assert.ok(size<16000,`Specialist surface too large: ${size}`);
    assert.equal(listing.tools.find(t=>t.name==='start_scan').annotations.readOnlyHint,false);
    const preview=await call(client,'start_scan',{mode:'preview',type:'pagespeed',post_ids:[205,1]});
    assert.equal(preview.plan_persisted,false);
    const args={mode:'plan',type:'pagespeed',post_ids:[205,1],expected_revision:preview.preview_revision,client_request_id:'mcp-scan-plan-'+style};
    const draft=await call(client,'start_scan',args);
    assert.equal(draft.plan_persisted,true);assert.equal(draft.approval_recorded,false);assert.equal(draft.execution_enabled,false);
    assert.deepEqual(draft.proposal.targets.map(t=>t.post_id),[205,1]);
    assert.deepEqual(await call(client,'get_scan_status',{proposal_id:draft.proposal_id}),draft);
    assert.deepEqual(await call(client,'start_scan',args),draft);
    await assert.rejects(call(client,'start_scan',{...args,post_ids:[1]}),/scan_proposal_request_conflict/);
    await assert.rejects(call(client,'start_scan',{...args,mode:'execute'}));
    await assert.rejects(call(client,'start_scan',{...args,confirmed:true}));
    await assert.rejects(call(client,'get_scan_status',{proposal_id:draft.proposal_id,type:'pagespeed'}));
    const reader=await connect(config.read_token,style);
    await assert.rejects(call(reader,'start_scan',args),/workflow_operation_unavailable/);
    await assert.rejects(call(reader,'get_scan_status',{proposal_id:draft.proposal_id}),/workflow_operation_unavailable/);
    console.log(`Scan proposals MCP -> WordPress OK: ${style}, exact private planning/read/replay, no scan; specialist ${size}/16000 chars.`);
  }
} finally {for(const client of clients)await client.close();}
