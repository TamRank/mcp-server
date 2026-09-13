/** Installed/source stdio MCP -> actual post-beta WordPress work sources over owned TLS. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=ownedInstalledRuntime(cwd);
export async function runBetaWorkClient({origin,fixture:f,tlsRoot,inspect,control}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
  let checks=0;
  const ok=(v,label)=>{assert.ok(v,label);checks++;},equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const observe=()=>{const {checks:n,...data}=inspect();checks+=n;return data;};
  async function connect(profile,style,token){
    const client=new Client({name:'Owned post-beta work client',version:'1'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_SITE_URL:origin,TAMRANK_PAT:token,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const call=async(name,args={})=>{
      const r=await client.callTool({name,arguments:args});const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
      if(r.isError)throw new Error(text);checks++;return JSON.parse(text);
    };
    return {client,call};
  }
  for(const [key,access]of Object.entries(f.styles)){
    const {profile,style}=access,c=await connect(profile,style,access.tasks.token),i=await connect(profile,style,access.importance.token),
      read=await connect(profile,style,f.reader),opposite=await connect(profile,style==='pretty'?'query':'pretty',access.tasks.token);
    const state=(id,who=c)=>who.call('get_work_queue',{work_id:id,section:'administration'});
    const request=(label,args)=>({client_request_id:'beta-work-'+key+'-'+label,...args});
    const write=async(who,args)=>{const r=await who.call('update_work_item',args);observe();return r;};
    async function refused(who,args,pattern){
      const before=observe();await assert.rejects(who.call('update_work_item',args),pattern);checks++;
      equal(observe(),before,'Refused work operation is passive');
    }
    async function signalTargets(id,limit){
      const rows=[];let cursor,hash;
      do{const p=await c.call('get_signals',{signal_id:id,section:'targets',limit,...(cursor?{cursor}:{})});
        if(hash)equal(p.snapshot_hash,hash);hash=p.snapshot_hash;rows.push(...p.items);cursor=p.next_cursor;
      }while(cursor);
      equal(new Set(rows.map(r=>r.key)).size,rows.length);return {rows,hash};
    }
    try{
      const listing=await c.client.listTools();equal(listing.tools.length,profile==='core'?12:20);ok(JSON.stringify(listing).length<16000);
      const caps=await c.call('get_capabilities');equal(caps.execution_enabled,false);ok(caps.work_administration.manual.available);
      equal((await i.call('get_capabilities')).write_operations,['importance.update']);
      equal((await read.call('get_capabilities')).work_administration.available,false);
      const before=observe(),initial=await state(access.manual_id,read);
      equal(initial.note,'Original manual note');equal(initial.completion_kind,'manual_only');equal(observe(),before,'Administration read is passive');
      const first=request('manual-note',{operation:'work.note',work_id:access.manual_id,expected_revision:initial.work_revision,note:'MCP manual note'});
      const note=await write(c,first);equal(note.website_changed,false);ok(note.revision!==initial.work_revision);
      equal((await state(access.manual_id,read)).note,first.note);
      const afterNote=observe();equal(await opposite.call('update_work_item',first),note);equal(observe(),afterNote,'Exact retry adds no receipt/source/event');
      await refused(c,{...first,note:'Wrong same ID'},/workflow_request_conflict/);
      await refused(c,{...first,client_request_id:first.client_request_id+'-stale'},/workflow_work_changed/);
      await refused(read,first,/workflow_operation_unavailable/);await refused(i,first,/workflow_operation_unavailable/);
      await refused(c,request('manual-review',{operation:'work.review_target',work_id:access.manual_id,expected_revision:note.revision,
        target_key:'relation:1',reviewed:true}),/invalid_request/);
      const done=await write(c,request('manual-complete',{operation:'work.complete',work_id:access.manual_id,expected_revision:note.revision}));
      equal(done.status,'completed');equal(done.completion_kind,'manual_only');equal(done.outcome,'not_measured');
      ok((await c.call('get_work_queue',{kind:'manual',status:'completed'})).items.some(w=>w.work_id===access.manual_id));
      const large=await write(c,{...first,client_request_id:first.client_request_id+'-large',expected_revision:done.revision,note:'é'.repeat(2000)});
      equal(large.status,'completed');equal(Buffer.byteLength((await state(access.manual_id)).note),4000);
      await refused(c,{...first,client_request_id:first.client_request_id+'-too-large',expected_revision:large.revision,note:'é'.repeat(2001)},/MCP error -32602: Input validation error/);
      const clear=await write(c,{...first,client_request_id:first.client_request_id+'-clear',expected_revision:large.revision,note:''});
      equal((await state(access.manual_id)).note,'');equal(clear.status,'completed');
      const final=await write(c,{...first,client_request_id:first.client_request_id+'-final',expected_revision:clear.revision,note:'Final manual note'});
      const opened=await write(c,request('manual-reopen',{operation:'work.reopen',work_id:access.manual_id,expected_revision:final.revision}));equal(opened.status,'open');
      const current=await state(access.manual_id);control(key);const fromUi=await state(access.manual_id);
      ok(current.work_revision!==fromUi.work_revision,'Real UI source cycle advances the same revision');equal(fromUi.note,current.note);
      await refused(c,{...first,client_request_id:first.client_request_id+'-after-ui',expected_revision:current.work_revision},/workflow_work_changed/);
      const uiSnapshot=observe();equal(await opposite.call('update_work_item',first),note);equal(observe(),uiSnapshot,'Old MCP replay never undoes newer UI progress');

      const importance=()=>read.call('get_page',{post_id:f.post_id,section:'importance'});
      equal((await importance()).importance.present,false);equal((await importance()).importance.value,'standard');
      const queue=await read.call('get_work_queue',{limit:1});
      const moneyInput=request('importance-money',{operation:'importance.update',post_id:f.post_id,expected_value:'standard',value:'money'});
      await refused(c,moneyInput,/workflow_operation_unavailable/);await refused(read,moneyInput,/workflow_operation_unavailable/);
      const money=await write(i,moneyInput);equal(money.after.value,'money');equal(money.before.present,false);equal(money.actor_type,'agent');
      equal(money.website_changed,false);equal(money.outcome,'not_measured');equal((await importance()).importance.value,'money');
      ok((await read.call('get_work_queue',{limit:1})).revision!==queue.revision,'Shared queue revision reflects page importance');
      await refused(i,{...moneyInput,value:'important'},/workflow_request_conflict/);
      await refused(i,{...moneyInput,client_request_id:moneyInput.client_request_id+'-stale'},/importance_value_changed/);
      const important=await write(i,{...moneyInput,client_request_id:moneyInput.client_request_id+'-important',expected_value:'money',value:'important'});
      equal(important.after.value,'important');const importanceSnapshot=observe();equal(await i.call('update_work_item',moneyInput),money);
      equal(observe(),importanceSnapshot,'Old importance retry never undoes a newer value');
      const standard=await write(i,{...moneyInput,client_request_id:moneyInput.client_request_id+'-standard',expected_value:'important',value:'standard'});
      equal(standard.after.present,false);equal((await importance()).importance.value,'standard');

      const signal=(await c.call('get_signals',{signal_id:access.near_signal})).signal;
      ok(signal.research_operations.includes('investigate.near_win'));
      const all=await signalTargets(access.near_signal,3);equal(all.rows.length,8);const keys=all.rows.map(r=>r.key);
      const pickup=request('pickup',{operation:'work.pickup',signal_id:access.near_signal,snapshot_hash:all.hash,target_keys:keys.slice(0,2),
        research_operation:'investigate.near_win',title:'MCP original research',note:'Original research note',priority:'hoog'});
      await refused(read,pickup,/workflow_operation_unavailable/);
      const picked=await write(c,pickup);equal(picked.created_target_count,2);equal(picked.remaining_target_count,6);equal(picked.work_ids.length,1);
      equal(picked.website_changed,false);equal(picked.outcome,'not_measured');const id=picked.work_ids[0];
      const targets=await c.call('get_work_queue',{work_id:id,section:'targets'});equal(targets.total,2);
      const research=await state(id);equal(research.reviewed_count,0);
      const reviewInput=request('research-review',{operation:'work.review_target',work_id:id,expected_revision:research.work_revision,target_key:targets.items[0].key,reviewed:true});
      const reviewed=await write(c,reviewInput);equal(reviewed.reviewed_count,1);equal(reviewed.status,'open');
      await refused(c,{...reviewInput,reviewed:false},/workflow_request_conflict/);
      const researchNote=await write(c,request('research-note',{operation:'work.note',work_id:id,expected_revision:reviewed.revision,note:'Final research note'}));
      const completed=await write(c,request('research-complete',{operation:'work.complete',work_id:id,expected_revision:researchNote.revision}));
      equal(completed.status,'completed');equal(completed.completion_kind,'research_only');equal(completed.outcome,'not_measured');
      const reopened=await write(c,request('research-reopen',{operation:'work.reopen',work_id:id,expected_revision:completed.revision}));
      equal(reopened.status,'open');equal(reopened.reviewed_count,1);equal((await state(id)).note,'Final research note');
      const researchSnapshot=observe();equal(await opposite.call('update_work_item',pickup),picked);equal(observe(),researchSnapshot,'Pickup retry preserves review and note');
      const overlap=await write(c,{...pickup,client_request_id:pickup.client_request_id+'-overlap',target_keys:keys.slice(1,3),title:'Only new research'});
      equal(overlap.created_target_count,1);equal(overlap.reused_target_count,1);equal(overlap.remaining_target_count,5);equal(overlap.work_ids.length,2);
      const total=await write(c,{...pickup,client_request_id:pickup.client_request_id+'-rest',target_keys:keys,title:'Remaining research'});
      equal(total.created_target_count,5);equal(total.reused_target_count,3);equal(total.remaining_target_count,0);
      equal((await c.call('get_signals',{signal_id:access.near_signal})).signal.state,'tasked');
      const reuse=await write(c,{...pickup,client_request_id:pickup.client_request_id+'-reuse',title:'Must not replace original'});
      equal(reuse.created_target_count,0);equal(reuse.reused_target_count,2);equal(reuse.work_ids,picked.work_ids);equal((await state(id)).note,'Final research note');
      const big=await signalTargets(access.large_signal,50);equal(big.rows.length,200);
      const bigInput=request('pickup-large',{operation:'work.pickup',signal_id:access.large_signal,snapshot_hash:big.hash,target_keys:big.rows.map(r=>r.key),
        research_operation:'investigate.404',title:'All 200 URLs',note:'é'.repeat(2000),priority:'middel',deadline:'2026-12-01'});
      ok(Buffer.byteLength(JSON.stringify(bigInput))>4096);
      const bigResult=await write(c,bigInput);equal(bigResult.created_target_count,200);equal(bigResult.work_ids.length,1);equal(bigResult.remaining_target_count,0);
      equal((await state(bigResult.work_ids[0])).target_count,200);
      const allWork=[];let cursor;
      do{const page=await c.call('get_work_queue',{work_id:bigResult.work_ids[0],section:'targets',limit:50,...(cursor?{cursor}:{})});
        allWork.push(...page.items);cursor=page.next_cursor;}while(cursor);
      equal(allWork.length,200);equal(new Set(allWork.map(r=>r.key)).size,200,'No four-preview-item cap during actual pickup');
      const end=observe(),manual=end.manual[key];equal(manual.note,'Final manual note');equal(manual.status,'open');equal(end.importance.present,false);
      const events=end.events.filter(e=>Number(e.actor_id)===access.operator_id);ok(events.some(e=>e.actor_type==='agent'));ok(events.some(e=>e.actor_type==='user'));
      const receipts=end.requests.filter(r=>Number(r.operator_id)===access.operator_id);equal(receipts.length,18,'Only accepted distinct work requests create durable receipts');
      console.log('PASS: post-beta '+key+' source-owned manual/research notes, progress, pickup and independent page importance; full 200-target selection.');
    }finally{await c.client.close();await i.client.close();await read.client.close();await opposite.client.close();}
  }
  return checks;
}
