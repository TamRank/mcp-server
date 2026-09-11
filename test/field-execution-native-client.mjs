/** Real stdio MCP -> loopback HTTP -> native WP executor; owned PRO runner only. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runFieldExecutionClient({origin,fixture:f,inspect}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:\d{4,5}(?:\/client-two)?$/);
  assert.equal(typeof inspect,'function');let checks=0;
  const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const ok=(v,label)=>{assert.ok(v,label);checks++;};
  for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
    const client=new Client({name:'owned-native-field-client',version:'1.2.3'});
    const label=`native-execute-${profile}-${style}`;
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:['index-workflow.js'],cwd,stderr:'pipe',
        env:{PATH:process.env.PATH,TAMRANK_PAT:f.tokens.execution.token,TAMRANK_SITE_URL:origin,
          TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
      const raw=async(name,args)=>{
        // Test scheduling only: native 429 is a refusal before execution. Keep
        // the exact request, wait for the real window, never raise product limits.
        for(let attempt=0;attempt<8;attempt++){
          const r=await client.callTool({name,arguments:args});let data;
          try{data=JSON.parse(r.content[0].text);}catch{return r;}
          if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit'].includes(data.code))return r;
          assert.ok(attempt<7,'Native rate window must reopen');
          console.log('WAIT: native request budget; exact refused test request retained.');
          await new Promise(resolve=>setTimeout(resolve,10000));
        }
      };
      const call=async(name,args)=>{const r=await raw(name,args);ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
      const listing=await client.listTools();equal(listing.tools.length,profile==='core'?12:20,'Stable tool count');
      ok(JSON.stringify(listing).length<16000,'Catalog remains bounded');
      const caps=await call('get_capabilities',{});
      ok(caps.field_execution.available&&caps.field_execution.read_available&&caps.field_execution.rollback_available,'Native readiness/scopes advertised');
      const before=inspect();
      const request={client_request_id:label,origin:{kind:'user_request',reference:'owned-fixture',summary:'Fictitious fields approved only in this test'},items:[
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Café – native MCP'},meta_description:{mode:'remove'}}},
        {operation:'social.update',target:{post_id:f.posts.bulk[0]},fields:{social_title:{mode:'set',value:'Synthetic social title'}}},
        {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:'Synthetic image description'}}}]};
      const proposal=(await call('plan_changes',request)).record;
      equal(proposal.state,'planned');equal(proposal.approval_recorded,false);
      equal(inspect(),before,'Proposal changes no website fields/audits');
      const id=proposal.envelope.plan.change_set_id;
      equal((await call('plan_changes',request)).record,proposal,'Same native proposal on exact retry');
      const confirmation=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
        confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true}});
      const args=confirmation(proposal);
      ok((await raw('execute_change_set',{...args,confirmation:{...args.confirmation,confirmed:false}})).isError,'Unapproved call refused');
      ok((await raw('execute_change_set',{...args,confirmation:{...args.confirmation,plan_hash:'0'.repeat(64)}})).isError,'Wrong native hash refused');
      equal(inspect(),before,'Invalid approvals leave fields/audits unchanged');
      const done=(await call('execute_change_set',args)).record;
      equal(done.state,'executed',JSON.stringify(done.item_results?.map(r=>({state:r.state,invalidation:r.invalidation,delivery:r.delivery}))));equal(done.registration.attestation.human_verified,false);
      equal(done.registration.attestation.client,{name:'owned-native-field-client',version:'1.2.3'},'Actual handshake persisted');
      equal(done.registration.attestation.agent,{name:'unknown'});
      const applied=inspect();
      equal(applied.fields.publish._tam_rank_meta_title,['Café – native MCP']);
      equal(applied.fields.publish._tam_rank_meta_description,undefined);
      equal(applied.fields.social._tam_rank_social_title,['Synthetic social title']);
      equal(applied.fields.image._wp_attachment_image_alt,['Synthetic image description']);
      equal(applied.audits.length-before.audits.length,3,'One real audit per executed item');
      for(const result of done.item_results){equal(result.attempts,1);equal(result.delivery.result.contract_version,3);}
      equal((await call('execute_change_set',args)).record,done,'Exact executor replay');
      equal(inspect(),applied,'Retry never reapplies fields or duplicates audits');
      equal((await call('get_changes',{change_set_id:id,kind:'execution'})).record,done,'Native read-only recovery');
      const reverse=(await call('rollback_change_set',{change_set_id:id,client_request_id:label+'-rollback',
        item_ids:proposal.envelope.plan.items.map(i=>i.item_id)})).record;
      ok(reverse.envelope.plan.change_set_id!==id,'Rollback is a distinct proposal');
      equal(reverse.envelope.plan.policy_version,'workflow-field-rollback-1');
      equal(inspect(),applied,'Rollback preview does not reverse fields');
      const reversed=(await call('execute_change_set',confirmation(reverse))).record;
      equal(reversed.state,'executed');
      const restored=inspect();equal(restored.fields,before.fields,'Exact native values/absence restored');
      equal(restored.audits.length-before.audits.length,6,'Separate reversal audit per item');
      equal((await call('execute_change_set',confirmation(reverse))).record,reversed,'Rollback replay retains original result');
      equal(inspect(),restored,'Rollback replay has no duplicate mutations');
      equal((await call('get_changes',{change_set_id:id,kind:'execution'})).record.registration,done.registration,'Original approval preserved');
      console.log(`PASS: owned native ${profile}/${style} proposal → exact execution → readback → approved rollback.`);
    }finally{await client.close();}
  }
  return checks;
}
