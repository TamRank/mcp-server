/** Actual native worker death during inverse execution or before final delivery. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=ownedInstalledRuntime(cwd);
export async function runFieldExecutionClient({origin,fixture:f,inspect,tlsRoot,worker,control,faults}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);assert.ok(worker&&typeof inspect==='function');
  let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
  async function connect(replacement=false){
    const client=new Client({name:replacement?'owned-inverse-recovery':'owned-inverse-worker',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',
        TAMRANK_PAT:f.tokens[replacement?'redirect_replacement':'redirect_execution'].token,TAMRANK_SITE_URL:origin,
        TAMRANK_TOOL_PROFILE:replacement?'specialist':'core',TAMRANK_REST_STYLE:replacement?'query':'pretty',TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const raw=async(name,args)=>{
      for(let attempt=0;attempt<8;attempt++){
        const r=await client.callTool({name,arguments:args});let data;try{data=JSON.parse(r.content[0].text);}catch{return r;}
        if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit','change_execution_rate_limited'].includes(data.code))return {...r,fixtureRefusedRequests:attempt};
        if(data.code==='change_execution_rate_limited'){
          const read=await client.callTool({name:'get_changes',arguments:{change_set_id:args.change_set_id,kind:'execution'}});
          assert.ok(!read.isError);assert.equal(JSON.parse(read.content[0].text).record.state,'planned','Operation-budget refusal did not admit or start this set');
        }
        assert.ok(attempt<7,'Native quota must reopen');console.log('WAIT: exact refused recovery fixture request, normal native budget.');
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
    };
    const call=async(name,args)=>{const r=await raw(name,args);ok(!r.isError,name+': '+JSON.stringify(r));return JSON.parse(r.content[0].text);};
    return {client,raw,call};
  }
  const confirm=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
    confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true,acknowledgements:p.envelope.plan.required_acknowledgements}});
  const create=label=>({operation:'redirect.create',target:{source_url:f.redirect_path+'/'+label},fields:{
    target_url:{mode:'set',value:f.redirect_path+'/destination-'+label},redirect_type:{mode:'set',value:301}}});
  const comparableRows=rows=>rows.map(({id,...row})=>row).sort((a,b)=>a.source_url.localeCompare(b.source_url));
  const active=await connect(),recovery=await connect(true);
  const inverse=async(source,label,ids=null)=>{
    const before=inspect(),p=(await recovery.call('rollback_change_set',{change_set_id:source.envelope.plan.change_set_id,
      client_request_id:'inverse-worker-rollback-'+label,item_ids:ids??source.envelope.plan.items.map(i=>i.item_id)})).record;
    equal(inspect(),before,'Inverse proposal changes no business row');equal(p.envelope.plan.policy_version,'workflow-redirect-rollback-1');return p;
  };
  try{
    const cases=[...['delete_created','restore_deleted'].flatMap(kind=>['before_commit','after_commit','after_all'].map(phase=>['inverse',phase,kind])),['forward','after_all','delete_created']];
    for(const [direction,phase,kind] of cases){
      const label=direction+'-'+phase+'-'+kind,before=inspect(),restore=kind==='restore_deleted';
      const original=before.redirects.find(row=>row.source_url===f.redirect_path+'/redirect-old');
      const last=restore?{operation:'redirect.delete',target:{redirect_id:Number(original.id)},fields:{acknowledge_deletion:{mode:'set',value:true}}}:create(label+'-last');
      const forward=(await active.call('plan_changes',{client_request_id:'inverse-worker-forward-'+label,
        origin:{kind:'user_request',reference:'owned-fixture',summary:'Synthetic rollback and delivery interruption'},items:[
          create(label+'-first'),{operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Synthetic '+label}}},last]})).record;
      equal(inspect(),before,'Fresh forward proposal is passive');
      let target=forward,committed;
      if(direction==='inverse'){
        committed=(await active.call('execute_change_set',confirm(forward))).record;equal(committed.state,'executed');
        target=await inverse(committed,label);equal(target.envelope.plan.items.map(i=>i.operation),[restore?'redirect.restore':'redirect.delete','meta.update','redirect.delete']);
      }
      const id=target.envelope.plan.change_set_id,prior=inspect(),executor=direction==='inverse'?recovery:active;
      worker.arm(id,phase);const executing=executor.raw('execute_change_set',confirm(target));await worker.interrupt();
      const failedReply=await executing;ok(failedReply.isError,'Actual killed worker gives no false success');
      const error=JSON.parse(failedReply.content[0].text);equal(error.automatic_retry,false);
      const killed=inspect(),applied=phase==='before_commit'?0:phase==='after_commit'?1:3;
      equal(killed.audits.length-prior.audits.length,applied,'Exactly the committed inverse/forward audits survive');
      const redirectDelta=applied===0?0:restore?(applied===3?0:1):(direction==='inverse'?-1:1)*(applied===3?2:applied);
      equal(killed.redirects.length-prior.redirects.length,redirectDelta);
      if(phase==='before_commit')equal(killed,prior,'Uncommitted inverse row, reciprocal mark and audit roll back');
      if(direction==='inverse'&&phase==='after_commit')equal(killed.fields,prior.fields,'Unattempted metadata reversal has not run');
      if(direction==='inverse'&&phase==='after_all'){
        equal(killed.fields,before.fields);equal(restore?comparableRows(killed.redirects):killed.redirects,restore?comparableRows(before.redirects):before.redirects,'All inverse writes already applied before recovery');
      }
      if(direction==='forward')control('revoke_redirect_execution');await worker.restart();
      if(direction==='forward'){
        const denied=await active.raw('execute_change_set',confirm(target));ok(denied.isError&&JSON.parse(denied.content[0].text).code==='agent_token_revoked','Original revoked PAT cannot claim completion');
      }
      const running=(await recovery.call('get_changes',{change_set_id:id,kind:'execution'})).record;
      equal(running.state,'running');equal(running.item_results.map(i=>i.state),Array.from({length:3},(_,i)=>i<applied?'applied':'pending'));
      equal(running.registration.budget.operation_count,3,'Original reservation is not refunded');equal(inspect(),killed,'Readback never resumes reversal or repeats writes');
      if(restore&&applied>0){
        const row=killed.redirects.find(row=>row.source_url===original.source_url);
        ok(Number(row.id)!==Number(original.id),'Committed restore has a genuinely fresh database ID');
        equal({...row,id:original.id},original,'Restore preserves every original attribute except ID');
        equal(running.item_results[0].redirect_result.redirect_id,Number(row.id),'Recovery uses the actual new ID, not the deleted original ID');
      }
      if(direction==='inverse'){
        const source=(await recovery.call('get_changes',{change_set_id:forward.envelope.plan.change_set_id,kind:'execution'})).record;
        equal(source.item_results.map(i=>!!i.reversal),[applied===3,applied===3,applied>0],'Only committed inverse items mark original items as reversed');
        equal(inspect(),killed,'Reciprocal read is passive');
      }
      const rp=(await recovery.call('get_changes',{change_set_id:id,kind:'recovery'})).recovery_proposal;
      equal(rp.plan.source_policy,direction==='inverse'?'workflow-redirect-rollback-1':'workflow-redirect-execution-1');
      equal(rp.plan.recovery_mode,applied===3?'delivery_only':'stop_pending');equal(rp.plan.website_writes,0);
      equal(rp.plan.items.map(i=>i.disposition),Array.from({length:3},(_,i)=>i<applied?'retain_applied':'skip_pending'));
      equal(rp.plan.original_token_id,f.tokens[direction==='inverse'?'redirect_replacement':'redirect_execution'].id);
      equal(rp.plan.binding.token_id,f.tokens.redirect_replacement.id);equal(inspect(),killed);
      const args={change_set_id:id,change_token:rp.recovery_token,recovery_plan:rp.plan,
        confirmation:{plan_hash:rp.plan_hash,confirmed:true,acknowledgements:rp.plan.required_acknowledgements}};
      ok((await recovery.raw('execute_change_set',{...args,confirmation:{...args.confirmation,confirmed:false}})).isError,'Every recovery requires a new chat approval');
      faults.arm(id,'recover');
      const lost=await recovery.raw('execute_change_set',args),lostData=JSON.parse(lost.content[0].text);
      ok(lost.isError&&lostData.code==='network_error'&&lostData.automatic_retry===false,'Committed recovery reply loss remains uncertain to MCP');
      equal(faults.attempts(),1+lost.fixtureRefusedRequests,'Only explicitly test-paced 429 refusals precede one committed request; no retry after uncertainty');
      const done=(await recovery.call('get_changes',{change_set_id:id,kind:'execution'})).record;
      equal(done.state,applied===3?'executed':applied===1?'partial':'failed');
      equal(done.item_results.map(i=>i.state),Array.from({length:3},(_,i)=>i<applied?'applied':'skipped'));
      equal(done.item_results.map(i=>i.attempts),Array.from({length:3},(_,i)=>i<applied?1:0));
      equal(done.registration.recovery.recovery_mode,rp.plan.recovery_mode);equal(done.registration.recovery.plan_hash,rp.plan_hash);
      equal(done.registration.recovery.attestation.human_verified,false);equal(done.registration.recovery.attestation.client,{name:'owned-inverse-recovery',version:'1'});
      equal(done.registration.budget,running.registration.budget,'Recovery keeps the original operation reservation');
      for(let n=0;n<applied;n++)equal(done.item_results[n].delivery.status,'delivered','Native derived-data delivery completes');
      equal(inspect(),killed,'Approved recovery never adds business writes or audits');
      equal((await recovery.call('execute_change_set',args)).record,done,'Exact recovery replay is stable');
      equal((await recovery.call('get_changes',{change_set_id:id,kind:'execution'})).record,done);equal(inspect(),killed);
      if(direction==='forward'||applied<3){
        const source=(await recovery.call('get_changes',{change_set_id:forward.envelope.plan.change_set_id,kind:'execution'})).record;
        const remaining=source.item_results.map((i,n)=>!i.reversal?source.envelope.plan.items[n].item_id:null).filter(Boolean);
        equal(remaining.length,direction==='forward'?3:3-applied,'Only genuinely unreversed original items enter a new proposal');
        const fresh=await inverse(source,label+'-remaining',remaining);
        const restored=(await recovery.call('execute_change_set',confirm(fresh))).record;equal(restored.state,'executed');
        const restoredRows=inspect();equal(restoredRows.fields,before.fields);
        equal(restore?comparableRows(restoredRows.redirects):restoredRows.redirects,restore?comparableRows(before.redirects):before.redirects,'Freshly approved remaining rollback restores original business rows');
      }
      console.log('PASS: real native '+direction+'/'+kind+' worker '+phase+' → exact '+rp.plan.recovery_mode+' → no repeated website writes.');
    }
  }finally{await active.client.close();await recovery.client.close();}
  return checks;
}
