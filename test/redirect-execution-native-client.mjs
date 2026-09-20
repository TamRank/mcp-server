/** Actual stdio MCP -> owned TLS -> native WordPress. No injected REST results. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=ownedInstalledRuntime(cwd);
export async function runFieldExecutionClient({origin,fixture:f,inspect,tlsRoot,faults,worker,control,otherFixture}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
  assert.ok(worker&&faults&&typeof inspect==='function');let checks=0;
  const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
  async function connect(profile='core',style='pretty',token=f.tokens.redirect_execution.token,trusted=true,name='owned-native-redirect-client'){
    const client=new Client({name,version:'1.0.0'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,...(trusted?{NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem'}:{}),
        TAMRANK_PAT:token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const raw=async(name,args)=>{
      // Fixture pacing only after a confirmed native pre-execution 429 refusal.
      // The production client never retries an uncertain write automatically.
      for(let attempt=0;attempt<8;attempt++){
        const r=await client.callTool({name,arguments:args});let data;
        try{data=JSON.parse(r.content[0].text);}catch{return r;}
        if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit','change_execution_rate_limited'].includes(data.code))return r;
        assert.ok(attempt<7,'Native window must reopen');console.log('WAIT: exact refused redirect fixture request; native budget unchanged.');
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
    };
    const call=async(name,args)=>{const r=await raw(name,args);ok(!r.isError,name+': '+JSON.stringify(r));return JSON.parse(r.content[0].text);};
    return {client,raw,call};
  }
  const create=(source,target,status=301)=>({operation:'redirect.create',target:{source_url:f.redirect_path+source},fields:{
    target_url:{mode:'set',value:target?f.redirect_path+target:''},redirect_type:{mode:'set',value:status}}});
  const deletion=id=>({operation:'redirect.delete',target:{redirect_id:Number(id)},fields:{acknowledge_deletion:{mode:'set',value:true}}});
  const request=(label,items)=>({client_request_id:'native-redirect-'+label,origin:{kind:'user_request',reference:'owned-fixture',summary:'Fictitious exact changes for native acceptance'},items});
  const confirmation=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
    confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true,acknowledgements:p.envelope.plan.required_acknowledgements}});
  const rowAt=(snapshot,source)=>snapshot.redirects.find(r=>r.source_url===f.redirect_path+source);
  async function reverse(call,source,label,itemIds=null){
    const before=inspect(),id=source.envelope.plan.change_set_id;
    const p=(await call('rollback_change_set',{change_set_id:id,client_request_id:'native-redirect-rollback-'+label,
      item_ids:itemIds??source.envelope.plan.items.map(i=>i.item_id)})).record;
    equal(p.envelope.plan.policy_version,'workflow-redirect-rollback-1');equal(inspect(),before,'Rollback preview changes no business rows');
    const done=(await call('execute_change_set',confirmation(p))).record;equal(done.state,'executed');
    const restored=inspect();equal((await call('execute_change_set',confirmation(p))).record,done,'Stable inverse replay');
    equal(inspect(),restored,'Inverse replay adds no writes or audit rows');return done;
  }
  const untrusted=await connect('core','pretty',f.tokens.redirect_execution.token,false);
  try{const before=inspect();ok((await untrusted.raw('get_capabilities',{})).isError,'Untrusted TLS certificate refused');equal(inspect(),before);}finally{await untrusted.client.close();}
  for(const profile of ['core','specialist'])for(const style of ['pretty','query']){
    const {client,raw,call}=await connect(profile,style),label=profile+'-'+style;
    try{
      const catalog=await client.listTools();equal(catalog.tools.length,profile==='core'?12:20);ok(JSON.stringify(catalog).length<16000,'Bounded real native catalog');
      const caps=await call('get_capabilities',{});
      ok(caps.redirect_execution.available&&caps.redirect_execution.mixed_available&&caps.redirect_execution.rollback_available&&caps.redirect_execution.recovery_available,'Actual native redirect capabilities');
      const before=inspect(),original=rowAt(before,'/redirect-old');ok(original,'Owned existing row');
      const input=request(label,[deletion(original.id),create('/redirect-old','/redirect-after',302),
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Café – exact mixed redirect'}}}]);
      if(f.beta_external_probe&&profile==='core'&&style==='pretty'){
        control('add_unsupported_probe');
        try{
          const blocked=inspect();const refused=await raw('plan_changes',request('outside-probe',input.items));
          ok(refused.isError&&JSON.parse(refused.content[0].text).code==='redirect_proposal_routing_unsupported','An active rule outside the upgraded subsite is refused, never ignored');
          equal(inspect(),blocked,'Unsupported routing creates no business writes or audit rows');
        }finally{control('remove_unsupported_probe');}
        equal(inspect(),before,'Only the newly inserted test probe was removed');
      }
      const p=(await call('plan_changes',input)).record,id=p.envelope.plan.change_set_id,args=confirmation(p);
      equal(p.envelope.plan.policy_version,'workflow-redirect-execution-1');equal(p.approval_recorded,false);equal(p.state,'planned');
      equal(p.envelope.plan.required_acknowledgements,['redirect_deletion']);equal(inspect(),before,'Proposal is passive for fields/redirects/audits');
      equal((await call('plan_changes',input)).record,p,'Same native stored proposal on exact retry');
      for(const bad of [{...args,confirmation:{...args.confirmation,acknowledgements:[]}},
        {...args,confirmation:{...args.confirmation,confirmed:false}},{...args,confirmation:{...args.confirmation,plan_hash:'0'.repeat(64)}},
        {...args,change_token:'trce1.'+p.envelope.change_token.slice(6)}])ok((await raw('execute_change_set',bad)).isError,'Incorrect native approval refused');
      equal(inspect(),before,'Rejected consent changes no rows');
      let done;
      if(profile==='core'&&style==='pretty'){
        const outsider=await connect('core','query',f.tokens.other.token);
        try{ok((await outsider.raw('get_changes',{kind:'execution',change_set_id:id})).isError,'Other WP owner cannot read the set');}
        finally{await outsider.client.close();}
        if(f.blog_id!==otherFixture.blog_id){
          const wrongSite=await connect('core','query',otherFixture.tokens.redirect_execution.token);
          try{ok((await wrongSite.raw('get_changes',{kind:'execution',change_set_id:id})).isError,'Another client site PAT cannot read this set');}
          finally{await wrongSite.client.close();}
        }
        equal(inspect(),before,'Cross-owner/client refusals are passive');faults.arm(id);
        const lost=await raw('execute_change_set',args),data=JSON.parse(lost.content[0].text);
        ok(lost.isError&&data.code==='network_error'&&data.automatic_retry===false,'Actual committed response loss stays uncertain');
        equal(faults.attempts(),1,'One actual execution request, no automatic retry');
        equal(inspect().audits.length-before.audits.length,3,'Native full batch committed despite reply loss');
        done=(await call('get_changes',{change_set_id:id,kind:'execution'})).record;
      }else done=(await call('execute_change_set',args)).record;
      equal(done.state,'executed');equal(done.registration.attestation.human_verified,false);
      equal(done.registration.attestation.client,{name:'owned-native-redirect-client',version:'1.0.0'});equal(done.registration.attestation.agent,{name:'unknown'});
      equal(done.registration.budget.operation_count,3);equal(done.item_results.map(i=>i.state),['applied','applied','applied']);
      equal(done.envelope.plan.frontend_verification,'not_performed');
      const after=inspect(),created=rowAt(after,'/redirect-old');
      ok(Number(created.id)!==Number(original.id),'Delete/create records actual newly assigned row ID');
      equal(created.target_url,f.redirect_path+'/redirect-after');equal(created.redirect_type,'302');
      equal(after.fields.publish._tam_rank_meta_title,['Café – exact mixed redirect']);equal(after.audits.length-before.audits.length,3);
      equal(done.item_results[1].redirect_result.redirect_id,Number(created.id),'Response ID matches real database');
      equal((await call('execute_change_set',args)).record,done,'Stable exact forward replay');equal(inspect(),after,'Forward replay changes nothing');
      const undone=await reverse(call,done,label),restored=inspect(),restoredRow=rowAt(restored,'/redirect-old');
      equal(undone.envelope.plan.items.map(i=>i.operation),['meta.update','redirect.delete','redirect.restore'],'Reverse original order with private restore');
      equal(restored.fields,before.fields,'Exact original field absence restored');
      equal({...restoredRow,id:original.id},original,'All original native row attributes restored, except new auto ID');
      ok(Number(restoredRow.id)!==Number(original.id),'Restoring deleted redirect never reuses an old ID');
      equal(restored.audits.length-before.audits.length,6,'One audit per forward and inverse item');
      const linked=(await call('get_changes',{change_set_id:id,kind:'execution'})).record;
      equal(linked.item_results.map(i=>i.reversal.change_set_id),[undone.envelope.plan.change_set_id,undone.envelope.plan.change_set_id,undone.envelope.plan.change_set_id]);
      console.log(`PASS: native ${profile}/${style} mixed redirect delete/create + metadata → approved exact reverse.`);
    }finally{await client.close();}
  }
  // A pure redirect update and inverse must not depend on meta:write.
  const pure=await connect('core','query',f.tokens.redirect_only.token);
  try{
    const caps=await pure.call('get_capabilities',{});ok(caps.redirect_execution.available&&!caps.redirect_execution.mixed_available);
    equal(caps.status,'preview_redirect_execution');equal(caps.full_v2_compatible,false);
    for(const name of ['plan_changes','execute_change_set','get_changes','rollback_change_set'])ok(!caps.pending_core_tools.includes(name),'Redirect-only tools are not falsely advertised as pending');
    const before=inspect(),row=rowAt(before,'/redirect-old');
    const p=(await pure.call('plan_changes',request('redirect-only',[{operation:'redirect.update',target:{redirect_id:Number(row.id)},fields:{
      source_url:{mode:'set',value:row.source_url},target_url:{mode:'set',value:f.redirect_path+'/redirect-only'},redirect_type:{mode:'set',value:307}}}]))).record;
    equal(p.envelope.plan.required_scopes,['site:read','changes:write','redirects:write']);
    const done=(await pure.call('execute_change_set',confirmation(p))).record;equal(done.state,'executed');
    equal(rowAt(inspect(),'/redirect-old').target_url,f.redirect_path+'/redirect-only');equal(inspect().fields,before.fields);
    await reverse(pure.call,done,'pure');equal(inspect().redirects,before.redirects,'Update rollback restores exact ID and all attributes');
    console.log('PASS: native redirect-only update and inverse, no metadata grant.');
  }finally{await pure.client.close();}
  // Kill the owned PHP worker on each side of a real item COMMIT. Do not fake
  // a receipt or call private PHP admission/item helpers to set up recovery.
  for(const phase of ['before_commit','after_commit']){
    const active=await connect('core','pretty');
    try{
      const before=inspect();
      const p=(await active.call('plan_changes',request('worker-'+phase,[create('/worker-'+phase,'/worker-destination'),
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Never execute during recovery'}}},
        create('/never-'+phase,'/never-destination')]))).record,id=p.envelope.plan.change_set_id;
      equal(inspect(),before);worker.arm(id,phase);const running=active.raw('execute_change_set',confirmation(p));
      await worker.interrupt();const interrupted=await running;ok(interrupted.isError,'Killed native worker is not reported successful');
      const killed=inspect();equal(killed.audits.length-before.audits.length,phase==='after_commit'?1:0);
      equal(killed.fields,before.fields);equal(killed.redirects.length-before.redirects.length,phase==='after_commit'?1:0);
      if(phase==='after_commit')control('revoke_redirect_execution');await worker.restart();
      if(phase==='after_commit'){
        const refused=await active.raw('execute_change_set',confirmation(p));ok(refused.isError&&JSON.parse(refused.content[0].text).code==='agent_token_revoked','Revoked original PAT cannot resume');
        equal(inspect(),killed);
      }
      const recovery=await connect('core','query',f.tokens.redirect_replacement.token,true,'owned-redirect-recovery-client');
      try{
        const runningRecord=(await recovery.call('get_changes',{change_set_id:id,kind:'execution'})).record;
        equal(runningRecord.state,'running');equal(runningRecord.item_results.map(i=>i.state),phase==='after_commit'?['applied','pending','pending']:['pending','pending','pending']);
        equal(inspect(),killed,'Reading interrupted state never resumes pending work');
        const rp=(await recovery.call('get_changes',{change_set_id:id,kind:'recovery'})).recovery_proposal;
        equal(rp.plan.recovery_mode,'stop_pending');equal(rp.plan.website_writes,0);equal(rp.plan.binding.token_id,f.tokens.redirect_replacement.id);
        equal(rp.plan.original_token_id,f.tokens.redirect_execution.id);equal(inspect(),killed,'Recovery proposal changes no business data');
        const args={change_set_id:id,change_token:rp.recovery_token,recovery_plan:rp.plan,
          confirmation:{plan_hash:rp.plan_hash,confirmed:true,acknowledgements:rp.plan.required_acknowledgements}};
        ok((await recovery.raw('execute_change_set',{...args,confirmation:{...args.confirmation,confirmed:false}})).isError,'Recovery needs new chat approval');
        const stopped=(await recovery.call('execute_change_set',args)).record;
        equal(stopped.state,phase==='after_commit'?'partial':'failed');equal(stopped.item_results.map(i=>i.state),phase==='after_commit'?['applied','skipped','skipped']:['skipped','skipped','skipped']);
        equal(stopped.registration.recovery.attestation.human_verified,false);
        equal(stopped.registration.recovery.attestation.client,{name:'owned-redirect-recovery-client',version:'1.0.0'});
        equal(stopped.registration.recovery.plan_hash,rp.plan_hash);equal(inspect(),killed,'Recovery never repeats or reverses business writes');
        equal((await recovery.call('execute_change_set',args)).record,stopped,'Stable approved recovery replay');equal(inspect(),killed);
        if(phase==='after_commit'){
          equal(stopped.item_results[0].delivery.status,'delivered','Retained applied redirect completes native cache/Action delivery');
          await reverse(recovery.call,stopped,'worker-subset',[p.envelope.plan.items[0].item_id]);
          equal(inspect().redirects,before.redirects,'Only an additional approved rollback removes the committed redirect');equal(inspect().fields,before.fields);
        }
        console.log(`PASS: native redirect SIGKILL ${phase} → new MCP chat-approved recovery → no deferred writes.`);
      }finally{await recovery.client.close();}
    }finally{await active.client.close();}
  }
  return checks;
}
