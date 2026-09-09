/** Called only with an owned synthetic WordPress fixture by the PRO test runner. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runFieldProposalClient({origin,fixture:f}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:\d{4,5}(?:\/client-two)?$/);
  let checks=0;
  for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
    const client=new Client({name:'synthetic-field-review',version:'1.0.0'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd,stderr:'pipe',
        env:{PATH:process.env.PATH,TAMRANK_PAT:f.tokens.owner.token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
      const listing=await client.listTools();assert.equal(listing.tools.length,profile==='core'?12:20);checks++;
      assert.ok(JSON.stringify(listing).length<16000);checks++;
      const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));checks++;return JSON.parse(r.content[0].text);};
      const caps=await call('get_capabilities',{});assert.equal(caps.field_proposals.available,true);checks++;
      const request={client_request_id:`mcp-field-${profile}-${style}`,origin:{kind:'user_request',reference:'owned-test',summary:'Synthetic draft; no page edits'},items:[
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Café – voorstel'},meta_description:{mode:'remove'}}},
        {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:''}}}]};
      const draft=await call('plan_changes',request);assert.equal(draft.envelope.plan.items.length,2);checks++;
      assert.equal(draft.execution_available,false);assert.equal(draft.approval_recorded,false);checks+=2;
      assert.deepEqual(await call('plan_changes',request),draft);checks++;
      const id=draft.envelope.plan.change_set_id;
      assert.deepEqual(await call('get_changes',{change_set_id:id}),draft);checks++;
      assert.equal((await client.callTool({name:'execute_change_set',arguments:{}})).isError,true);checks++;
      assert.equal((await client.callTool({name:'plan_changes',arguments:{...request,execute:true}})).isError,true);checks++;
      if(profile==='core'&&style==='pretty'){
        const bulk={...request,client_request_id:'mcp-field-25-unicode',items:f.posts.bulk.map(post_id=>({operation:'meta.update',target:{post_id},fields:{meta_description:{mode:'set',value:'é'.repeat(2100)}}}))};
        const large=await call('plan_changes',bulk);assert.equal(large.envelope.plan.items.length,25);checks++;
        for(const item of large.envelope.plan.items){assert.equal(item.after.meta_description.value,bulk.items[0].fields.meta_description.value);checks++;}
        assert.deepEqual(await call('get_changes',{change_set_id:large.envelope.plan.change_set_id}),large);checks++;
      }
      console.log(`PASS: ${profile}/${style} real SDK → WordPress private field draft/read; ${JSON.stringify(listing).length} chars.`);
    }finally{await client.close();}
  }
  return checks;
}
