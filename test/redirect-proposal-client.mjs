/** Real SDK -> disposable WordPress only. No public/customer site or execution. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runRedirectProposalClient({origin,fixture:f}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:\d{4,5}(?:\/client-two)?$/);
  let checks=0;
  for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
    const client=new Client({name:'synthetic-redirect-review',version:'1.0.0'});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd,stderr:'pipe',env:{
        PATH:process.env.PATH,TAMRANK_PAT:f.tokens.redirect.token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
      const tools=await client.listTools();assert.equal(tools.tools.length,profile==='core'?12:20);checks++;
      assert.ok(JSON.stringify(tools).length<16000);checks++;
      const raw=async(name,args)=>{
        for(let attempt=0;attempt<8;attempt++){
          const r=await client.callTool({name,arguments:args});const data=JSON.parse(r.content[0].text);
          if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit'].includes(data.code))return {r,data};
          assert.ok(attempt<7,'Native rate window did not reopen');
          const wait=Math.min(60000,Math.max(1000,((data.retry_after??data.data?.retry_after??60)+1)*1000));
          console.log(`WAIT: redirect SDK fixture respects native rate limit (${wait}ms).`);
          await new Promise(resolve=>setTimeout(resolve,wait));
        }
      };
      const call=async(name,args)=>{const {r,data}=await raw(name,args);assert.ok(!r.isError,`${name}: ${JSON.stringify(data)}`);checks++;return data;};
      const caps=await call('get_capabilities',{});
      for(const operation of ['redirect.create','redirect.update','redirect.delete']){assert.ok(caps.field_proposals.operations.includes(operation));checks++;}
      assert.equal(caps.field_proposals.execution_enabled,false);checks++;
      const create=(source,target,status=301)=>({operation:'redirect.create',target:{source_url:f.redirect_path+source},fields:{
        target_url:{mode:'set',value:target===''?'':f.redirect_path+target},redirect_type:{mode:'set',value:status}}});
      const deletion={operation:'redirect.delete',target:{redirect_id:f.redirect_id},fields:{acknowledge_deletion:{mode:'set',value:true}}};
      const request={client_request_id:`sdk-redirect-linked-${style}`,origin:f.redirect_origin,items:[deletion,create('/redirect-old','/redirect-after',307)]};
      const draft=await call('plan_changes',request);
      assert.deepEqual(draft.envelope.plan.items.map(i=>i.operation),['redirect.delete','redirect.create']);checks++;
      assert.equal(draft.envelope.plan.items[1].after.id,null);checks++;
      assert.equal(draft.envelope.plan.items[1].after.redirect_type,307);checks++;
      assert.equal(draft.envelope.plan.origin_evidence.redirect_mappings[0].redirect_id,f.redirect_id);checks++;
      assert.equal(draft.envelope.plan.origin_evidence.redirect_mappings[1].source_url,f.redirect_path+'/redirect-old');checks++;
      assert.equal(draft.approval_recorded,false);assert.equal(draft.execution_available,false);checks+=2;
      assert.deepEqual(await call('get_changes',{change_set_id:draft.envelope.plan.change_set_id}),draft);checks++;
      assert.deepEqual(await call('plan_changes',request),draft);checks++;
      const stale=structuredClone(request);stale.client_request_id=`sdk-redirect-stale-${style}`;stale.origin.revision++;
      assert.equal((await raw('plan_changes',stale)).r.isError,true);checks++;
      const mixed={client_request_id:`sdk-redirect-mixed-${style}`,origin:{kind:'user_request',reference:'synthetic','summary':'Preview agreed changes; no execution'},items:[
        {operation:'redirect.update',target:{redirect_id:f.redirect_id},fields:{source_url:{mode:'set',value:f.redirect_path+'/redirect-old'},
          target_url:{mode:'set',value:f.redirect_path+'/updated'},redirect_type:{mode:'set',value:302}}},
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Synthetic mixed title'}}},create('/gone','',410)]};
      const mixedDraft=await call('plan_changes',mixed);
      assert.deepEqual(mixedDraft.envelope.plan.items.map(i=>i.operation),['redirect.update','meta.update','redirect.create']);checks++;
      assert.deepEqual(mixedDraft.envelope.plan.required_scopes,['site:read','changes:write','meta:write','redirects:write']);checks++;
      assert.deepEqual(await call('get_changes',{change_set_id:mixedDraft.envelope.plan.change_set_id}),mixedDraft);checks++;
      const loop={...mixed,client_request_id:`sdk-redirect-loop-${style}`,items:[create('/loop','/loop?x=1')]};
      const refused=await raw('plan_changes',loop);assert.equal(refused.r.isError,true);assert.equal(refused.data.code,'redirect_proposal_routing_ambiguous_cycle');checks+=2;
      assert.equal((await raw('execute_change_set',{})).r.isError,true);checks++;
      assert.equal((await raw('rollback_change_set',{})).r.isError,true);checks++;
      console.log(`PASS: ${profile}/${style} SDK -> WordPress redirects, exact Action links, mixed fields, history and refusals; ${JSON.stringify(tools).length} chars.`);
    }finally{await client.close();}
  }
  return checks;
}
