/** Actual SDK -> owned TLS -> WordPress. No injected results or private writers. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ownedInstalledRuntime} from './owned-installed-entry.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=ownedInstalledRuntime(cwd);
export async function runFieldExecutionClient({origin,fixture:f,inspect,tlsRoot,control,wire}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
  let checks=0;
  const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
  const business=s=>({fields:s.fields,bulk:s.bulk,redirects:s.redirects});
  async function connect(profile,style){
    const client=new Client({name:'owned-native-batch-client',version:'1.0.0'});
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(runtime,'index-workflow.js')],cwd:runtime,stderr:'pipe',env:{
        PATH:process.env.PATH,TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',
        TAMRANK_PAT:f.tokens.redirect_execution.token,TAMRANK_SITE_URL:origin,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    const raw=async(name,args)=>{
      for(let attempt=0;attempt<10;attempt++){
        const r=await client.callTool({name,arguments:args});let data;
        try{data=JSON.parse(r.content[0].text);}catch{return {r};}
        if(!r.isError||!['rate_limit_exceeded','workflow_rate_limit','change_execution_rate_limited'].includes(data.code))return {r,data};
        if(data.code==='change_execution_rate_limited'){
          const read=await client.callTool({name:'get_changes',arguments:{kind:'execution',change_set_id:args.change_set_id}});
          ok(!read.isError,'Rate refusal remains readable');equal(JSON.parse(read.content[0].text).record.state,'planned','No partial admission of a maximum set');
        }
        ok(attempt<9,'Native rate window must reopen');
        console.log('WAIT: known pre-execution quota refusal; fixture waits, real limits unchanged.');
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
    };
    const call=async(name,args)=>{const {r,data}=await raw(name,args);ok(!r.isError,name+': '+JSON.stringify(data??r));return data;};
    return {client,raw,call};
  }
  const create=(source,target)=>({operation:'redirect.create',target:{source_url:source},fields:{
    target_url:{mode:'set',value:target},redirect_type:{mode:'set',value:301}}});
  const request=(label,items)=>({client_request_id:'native-batch-'+label,
    origin:{kind:'user_request',reference:'owned-batch-fixture',summary:'Only the exact fictitious items listed here'},items});
  const confirmation=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
    confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true,acknowledgements:p.envelope.plan.required_acknowledgements}});
  const id=p=>p.envelope.plan.change_set_id;
  async function execute(sdk,p){
    const {r,data}=await sdk.raw('execute_change_set',confirmation(p));
    if(!r.isError)return data.record;
    ok(['timeout','network_error'].includes(data?.code)&&data.automatic_retry===false,'Uncertain write is explicitly reported, never successful');
    console.log('RECONCILE: native maximum write reply uncertain; fixture now explicitly reads the SAME set, no additional execute request.');
    for(let n=0;n<8;n++){
      const read=await sdk.raw('get_changes',{kind:'execution',change_set_id:id(p)});
      if(!read.r.isError&&read.data.record.state!=='running')return read.data.record;
      if(read.r.isError)ok(['timeout','network_error'].includes(read.data?.code),'Only transient read uncertainty permits another read');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('Native maximum set did not become terminal; do not resume its pending items');
  }
  async function reverse(sdk,done,label){
    const {call}=sdk;
    const before=inspect(),itemIds=done.envelope.plan.items.map(i=>i.item_id);
    const p=(await call('rollback_change_set',{change_set_id:id(done),client_request_id:'native-batch-inverse-'+label,item_ids:itemIds})).record;
    equal(p.envelope.plan.items.length,itemIds.length,'Full inverse list');
    equal(p.envelope.plan.items.map(i=>i.original_item_id),[...itemIds].reverse(),'Exact reverse order, including last item');
    equal(inspect(),before,'Inverse preview is passive');
    const reversed=await execute(sdk,p);
    equal(reversed.state,'executed');equal(reversed.item_results.map(i=>i.state),itemIds.map(()=> 'applied'));
    equal(reversed.registration.budget.operation_count,itemIds.length,'Full inverse quota reservation');
    const after=inspect();equal((await call('execute_change_set',confirmation(p))).record,reversed,'Exact inverse replay');
    equal(inspect(),after,'Inverse replay never repeats native writes');
    const original=(await call('get_changes',{kind:'execution',change_set_id:id(done)})).record;
    equal(original.item_results.map(i=>i.reversal.change_set_id),itemIds.map(()=>id(reversed)),'Every original item links to its inverse');
    return reversed;
  }
  // A real FREE 404 observation becomes an Action through the real adapter.
  // No Action/reference is injected into the MCP response or HTTP writer.
  const linked=await connect('core','pretty');
  try{
    control('seed_redirect_task');
    const taskTarget=async()=>{
      const page=await linked.call('get_work_queue',{work_id:'grp_404',section:'targets',limit:1});
      equal(page.items.length,1);equal(page.next_cursor,null);ok(page.items[0].action_origin,'Real detector Action is discoverable');
      return page.items[0];
    };
    const target=await taskTarget(),a=target.action_origin;
    const input={...request('action-old',[create(f.redirect_path+'/owned-task-404',f.redirect_path+'/owned-task-destination')]),origin:a};
    const p=(await linked.call('plan_changes',input)).record;
    equal(p.envelope.plan.origin,a);equal(p.envelope.plan.origin_evidence.action_id,a.action_id);
    equal(p.envelope.plan.origin_evidence.redirect_mappings[0].source_url,f.redirect_path+'/owned-task-404');
    const before=inspect();
    for(const changes of [{revision:a.revision+1},{snapshot_hash:'0'.repeat(64)}]){
      ok((await linked.raw('plan_changes',{...input,client_request_id:'native-batch-stale-'+Object.keys(changes)[0],origin:{...a,...changes}})).r.isError,'Unmatched task proof refused');
    }
    equal(inspect(),before,'Rejected task proofs change no business or Action data');
    control('seed_redirect_task');const changed=await taskTarget();
    equal(changed.action_origin.action_id,a.action_id);ok(changed.action_origin.revision>a.revision,'New observation updates the real source revision');
    const refreshed=inspect();ok((await linked.raw('execute_change_set',confirmation(p))).r.isError,'Old approved proposal refused after actual task revision');
    equal(inspect(),refreshed,'Stale execution changes nothing');
    const p2=(await linked.call('plan_changes',{...input,client_request_id:'native-batch-action-removed',origin:changed.action_origin})).record;
    control('remove_redirect_task');const removed=inspect();
    ok((await linked.raw('execute_change_set',confirmation(p2))).r.isError,'Removed observed URL cannot be executed from saved proof');equal(inspect(),removed);
    control('seed_redirect_task');const current=await taskTarget();
    const p3=(await linked.call('plan_changes',{...input,client_request_id:'native-batch-action-current',origin:current.action_origin})).record;
    const baseline=inspect();const done=(await linked.call('execute_change_set',confirmation(p3))).record;
    equal(done.state,'executed');equal(done.envelope.plan.origin,current.action_origin);
    const after=inspect(),audit=after.audits.find(row=>row.change_set_uuid===id(done));
    equal(audit.origin_action_uuid,a.action_id,'Actual audit keeps the original Action identity');
    equal(after.actions.find(row=>row.action_uuid===a.action_id).status,'resolved','Committed redirect resolves the real 404 Action after recomputation');
    const reversed=await reverse(linked,done,'action');equal(business(inspect()),business(baseline),'Rollback restores exact native source');
    equal(inspect().actions.find(row=>row.action_uuid===a.action_id).status,'open','Rollback reopens the actual observed 404');
    equal(inspect().audits.find(row=>row.change_set_uuid===id(reversed)).origin_action_uuid,a.action_id,'Inverse audit retains Action provenance');
    console.log('PASS: real queue Action → stale/removed source refusals → approved redirect → resolved → fresh rollback → reopened.');
  }finally{await linked.client.close();}
  for(const kind of ['redirects','mixed']){
    const sdk=await connect(kind==='redirects'?'core':'specialist',kind==='redirects'?'pretty':'query');
    try{
      const baseline=inspect();let items;
      if(kind==='redirects'){
        const target=f.redirect_path+'/batch-target-'+ 'b'.repeat(200);
        items=Array.from({length:25},(_,n)=>{
          const prefix=f.redirect_path+'/batch-'+n+'-';return create(prefix+'a'.repeat(255-Buffer.byteLength(prefix)),target);
        });
      }else{
        items=f.posts.bulk.slice(0,24).map((post_id,n)=>({operation:'meta.update',target:{post_id},fields:{
          meta_description:{mode:'set',value:'é'.repeat(2300)+' '+n}}}));
        items.push(create(f.redirect_path+'/batch-unicode',f.redirect_path+'/batch-unicode-destination'));
      }
      const input=request(kind,items);
      ok((await sdk.raw('plan_changes',{...input,client_request_id:input.client_request_id+'-26',items:[...items,create(f.redirect_path+'/item-26',f.redirect_path+'/target-26')]})).r.isError,'26-item forward request refused');
      equal(inspect(),baseline,'Over-limit request has no native writes');
      const p=(await sdk.call('plan_changes',input)).record;
      equal(p.envelope.plan.items.length,25);equal(p.envelope.plan.items.map(i=>i.operation),items.map(i=>i.operation));
      ok(Buffer.byteLength(JSON.stringify(p.envelope.plan))<=262144,'Canonical plan remains within 256-KiB bound');
      equal(inspect(),baseline,'25-item preview changes no business data or audits');
      equal((await sdk.call('get_changes',{kind:'execution',change_set_id:id(p)})).record,p,'Complete stored 25-item proposal');
      const done=await execute(sdk,p);
      equal(done.state,'executed');equal(done.envelope,p.envelope,'No proposal truncation or rewriting after execution');
      equal(done.item_results.length,25);equal(done.item_results.map(i=>i.item_id),p.envelope.plan.items.map(i=>i.item_id));
      equal(done.item_results.map(i=>i.state),items.map(()=> 'applied'));equal(done.registration.budget.operation_count,25);
      const after=inspect();equal(after.audits.length-baseline.audits.length,25,'One native audit per exact item');
      for(let n=0;n<25;n++){
        const item=items[n];
        if(item.operation==='redirect.create'){
          const row=after.redirects.find(r=>r.source_url===item.target.source_url);ok(row,'Every created source retained');
          equal(row.target_url,item.fields.target_url.value);equal(done.item_results[n].redirect_result.redirect_id,Number(row.id),'Actual assigned ID survives MCP');
        }else equal(after.bulk[n]._tam_rank_meta_description,[item.fields.meta_description.value],'Full Unicode field, not an excerpt');
      }
      equal((await sdk.call('get_changes',{kind:'execution',change_set_id:id(done)})).record,done,'All results available on fresh read');
      equal((await sdk.call('execute_change_set',confirmation(p))).record,done);equal(inspect(),after,'Replay does not repeat 25 writes');
      if(kind==='mixed'){
        const measurements=wire().filter(r=>r.status===200&&r.route.includes('/changes/executions'));
        console.log('Native mixed execution wire peak: '+Math.max(...measurements.map(r=>r.bytes))+' bytes.');
        ok(measurements.some(r=>r.bytes>524288),'Actual WordPress Unicode JSON exceeds the old ordinary 512-KiB cap');
        ok(measurements.every(r=>r.bytes<=1048576),'Actual full results fit the bounded execution transport');
        console.log('PASS: native mixed execution wire peak '+Math.max(...measurements.map(r=>r.bytes))+' bytes, no dropped fields.');
      }
      const beforeInvalid=inspect();
      ok((await sdk.raw('rollback_change_set',{change_set_id:id(done),client_request_id:'native-batch-inverse-26-'+kind,
        item_ids:[...p.envelope.plan.items.map(i=>i.item_id),'00000000-0000-4000-8000-000000000026']})).r.isError,'26-item rollback refused');equal(inspect(),beforeInvalid);
      await reverse(sdk,done,kind);
      equal(business(inspect()),business(baseline),'All 25 native items restored exactly');
      equal(inspect().audits.length-baseline.audits.length,50,'Exactly 25 forward and 25 inverse audits');
      console.log('PASS: native '+kind+' maximum 25-item proposal → execution → read/replay → full approved inverse.');
    }finally{await sdk.client.close();}
  }
  return checks;
}
