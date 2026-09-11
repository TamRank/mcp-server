/** Real owned PHP process death before/after an item commit; no mocked stop response. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runFieldExecutionClient({origin,fixture:f,tlsRoot,inspect,worker,control,recovery,recoveryRetention}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
  let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};const ok=(v,label)=>{assert.ok(v,label);checks++;};
  const client=new Client({name:'Owned interrupted client',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(cwd,'index-workflow.js')],cwd,stderr:'pipe',
      env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_PAT:f.tokens.execution.token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:'query',TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const raw=(name,args)=>client.callTool({name,arguments:args});
    const call=async(name,args)=>{const r=await raw(name,args);ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
    const confirmation=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
      confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true}});
    const before=inspect();
    const proposal=(await call('plan_changes',{client_request_id:'native-worker-interruption-plan',
      origin:{kind:'user_request',reference:'owned-fixture',summary:'Synthetic worker interruption'},items:[
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'First committed synthetic title'}}},
        {operation:'social.update',target:{post_id:f.posts.bulk[0]},fields:{social_title:{mode:'set',value:'Must not run after restart'}}},
        {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:'Must not run after restart'}}},
      ]})).record;
    const id=proposal.envelope.plan.change_set_id,args=confirmation(proposal);
    equal(inspect(),before,'Planning has no field/audit effect');worker.arm(id);
    const pending=raw('execute_change_set',args);
    await worker.interrupt(); // Waits for the exact child marker, then actual SIGKILL.
    const lost=await pending,data=JSON.parse(lost.content[0].text);
    ok(lost.isError&&['network_error','invalid_response'].includes(data.code)&&data.automatic_retry===false,'Killed worker is uncertain, not falsely completed');
    const killed=inspect();
    equal(killed.fields.publish._tam_rank_meta_title,['First committed synthetic title']);
    equal(killed.fields.social,before.fields.social,'Second field was not committed');equal(killed.fields.image,before.fields.image,'Third field was not committed');
    equal(killed.audits.length-before.audits.length,1,'Exactly one field audit survived process death');
    await worker.restart();
    const running=(await call('get_changes',{change_set_id:id,kind:'execution'})).record;
    equal(running.state,'running');equal(running.item_results.map(r=>r.state),['applied','pending','pending']);
    equal(running.registration.budget.operation_count,3,'Original batch reservation retained');
    ok(running.registration.lease_until>Math.floor(Date.now()/1000),'Retry occurs within the ORIGINAL unexpired lease');
    equal(inspect(),killed,'Readback does not continue pending writes');
    const stopped=(await call('execute_change_set',args)).record;
    equal(stopped.state,'partial');equal(stopped.item_results.map(r=>r.state),['applied','skipped','skipped']);
    equal(stopped.item_results.map(r=>r.attempts),[1,0,0],'No deferred field attempts after process restart');
    equal(stopped.registration.stop.reason,'interrupted','Recovery records the actual stop reason');
    equal(stopped.registration.stop.item_id,proposal.envelope.plan.items[1].item_id,'Stop identifies the first unattempted item');
    equal(stopped.registration,{...running.registration,state:'partial',stop:stopped.registration.stop},'Consent, identity, budget and lease are not renewed');
    equal(inspect(),killed,'Reconciliation does not perform deferred writes or duplicate audit');
    equal(stopped.item_results[0].delivery.result.contract_version,3,'Applied item cache/Action delivery can finish');
    equal((await call('execute_change_set',args)).record,stopped,'Stable exact replay of partial result');
    equal(inspect(),killed,'Further replay remains mutation-free');
    const reverse=(await call('rollback_change_set',{change_set_id:id,client_request_id:'native-worker-applied-item-rollback',
      item_ids:[proposal.envelope.plan.items[0].item_id]})).record;
    equal(inspect(),killed,'Rollback of applied subset is only a proposal');
    const reversed=(await call('execute_change_set',confirmation(reverse))).record;
    equal(reversed.state,'executed');equal(inspect().fields,before.fields,'Newly approved rollback restores only the committed item');
    equal(inspect().audits.length-before.audits.length,2,'One forward audit and one explicit reversal audit');
    equal((await call('get_changes',{change_set_id:id,kind:'execution'})).record.registration,stopped.registration,'Original interrupted approval and stop retained');
    console.log('PASS: actual owned worker SIGKILL → unchanged readback → skip deferred writes → approved subset rollback.');

    // Repeat at the other boundary: native field/audit/item SQL has run, but
    // the first item's COMMIT has not. Process death must roll all three back.
    const beforeTransaction=inspect();
    const uncommitted=(await call('plan_changes',{client_request_id:'native-worker-before-commit-plan',
      origin:{kind:'user_request',reference:'owned-fixture',summary:'Synthetic in-transaction interruption'},items:[
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Uncommitted synthetic title'}}},
        {operation:'social.update',target:{post_id:f.posts.bulk[0]},fields:{social_title:{mode:'set',value:'Never attempted social title'}}},
        {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:'Never attempted alt'}}},
      ]})).record;
    const uncommittedId=uncommitted.envelope.plan.change_set_id,uncommittedArgs=confirmation(uncommitted);
    equal(inspect(),beforeTransaction,'Second proposal still has no field/audit effect');
    worker.arm(uncommittedId,'before_commit');
    const interrupted=raw('execute_change_set',uncommittedArgs);
    await worker.interrupt();
    const interruptedReply=await interrupted,interruptedData=JSON.parse(interruptedReply.content[0].text);
    ok(interruptedReply.isError&&['network_error','invalid_response'].includes(interruptedData.code)&&interruptedData.automatic_retry===false,'Uncommitted worker death is uncertain to the client');
    equal(inspect(),beforeTransaction,'Process death rolls back uncommitted native fields AND audit');
    await worker.restart();
    const pendingRecord=(await call('get_changes',{change_set_id:uncommittedId,kind:'execution'})).record;
    equal(pendingRecord.state,'running');
    equal(pendingRecord.item_results.map(r=>r.state),['pending','pending','pending'],'Uncommitted applied receipt also rolled back');
    equal(pendingRecord.item_results.map(r=>r.attempts),[0,0,0],'No committed attempts were invented');
    equal(pendingRecord.registration.budget.operation_count,3,'Committed admission is retained despite rolled-back first item');
    ok(pendingRecord.registration.lease_until>Math.floor(Date.now()/1000),'Recovery still occurs inside original lease');
    equal(inspect(),beforeTransaction,'Readback never resumes the uncommitted write');
    const failed=(await call('execute_change_set',uncommittedArgs)).record;
    equal(failed.state,'failed');equal(failed.item_results.map(r=>r.state),['skipped','skipped','skipped']);
    equal(failed.item_results.map(r=>r.attempts),[0,0,0]);
    equal(failed.registration.stop.reason,'interrupted');
    equal(failed.registration.stop.item_id,uncommitted.envelope.plan.items[0].item_id);
    equal(failed.registration,{...pendingRecord.registration,state:'failed',stop:failed.registration.stop},'Recovery retains exact original consent, reservation and lease');
    equal(inspect(),beforeTransaction,'Explicit recovery does not retry the rolled-back mutation');
    equal((await call('execute_change_set',uncommittedArgs)).record,failed,'Exact failure replay is stable');
    equal(inspect(),beforeTransaction,'Failure replay has no field/audit effect');
    const refusedRollback=await raw('rollback_change_set',{change_set_id:uncommittedId,client_request_id:'native-worker-uncommitted-rollback',
      item_ids:[uncommitted.envelope.plan.items[0].item_id]});
    ok(refusedRollback.isError&&JSON.parse(refusedRollback.content[0].text).code==='rollback_unavailable','Uncommitted item cannot create a reversal proposal');
    equal(inspect(),beforeTransaction,'Rejected rollback cannot write a field or reversal audit');
    equal((await call('get_changes',{change_set_id:uncommittedId,kind:'execution'})).record,failed,'Rejected rollback preserves failure history');
    console.log('PASS: owned worker SIGKILL before COMMIT → native atomic rollback → no deferred execution or false reversal.');

    const revokedPlan=(await call('plan_changes',{client_request_id:'native-worker-revoked-owner-plan',
      origin:{kind:'user_request',reference:'owned-fixture',summary:'Synthetic revoked token recovery'},items:[
        {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Retain after revocation'}}},
        {operation:'social.update',target:{post_id:f.posts.bulk[0]},fields:{social_title:{mode:'set',value:'Do not execute after revocation'}}},
        {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:'Do not execute after revocation'}}},
      ]})).record;
    const revokedId=revokedPlan.envelope.plan.change_set_id;
    worker.arm(revokedId);const revokedRun=raw('execute_change_set',confirmation(revokedPlan));
    await worker.interrupt();ok((await revokedRun).isError,'Interrupted request is not reported as executed');
    control('revoke_execution');await worker.restart();
    const afterRevocation=inspect(),refused=await raw('execute_change_set',confirmation(revokedPlan));
    ok(refused.isError&&JSON.parse(refused.content[0].text).code==='agent_token_revoked','Old token cannot reconcile by replaying execution');
    const nativeRecovery=recovery(revokedId);checks+=nativeRecovery.checks;
    equal(nativeRecovery.proposal.plan.items.map(i=>i.disposition),['retain_applied','skip_pending','skip_pending']);
    const auditReader=new Client({name:'Owned recovery audit reader',version:'1'});
    try{
      await auditReader.connect(new StdioClientTransport({command:process.execPath,args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(cwd,'index-workflow.js')],cwd,stderr:'pipe',
        env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
          TAMRANK_PAT:f.tokens.reader.token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:'core',TAMRANK_REST_STYLE:'query',TAMRANK_WORKFLOW_PREVIEW:'1'}}));
      const readBack=await auditReader.callTool({name:'get_changes',arguments:{change_set_id:revokedId,kind:'execution'}});
      ok(!readBack.isError,'MCP audit-only reader can read recovered execution');
      const recovered=JSON.parse(readBack.content[0].text).record;
      equal(recovered.state,'partial');equal(recovered.item_results.map(i=>i.state),['applied','skipped','skipped']);
      ok(!('attested_by_token_id' in recovered.registration.attestation),'Original direct attribution removed by native privacy request');
      ok(!('attested_by_token_id' in recovered.registration.recovery.attestation),'Separate recovery direct attribution removed too');
      ok(recovered.registration.recovery.attestation.attribution_removed_at>0,'Redacted recovery retains removal event');
      equal(recovered.registration.recovery.attestation.human_verified,false);
      equal(recovered.item_results[0].invalidation,'delivered','Recovered applied field has completed native cache/Action delivery');
      equal(recovered.item_results[0].delivery.status,'delivered');
      equal(recovered.item_results[0].delivery.attempts,2,'Backend failure retried only derived-data delivery');
    }finally{await auditReader.close();}
    checks+=recoveryRetention(nativeRecovery.proposal).checks;
    equal(inspect(),afterRevocation,'Native recovery, privacy and retention change neither applied nor pending fields');
    console.log('PASS: revoked interrupted execution → approved recovery, delivery, native privacy and retention; no repeated field writes.');
  }finally{await client.close();}
  return checks;
}
