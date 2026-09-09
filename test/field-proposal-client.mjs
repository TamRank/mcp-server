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
      const raw=async(name,args)=>{
        // Exercise the real limits. A longer suite must wait, not raise quotas or
        // count a 429 as evidence that an intentionally invalid request was rejected.
        for(let attempt=0;attempt<8;attempt++){
          const r=await client.callTool({name,arguments:args});
          let data;try{data=JSON.parse(r.content[0].text);}catch{return r;}
          if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit'].includes(data.code))return r;
          assert.ok(attempt<7,'Ordinary native request window did not reopen');
          console.log('WAIT: ordinary native request window; exact same test request retained.');
          await new Promise(resolve=>setTimeout(resolve,10000));
        }
      };
      const call=async(name,args)=>{const r=await raw(name,args);assert.ok(!r.isError,JSON.stringify(r));checks++;return JSON.parse(r.content[0].text);};
      const caps=await call('get_capabilities',{});assert.equal(caps.field_proposals.available,true);checks++;
      // Same logical requests across profiles verify replay interoperability and
      // retain the real per-owner active-draft limit; no test quota override.
      const request={client_request_id:`mcp-field-${style}`,origin:{kind:'user_request',reference:'owned-test',summary:'Synthetic draft; no page edits'},items:[
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Café – voorstel'},meta_description:{mode:'remove'}}},
        {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:''}}}]};
      const draft=await call('plan_changes',request);assert.equal(draft.envelope.plan.items.length,2);checks++;
      assert.equal(draft.execution_available,false);assert.equal(draft.approval_recorded,false);checks+=2;
      assert.deepEqual(await call('plan_changes',request),draft);checks++;
      const id=draft.envelope.plan.change_set_id;
      assert.deepEqual(await call('get_changes',{change_set_id:id}),draft);checks++;
      assert.ok(caps.field_proposals.origin_kinds.includes('action'));checks++;
      assert.equal(caps.field_proposals.url_origin_mapping_available,true);checks++;
      const targets=await call('get_work_queue',{work_id:'grp_missing_titles',section:'targets',limit:50});
      const sourceTarget=targets.items.find(t=>t.post_id===f.posts.publish);
      assert.ok(sourceTarget);assert.deepEqual(sourceTarget.action_origin,f.action_origin);checks+=2;
      const linked={...request,client_request_id:`mcp-origin-${style}`,origin:sourceTarget.action_origin,items:[request.items[0]]};
      const actionDraft=await call('plan_changes',linked);
      assert.equal(actionDraft.envelope.plan.origin_evidence.action_id,f.action_origin.action_id);checks++;
      assert.equal(actionDraft.envelope.plan.origin_evidence.selected_targets.length,1);checks++;
      assert.deepEqual(await call('get_changes',{change_set_id:actionDraft.envelope.plan.change_set_id}),actionDraft);checks++;
      const stale={...linked,client_request_id:`mcp-stale-${profile}-${style}`,origin:{...f.action_origin,revision:f.action_origin.revision+1}};
      assert.equal((await raw('plan_changes',stale)).isError,true);checks++;
      const foreign={...linked,client_request_id:`mcp-foreign-${profile}-${style}`,items:[request.items[1]]};
      assert.equal((await raw('plan_changes',foreign)).isError,true);checks++;
      let cursor;const research=[];
      do{const page=await call('get_work_queue',{work_id:f.research_work_id,section:'targets',limit:1,...(cursor?{cursor}:{})});research.push(...page.items);cursor=page.next_cursor;}while(cursor);
      assert.equal(research.length,2);checks++;
      const mapped=research.find(t=>t.post_id===f.posts.publish),unmapped=research.find(t=>t.url_mapping==='unmapped');
      assert.ok(mapped,JSON.stringify(research));
      assert.equal(mapped.url_mapping,'exact_wordpress_roundtrip');assert.equal(mapped.url,f.research_url);checks+=2;
      assert.equal(unmapped.post_id,null);checks++;
      const fromResearch={...linked,client_request_id:`mcp-research-${style}`,origin:mapped.action_origin};
      const researchDraft=await call('plan_changes',fromResearch);
      assert.deepEqual(Object.values(researchDraft.envelope.plan.origin_evidence.url_mappings),[{post_id:f.posts.publish,url:f.research_url}]);checks++;
      assert.deepEqual(await call('get_changes',{change_set_id:researchDraft.envelope.plan.change_set_id}),researchDraft);checks++;
      assert.ok(caps.field_proposals.operations.includes('social.update'));checks++;
      const social={...fromResearch,client_request_id:`mcp-social-${style}`,items:[{operation:'social.update',target:{post_id:f.posts.publish},fields:{
        social_title:{mode:'set',value:'Delen – café'},social_description:{mode:'remove'},social_image:{mode:'set',value:f.social_image_url}}}]};
      const socialDraft=await call('plan_changes',social);
      assert.equal(socialDraft.envelope.plan.items[0].after.social_image.value,f.social_image_url);checks++;
      assert.deepEqual(Object.values(socialDraft.envelope.plan.origin_evidence.url_mappings),[{post_id:f.posts.publish,url:f.research_url}]);checks++;
      assert.deepEqual(await call('get_changes',{change_set_id:socialDraft.envelope.plan.change_set_id}),socialDraft);checks++;
      const unowned=structuredClone(social);unowned.client_request_id=`mcp-social-invalid-${style}`;
      unowned.items[0].fields.social_image.value='https://example.invalid/not-in-library.png';
      assert.equal((await raw('plan_changes',unowned)).isError,true);checks++;
      assert.equal((await raw('execute_change_set',{})).isError,true);checks++;
      assert.equal((await raw('plan_changes',{...request,execute:true})).isError,true);checks++;
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
