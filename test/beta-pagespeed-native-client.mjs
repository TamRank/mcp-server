/** Actual post-beta stdio/TLS, native scheduling/storage, synthetic provider only. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=ownedInstalledRuntime(cwd);
export async function runBetaPageSpeedClient({origin,fixture:f,tlsRoot,control,inspect}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
  let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const preserved=()=>{equal(inspect().preserved,true,'Original beta settings, content, metadata, history and token authority are preserved');};
  async function connect(style,token){
    const client=new Client({name:'Owned post-beta PageSpeed client',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_SITE_URL:origin,TAMRANK_PAT:token,TAMRANK_TOOL_PROFILE:'specialist',TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const raw=async(name,args)=>client.callTool({name,arguments:args});
    const call=async(name,args)=>{const r=await raw(name,args);assert.ok(!r.isError,name+': '+(r.isError?r.content[0]?.text:''));checks++;
      const data=JSON.parse(r.content[0].text);equal(JSON.stringify(data).includes('trsr1.'),false,'Private provider packet is not returned to the agent');return data;};
    return {client,raw,call};
  }
  preserved();equal(f.pages.length,25,'Maximum explicit page selection predates upgrade');
  for(const style of ['pretty','query']){
    const token=f.tokens[style],c=await connect(style,token.token);
    try{
      equal((await c.client.listTools()).tools.length,20);
      const caps=await c.call('get_capabilities',{});equal(caps.pagespeed_execution.available,true);equal(caps.scan_recovery.retained_receipt_review_available,true);
      async function plan(label){
        const before=control('inspect');
        const preview=await c.call('start_scan',{type:'pagespeed',mode:'preview',post_ids:f.pages});
        const draft=await c.call('start_scan',{type:'pagespeed',mode:'plan',post_ids:f.pages,
          expected_revision:preview.preview_revision,client_request_id:'beta-pagespeed-'+style+'-'+label});
        equal(draft.proposal.targets.map(t=>t.post_id),f.pages);equal(draft.proposal.strategies,['mobile','desktop']);
        equal(control('inspect'),before,'Neither preview nor plan dispatches a measurement');preserved();
        return {type:'pagespeed',mode:'run',proposal_id:draft.proposal_id,
          client_request_id:(label==='normal'?'native-lost-':'beta-start-')+style+'-'+label,
          confirmation:{plan_hash:draft.proposal_hash,confirmed:true,agent:'Fixture',acknowledgements:draft.proposal.required_acknowledgements}};
      }
      const run=await plan('normal'),before=control('inspect');
      equal((await c.raw('start_scan',{...run,confirmation:{...run.confirmation,plan_hash:'0'.repeat(64)}})).isError,true);
      equal(control('inspect'),before,'Wrong approval cannot register or schedule');
      const reader=await connect(style,f.reader);
      try{equal((await reader.raw('start_scan',run)).isError,true,'The beta read-only token cannot acquire new write scopes');}
      finally{await reader.client.close();}
      equal(control('inspect'),before);
      const lost=await c.raw('start_scan',run);equal(lost.isError,true,'Lost registration response remains uncertain, not retried');
      equal(JSON.parse(lost.content[0].text).client_request_id,run.client_request_id);equal(control('inspect').event_count,1);
      let progress=await c.call('start_scan',run);equal(progress.dispatch_state,'queued');equal(progress.targets.length,25);
      const registered=control('inspect');equal(registered.event_count,1);
      const registration=JSON.parse(registered.registrations.find(r=>r.execution_id===progress.execution_id).registration_json);
      equal(registration.attestation.client,{name:'Owned post-beta PageSpeed client',version:'1'});
      equal(registration.attestation.agent,{name:'unknown'},'Self-reported agent name is not trusted identity');
      const foreign=await connect(style,f.tokens.foreign.token);
      try{equal((await foreign.raw('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id})).isError,true,'Other owner cannot read private scan');}
      finally{await foreign.client.close();}
      await c.call('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id});
      equal(control('inspect'),registered,'Reading does not advance worker state or schedule');
      equal((await c.call('start_scan',run)).execution_id,progress.execution_id);equal(control('inspect').event_count,1);
      equal(control('tick',{repeat:true}),{calls:1,event_count:1},'Duplicate delivery cannot repeat the provider request');
      progress=await c.call('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id});
      equal(progress.targets[0].devices[0].state,'succeeded');equal(progress.targets[0].devices[0].result.performance_score,0,'Zero is not missing data');
      equal(control('tick',{count:49,repeat:true}),{calls:49,event_count:0});
      progress=await c.call('get_scan_status',{type:'pagespeed',execution_id:progress.execution_id});
      equal(progress.dispatch_state,'completed');equal(progress.reservation_state,'released');
      equal(progress.targets.map(t=>t.post_id),f.pages);equal(progress.targets.every(t=>t.devices.every(d=>d.state==='succeeded')),true);
      equal((await c.call('start_scan',run)).dispatch_state,'completed');equal(control('inspect').legacy_queue,null);preserved();

      // A known response survives failed runtime persistence. Recovery needs new
      // chat approval and must not restart the remaining 49 device measurements.
      const recoveryRun=await plan('recovery');
      const started=await c.call('start_scan',recoveryRun),execution_id=started.execution_id;
      const original=control('inspect').registrations.find(r=>r.execution_id===execution_id);
      equal(control('tick',{fault:'result_storage',repeat:true}),{calls:1,event_count:0});
      control('revoke',{token_id:token.id});
      equal((await c.raw('get_scan_status',{type:'pagespeed',execution_id})).isError,true,'Same-session revocation is enforced');
      const replacement=await connect(style,f.tokens[style+'_replacement'].token);
      try{
        const observed=await replacement.call('get_scan_status',{type:'pagespeed',execution_id});equal(observed.execution_enabled,false);
        assert.ok(observed.retained_result_review);checks++;
        const prepared=observed.retained_result_review,review=prepared.review;
        equal(review.can_settle,true);equal(review.proposal.targets.length,50);equal(review.cancel_remaining,49);
        const close={execution_id,receipt_reference:prepared.receipt_reference,expected_runtime_hash:review.expected_runtime_hash,
          client_request_id:'beta-settle-'+style,confirmation:{mode:'chat_attested',confirmed:true,review_hash:prepared.review_hash,
            client:{name:'Owned post-beta PageSpeed client',version:'1'},agent:{name:'Fixture'},acknowledgements:review.proposal.required_acknowledgements}};
        const unchanged=control('inspect');
        equal((await replacement.raw('close_scan',{...close,confirmation:{...close.confirmation,review_hash:'0'.repeat(64)}})).isError,true);
        equal(control('inspect'),unchanged,'Incorrect new approval cannot settle an execution');
        const out=await replacement.call('close_scan',close);equal(out.settlement_recorded,true);equal(out.progress.state,'cancelled');
        equal(out.progress.runtime.reservation_state,'released');equal(out.progress.runtime.measurements[0].state,'succeeded');
        equal(out.progress.runtime.measurements.filter(m=>m.state==='cancelled').length,49);
        equal(control('inspect').registrations.find(r=>r.execution_id===execution_id),original,'Original chat registration is never replaced');
        const refreshed=await replacement.call('get_scan_status',{execution_id,receipt_reference:prepared.receipt_reference});equal(refreshed.review.action,'already_settled');
        equal((await replacement.call('close_scan',{...close,confirmation:{...close.confirmation,review_hash:refreshed.review_hash}})).view,'result_settlement_not_needed');
        equal(control('inspect').event_count,0,'Recovery and its replay do not schedule provider work');preserved();
      }finally{await replacement.client.close();}
      console.log('PASS: post-beta PageSpeed '+style+'; 25 existing URLs, 50 devices, lost response, duplicate event, revoked PAT and newly approved retained-result recovery.');
    }finally{await c.client.close();}
  }
  preserved();return checks;
}
