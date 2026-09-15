/** Native past-dated fixtures followed by real-clock MCP/TLS; no simulated replies. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=ownedInstalledRuntime(cwd);
export async function runFieldExecutionClient({origin,fixture:f,tlsRoot,inspect,historyControl,expiryKind}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);assert.ok(historyControl);
  let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
  async function connect(key,name,profile,style){
    const client=new Client({name,version:'1'}),transport=new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_PAT:f.tokens[key].token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
    await client.connect(transport);
    const raw=async(name,args)=>{
      for(let n=0;n<8;n++){
        const r=await client.callTool({name,arguments:args});let d;try{d=JSON.parse(r.content[0].text);}catch{return r;}
        if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit'].includes(d.code))return r;
        ok(n<7,'Real HTTP request limit must reopen');console.log('WAIT: unchanged native read/request budget.');
        await new Promise(r=>setTimeout(r,10000));
      }
    };
    return {raw,call:async(name,args)=>{const r=await raw(name,args);ok(!r.isError,name+': '+(r.isError?r.content[0]?.text:''));return JSON.parse(r.content[0].text);},
      close:async()=>{await client.close();await transport.close();}};
  }
  const confirm=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
    confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true}});
  const recover=p=>({change_set_id:p.plan.change_set_id,change_token:p.recovery_token,recovery_plan:p.plan,
    confirmation:{plan_hash:p.plan_hash,confirmed:true,acknowledgements:p.plan.required_acknowledgements}});
  const refuse=async(c,name,args,code)=>{const r=await c.raw(name,args);ok(r.isError,'Old or changed approval must fail');
    const d=JSON.parse(r.content[0].text);equal(d.code??d.error,code,'Actual native refusal, not a timeout/rate-limit stand-in');};
  const native=(operation,id,extra={})=>historyControl({operation,change_set_id:id,...extra});
  const kinds=['unused_forward','unused_inverse','executed_pair','recovery_unapproved','recovery_done'];
  assert.ok(kinds.includes(expiryKind),'Runner must select one of all five isolated native scenarios');
  for(const kind of [expiryKind]){
    const n=kinds.indexOf(kind);
    const profile=n%2?'specialist':'core',style=Math.floor(n/2)%2?'query':'pretty';
    const active=await connect('execution','owned-expiry-execution',profile,style),manager=await connect('history_replacement','owned-expiry-recovery',profile,style);
    try{
      const initial=inspect();
      const seeded=native('expiry_seed','00000000-0000-4000-8000-000000000000',{kind});
      const id=seeded.target.envelope.plan.change_set_id,read={kind:'execution',change_set_id:id};
      ok(seeded.target.envelope.plan.expires_at<Math.floor(Date.now()/1000),'Real clock is past native proposal expiry');
      equal((await active.call('get_changes',read)).record,seeded.view,'Current HTTP read equals native aged state');
      const before=inspect();
      if(kind==='recovery_unapproved'){
        equal(seeded.view.state,'running');equal(seeded.view.item_results.map(i=>i.state),['applied','pending','pending']);
        await refuse(manager,'execute_change_set',recover(seeded.recovery),'field_recovery_expired');
        equal(native('snapshot',id).snapshot,seeded.snapshot,'Expired recovery leaves complete journals and fields untouched');
        for(const operation of ['expiry_requests','expiry_unused','expiry_payloads']){
          const kept=native(operation,id);equal(kept.view,seeded.view,'Age alone cannot retire unresolved execution');
          equal(kept.request_rows,2,'Unresolved admission retains paired request evidence');
        }
        const fresh=(await manager.call('get_changes',{kind:'recovery',change_set_id:id})).recovery_proposal;
        ok(fresh.plan.created_at>seeded.recovery.plan.expires_at,'New recovery is a distinct current proposal');
        const stopped=(await manager.call('execute_change_set',recover(fresh))).record;
        equal(stopped.state,'partial');equal(stopped.item_results.map(i=>i.state),['applied','skipped','skipped']);
        equal(inspect().fields,before.fields,'Current recovery stops pending work without executing it');
        await refuse(manager,'execute_change_set',recover(seeded.recovery),'field_recovery_request_conflict');
      }else if(kind.startsWith('unused_')){
        equal(seeded.view.state,'expired');
        await refuse(active,'execute_change_set',confirm(seeded.target),'change_plan_expired');
        equal(native('snapshot',id).snapshot,seeded.snapshot,'Never-approved expired plan is not admitted');
        for(const operation of ['expiry_unused','expiry_requests','erase']){
          const maintained=native(operation,id);
          equal((await active.call('get_changes',read)).record,maintained.view);
          equal(maintained.view.history.kind,'unused_execution_history');equal(maintained.view.history.execution_available,false);
          equal(maintained.view.history.items.length,3,'Retired target identities are not truncated');
          if(operation==='expiry_requests')equal(maintained.request_rows,0,'Thirty-day receipts actually removed');
          const planned=kind==='unused_forward'?await active.call('plan_changes',seeded.plan_request):await active.call('rollback_change_set',seeded.rollback_request);
          equal(planned.record,maintained.view,'Exact planning replay cannot rebuild a retired proposal');
          await refuse(active,'execute_change_set',confirm(seeded.target),'change_execution_history_only');
          equal(native('snapshot',id).snapshot,maintained.snapshot,'History replay does not recreate journals or mutate fields');
        }
        equal(inspect(),before,'Unused execution and retirement create no field/audit write');
      }else{
        const plans=kind==='executed_pair'?[seeded.forward,seeded.target]:[seeded.target];
        const replay=async()=>{
          for(const plan of plans){
            const targetId=plan.envelope.plan.change_set_id,expected=native('expiry_read',targetId);
            equal((await active.call('get_changes',{kind:'execution',change_set_id:targetId})).record,expected.view);
            const result=kind==='recovery_done'?await manager.call('execute_change_set',recover(seeded.recovery)):
              await active.call('execute_change_set',confirm(plan));
            equal(result.record,expected.view,'Expired exact approval returns the original receipt only');
            equal(native('snapshot',targetId).snapshot,expected.snapshot,'Replay does not renew dates, counters, journals or field rows');
          }
        };
        await replay();
        for(const operation of ['expiry_requests','expiry_payloads']){
          const maintained=native(operation,id);equal(maintained.request_rows,0,'Original request receipts actually removed');
          ok(maintained.view.history_retention,'Native maintenance marker exists');
          if(operation==='expiry_payloads')ok(maintained.view.history_retention.payload_compaction,'Ninety-day duplicate payload cleanup actually ran');
          await replay();
        }
        for(const plan of plans)native('erase',plan.envelope.plan.change_set_id);
        await replay();
        const changed=await connect(kind==='recovery_done'?'history_replacement':'execution','changed-expiry-client',profile,style);
        const saved=native('snapshot',id).snapshot;
        try{await refuse(changed,'execute_change_set',kind==='recovery_done'?recover(seeded.recovery):confirm(seeded.target),
          kind==='recovery_done'?'field_recovery_request_conflict':'change_execution_request_conflict');}
        finally{await changed.close();}
        equal(native('snapshot',id).snapshot,saved,'Changed chat provenance cannot adopt an old grant');
        equal(inspect(),before,'Completed aged receipts never replay writes or audits');
      }
      // When native preparation applied fields, only a fresh MCP-approved inverse restores them.
      if(['unused_inverse','recovery_unapproved','recovery_done'].includes(kind)){
        const forwardId=seeded.forward.envelope.plan.change_set_id;
        const original=(await active.call('get_changes',{kind:'execution',change_set_id:forwardId})).record;
        const results=original.history?original.history.items.map(i=>i.result):original.item_results;
        const itemIds=results.flatMap((r,i)=>r?.state==='applied'&&!r.reversal?[seeded.forward.envelope.plan.items[i].item_id]:[]);
        ok(itemIds.length>0,'Native applied data remains available for separately approved inverse');
        const inverse=(await active.call('rollback_change_set',{change_set_id:forwardId,client_request_id:'aged-fresh-restore-'+kind,item_ids:itemIds})).record;
        equal((await active.call('execute_change_set',confirm(inverse))).record.state,'executed');
      }
      equal(inspect().fields,initial.fields,'Original fictional values restored, not guessed');
      console.log('PASS: aged '+kind+'; '+profile+'/'+style+'; native past timestamps, current MCP/TLS clock, no customer data.');
    }finally{await active.close();await manager.close();}
  }
  return checks;
}
