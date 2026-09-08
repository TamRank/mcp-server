/** Invoked by PRO's isolated full-WordPress harness, not by ordinary npm tests. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
let text='';for await(const chunk of process.stdin)text+=chunk;const fixture=JSON.parse(text);
assert.match(fixture.origin,/^http:\/\/127\.0\.0\.1:[0-9]+(?:\/client-two)?$/);
let input,original,closed;
for(const style of ['pretty','query']) {
  const client=new Client({name:'synthetic-native-maintenance',version:'1.0.0'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd:process.cwd(),stderr:'pipe',
      env:{PATH:process.env.PATH,TAMRANK_PAT:fixture.tokens.admin.token,TAMRANK_SITE_URL:fixture.origin,
        TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_WORKFLOW_PREVIEW:'1',TAMRANK_REST_STYLE:style}}));
    const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,`${name}: ${JSON.stringify(r)}`);return JSON.parse(r.content[0].text);};
    const listing=await client.listTools();assert.equal(listing.tools.length,20);assert.ok(JSON.stringify(listing).length<16000);
    const caps=await call('get_capabilities');assert.equal(caps.scan_maintenance.available,true);
    assert.equal((await client.callTool({name:'get_site_context',arguments:{}})).isError,true,'Unpaid maintenance grants no general access');
    const review=await call('get_scan_status',{execution_id:fixture.execution_id});
    if(!input) {
      original=review.progress.runtime;assert.equal(review.preview.review.targets.length,50);
      input={execution_id:fixture.execution_id,client_request_id:'stdio-wordpress-close-0001',expected_runtime_hash:review.progress.runtime_hash,
        confirmation:{mode:'chat_attested',review_hash:review.preview.review_hash,confirmed:true,client:{name:'Synthetic native MCP',version:'1.0.0'},
          agent:{name:'Synthetic agent'},acknowledgements:caps.scan_maintenance.required_acknowledgements}};
      assert.equal((await client.callTool({name:'close_scan',arguments:{...input,force:true}})).isError,true);
    }
    const result=await call('close_scan',input);
    assert.equal(result.progress.state,'abandoned');assert.equal(result.provider_requested_this_call,false);
    const runtime=result.progress.runtime;assert.equal(runtime.closure.outcome,'unknown');assert.equal(runtime.closure.attestation.human_verified,false);
    assert.equal(runtime.closure.actor.operator_id,fixture.ids.admin);
    assert.deepEqual(runtime.closure.attestation.client,input.confirmation.client);
    assert.deepEqual(runtime.closure.attestation.agent,input.confirmation.agent);
    assert.ok(Number.isInteger(runtime.closure.at));
    assert.deepEqual(runtime.measurements[0],original.measurements[0],'Started attempt retained byte for byte');
    assert.ok(runtime.measurements.slice(1).every(m=>m.state==='cancelled'));
    if(closed)assert.deepEqual(runtime,closed,'Fresh stdio session repeats exact approved request without another mutation');
    closed=runtime;
    assert.deepEqual((await call('get_scan_status',{execution_id:fixture.execution_id})).progress.runtime,closed);
  } finally {await client.close();}
}
console.log('PASS: real stdio MCP, both REST styles, full 50-device review, bounded confirmation, unknown closure and exact replay.');
