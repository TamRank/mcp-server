/** Real worker interruption, native owner erasure and historical replay over MCP/TLS. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
import {validHistoricalExecution} from '../src/execution-history.js';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=ownedInstalledRuntime(cwd);
export async function runFieldExecutionClient({origin,fixture:f,tlsRoot,inspect,worker,historyControl,historyFamily}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
  assert.ok(['field','redirect'].includes(historyFamily)&&worker&&historyControl);
  const redirect=historyFamily==='redirect',writer=redirect?'redirect_execution':'execution',replacement='history_replacement';
  let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
  async function connect(key,name,profile='core',style='pretty'){
    const client=new Client({name,version:'1'}),transport=new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_PAT:f.tokens[key].token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
    await client.connect(transport);
    const raw=async(name,args)=>{
      for(let n=0;n<8;n++){
        const r=await client.callTool({name,arguments:args});let d;try{d=JSON.parse(r.content[0].text);}catch{return r;}
        if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit','change_execution_rate_limited'].includes(d.code))return r;
        if(d.code==='change_execution_rate_limited'){
          const state=await client.callTool({name:'get_changes',arguments:{kind:'execution',change_set_id:args.change_set_id}});
          assert.ok(!state.isError);assert.equal(JSON.parse(state.content[0].text).record.state,'planned','Only a refused, unadmitted write may be paced');
        }
        assert.ok(n<7,'Real request budget did not reopen');
        console.log('WAIT: native history fixture request refused by unchanged budget.');await new Promise(r=>setTimeout(r,10000));
      }
    };
    return {raw,call:async(name,args)=>{const r=await raw(name,args);ok(!r.isError,name+': '+(r.isError?r.content[0]?.text:''));return JSON.parse(r.content[0].text);},
      close:async()=>{await client.close();await transport.close();}};
  }
  const confirm=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
    confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true,...(redirect?{acknowledgements:p.envelope.plan.required_acknowledgements}:{})}});
  const items=label=>redirect?[
    {operation:'redirect.create',target:{source_url:f.redirect_path+'/history-'+label+'-a'},fields:{target_url:{mode:'set',value:f.redirect_path+'/destination'},redirect_type:{mode:'set',value:301}}},
    {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'History '+label}}},
    {operation:'redirect.create',target:{source_url:f.redirect_path+'/history-'+label+'-b'},fields:{target_url:{mode:'set',value:f.redirect_path+'/destination'},redirect_type:{mode:'set',value:302}}},
  ]:[
    {operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'History '+label}}},
    {operation:'social.update',target:{post_id:f.posts.bulk[0]},fields:{social_title:{mode:'set',value:'History social '+label}}},
    {operation:'image_alt.update',target:{attachment_id:f.posts.image},fields:{alt_text:{mode:'set',value:'History image '+label}}},
  ];
  const phases=redirect?['before_commit','after_commit','after_all']:['before_commit','after_commit'];
  let caseIndex=0;
  for(const direction of ['forward','inverse'])for(const phase of phases){
    const label=historyFamily+'-'+direction+'-'+phase,n=caseIndex++,profile=n%2?'specialist':'core',style=Math.floor(n/2)%2?'query':'pretty';
    const active=await connect(writer,'owned-history-execution',profile,style),recovery=await connect(replacement,'owned-history-recovery',profile,style);
    try{
      const before=inspect();
      const forward=(await active.call('plan_changes',{client_request_id:'history-forward-'+label,
        origin:{kind:'user_request',reference:'owned-fixture',summary:'Fictional historical recovery'},items:items(label)})).record;
      let target=forward;
      if(direction==='inverse'){
        equal((await active.call('execute_change_set',confirm(forward))).record.state,'executed');
        target=(await active.call('rollback_change_set',{change_set_id:forward.envelope.plan.change_set_id,client_request_id:'history-inverse-'+label,
          item_ids:forward.envelope.plan.items.map(i=>i.item_id)})).record;
      }
      const id=target.envelope.plan.change_set_id,prior=inspect();worker.arm(id,phase);
      const interrupted=active.raw('execute_change_set',confirm(target));await worker.interrupt(interrupted);
      const lost=await interrupted;ok(lost.isError,'Killed worker cannot claim success');equal(JSON.parse(lost.content[0].text).automatic_retry,false);
      await worker.restart();const killed=inspect(),applied=phase==='before_commit'?0:phase==='after_commit'?1:3;
      equal(killed.audits.length-prior.audits.length,applied);
      const running=(await recovery.call('get_changes',{kind:'execution',change_set_id:id})).record;
      equal(running.state,'running');equal(running.item_results.map(i=>i.state),Array.from({length:3},(_,i)=>i<applied?'applied':'pending'));
      const proposal=(await recovery.call('get_changes',{kind:'recovery',change_set_id:id})).recovery_proposal;
      const args={change_set_id:id,change_token:proposal.recovery_token,recovery_plan:proposal.plan,
        confirmation:{plan_hash:proposal.plan_hash,confirmed:true,acknowledgements:proposal.plan.required_acknowledgements}};
      const done=(await recovery.call('execute_change_set',args)).record;
      equal(done.state,applied===3?'executed':applied?'partial':'failed');equal(done.registration.budget,running.registration.budget);
      equal(inspect(),killed,'Approved recovery performs no additional website or audit writes');
      const native=historyControl({operation:'erase',change_set_id:id}),view=native.view;
      ok(validHistoricalExecution({contract_version:1,record:view},id,target.envelope.plan_hash),'Actual minimal native history verifies');
      equal(view.history.items.length,3);equal(view.history.execution.recovery.plan_hash,proposal.plan_hash);
      equal(view.history.execution.budget,running.registration.budget);equal(view.history.execution_available,false);
      const readArgs={kind:'execution',change_set_id:id};
      equal((await recovery.call('get_changes',readArgs)).record,view,'MCP read equals separately verified native history');
      equal((await recovery.call('execute_change_set',args)).record,view,'Exact old recovery returns only the same historical receipt');
      for(const changed of [{...args,confirmation:{...args.confirmation,plan_hash:'0'.repeat(64)}},
        {...args,change_token:args.change_token.split('.')[0]+'.'+'0'.repeat(64)},
        {...args,recovery_plan:{...args.recovery_plan,execution_id:'00000000-0000-4000-8000-000000000000'}}])
        ok((await recovery.raw('execute_change_set',changed)).isError,'Changed historical recovery cannot create new consent');
      for(const [key,name]of[['reader','owned-history-reader'],['other','owned-history-recovery'],[writer,'owned-history-recovery']]){
        const stranger=await connect(key,name,profile,style);
        try{
          const read=await stranger.raw('get_changes',readArgs);
          if(key==='other')ok(read.isError,'Other administrator cannot read private history');
          else{ok(!read.isError,'Same-owner reader sees only history');equal(JSON.parse(read.content[0].text).record,view);}
          ok((await stranger.raw('execute_change_set',args)).isError,'Reader, foreign owner or another PAT cannot adopt old recovery');
        }finally{await stranger.close();}
      }
      equal(historyControl({operation:'snapshot',change_set_id:id}).snapshot,native.snapshot,'History reads and replay preserve complete journals, audits and website rows');
      if(applied){
        const absent=historyControl({operation:'withhold_audit',change_set_id:id});
        try{
          const failures=[await recovery.raw('get_changes',readArgs),await recovery.raw('execute_change_set',args),
            await active.raw('rollback_change_set',{change_set_id:id,client_request_id:'history-missing-'+label,item_ids:[target.envelope.plan.items[0].item_id]})];
          for(const result of failures){ok(result.isError,'Missing original audit is never guessed');
            const error=JSON.parse(result.content[0].text);equal(error.code??error.error,'change_execution_storage_invalid','Missing-audit refusal must come from actual native evidence validation');}
          equal(historyControl({operation:'snapshot',change_set_id:id}).snapshot,absent.snapshot,'Refused missing-history operations change no stored rows');
        }finally{equal(historyControl({operation:'restore_audit',change_set_id:id,row:absent.row}).snapshot,native.snapshot,'Exact owned audit restored without any other change');}
        equal((await recovery.call('execute_change_set',args)).record,view,'Restoring the original evidence recovers only the same receipt');
      }
      equal(inspect(),killed,'Historical checks never run pending items');
      // Restore only applied, not-yet-reversed original items with fresh approval.
      const source=(await active.call('get_changes',{kind:'execution',change_set_id:forward.envelope.plan.change_set_id})).record;
      const results=source.history?source.history.items.map(i=>i.result):source.item_results;
      const remaining=results.flatMap((r,i)=>r?.state==='applied'&&!r.reversal?[forward.envelope.plan.items[i].item_id]:[]);
      if(remaining.length){
        const restore=(await active.call('rollback_change_set',{change_set_id:forward.envelope.plan.change_set_id,client_request_id:'history-restore-'+label,item_ids:remaining})).record;
        equal((await active.call('execute_change_set',confirm(restore))).record.state,'executed');
      }
      equal(inspect().fields,before.fields,'Only newly approved restoration returns fixture fields');
      if(redirect)equal(inspect().redirects,before.redirects,'Only newly approved restoration returns fixture redirects');
      console.log('PASS: historical '+label+'; '+profile+'/'+style+'; actual kill, new recovery, native erasure, read/replay; '+(applied?'missing-audit refusal':'no committed audit')+'.');
    }finally{await active.close();await recovery.close();}
  }
  return checks;
}
