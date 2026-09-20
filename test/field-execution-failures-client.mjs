/** Owned native HTTPS conflict and authorization matrix; no customer fixture. */
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runFieldExecutionClient({origin,fixture:f,tlsRoot,inspect,control,otherFixture,otherOrigin}){
  assert.match(tlsRoot,/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(tlsRoot+'/owned-fixture'));
  assert.match(origin,/^https:\/\/schema-source\.example\.org:\d{4,5}(?:\/client-two)?$/);
  let checks=0;const clients=[];
  const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
  const ok=(v,label)=>{assert.ok(v,label);checks++;};
  async function connect(token,site=origin,profile='core',style='pretty'){
    const client=new Client({name:'Owned conflict client',version:'1'});clients.push(client);
    await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',path.join(cwd,'test/owned-schema-dns.mjs'),path.join(cwd,'index-workflow.js')],cwd,stderr:'pipe',
      env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:tlsRoot+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:tlsRoot,
        TAMRANK_PAT:token,TAMRANK_SITE_URL:site,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,TAMRANK_WORKFLOW_PREVIEW:'1'}}));
    return client;
  }
  const raw=async(c,name,args)=>{const r=await c.callTool({name,arguments:args});
    if(r.isError&&r.content[0].text.startsWith('MCP error -32602: Input validation error:'))return {r,data:{code:'sdk_input_validation'}};
    return {r,data:JSON.parse(r.content[0].text)};};
  const call=async(c,name,args)=>{const {r,data}=await raw(c,name,args);ok(!r.isError,name+': '+JSON.stringify(data));return data;};
  const refuse=async(c,name,args,code)=>{const {r,data}=await raw(c,name,args);ok(r.isError,name+' must be refused');
    if(code)equal(data.code,code);else ok(!['network_error','timeout','rate_limit_exceeded','workflow_rate_limit'].includes(data.code),'Not a transport/quota failure');return data;};
  const confirmation=p=>({change_set_id:p.envelope.plan.change_set_id,change_token:p.envelope.change_token,
    confirmation:{plan_hash:p.envelope.plan_hash,confirmed:true}});
  const read=(c,p)=>call(c,'get_changes',{change_set_id:p.envelope.plan.change_set_id,kind:'execution'});
  const request=id=>({client_request_id:id,origin:{kind:'user_request',reference:'owned-fixture',summary:'Synthetic conflict matrix'},
    items:[{operation:'meta.update',target:{post_id:f.posts.publish},fields:{meta_title:{mode:'set',value:'Approved synthetic title'}}}]});
  try{
    const owner=await connect(f.tokens.execution.token),reader=await connect(f.tokens.reader.token,origin,'specialist','query'),other=await connect(f.tokens.other.token);
    const caps=await call(owner,'get_capabilities',{});ok(caps.field_execution.available&&caps.field_execution.rollback_available,'Owner ready');
    const readerCaps=await call(reader,'get_capabilities',{});ok(readerCaps.field_execution.read_available&&!readerCaps.field_execution.available,'Audit reader has no write grant');
    const baseline=inspect(),proposal=(await call(owner,'plan_changes',request('native-newer-field-0001'))).record;
    equal((await read(reader,proposal)).record,proposal,'Separate same-owner audit PAT may reconcile');
    await refuse(other,'get_changes',{change_set_id:proposal.envelope.plan.change_set_id,kind:'execution'},'change_execution_not_found');
    await refuse(other,'execute_change_set',confirmation(proposal),'change_execution_not_found');
    await refuse(reader,'execute_change_set',confirmation(proposal));
    equal(inspect(),baseline,'Unauthorized calls do not touch fields/audits');
    control('newer_title');const newer=inspect();
    await refuse(owner,'execute_change_set',confirmation(proposal),'change_plan_source_changed');
    equal(inspect(),newer,'Approval for old source does not overwrite a newer edit');
    const stillPlanned=(await read(owner,proposal)).record;
    equal(stillPlanned.state,'planned');equal(stillPlanned.approval_recorded,false,'Rejected preflight does not record execution consent');
    // Restoring this owned test source is a control-plane action, not MCP repair.
    control('remove_title');equal(inspect(),baseline,'Synthetic baseline restored independently');
    const forward=(await call(owner,'plan_changes',request('native-rollback-conflict-0001'))).record;
    const done=(await call(owner,'execute_change_set',confirmation(forward))).record;equal(done.state,'executed');
    const applied=inspect();equal(applied.fields.publish._tam_rank_meta_title,['Approved synthetic title']);
    equal(applied.audits.length-baseline.audits.length,1);
    const reverse=(await call(owner,'rollback_change_set',{change_set_id:forward.envelope.plan.change_set_id,
      client_request_id:'native-rollback-conflict-plan',item_ids:forward.envelope.plan.items.map(i=>i.item_id)})).record;
    control('newer_title');const manual=inspect();
    await refuse(owner,'execute_change_set',confirmation(reverse),'rollback_conflict');
    equal(inspect(),manual,'Previously planned rollback protects newer hand edits');
    equal((await read(owner,reverse)).record.approval_recorded,false);
    equal((await read(reader,forward)).record.registration,done.registration,'Original successful approval unchanged');
    // Same live client retains its original available=true capabilities. Revoke
    // the issuing token out of process; server-side authority must still win.
    const pending=(await call(owner,'plan_changes',request('native-revoke-before-run'))).record;
    control('revoke_execution');const revokedBefore=inspect();
    await refuse(owner,'execute_change_set',confirmation(pending),'agent_token_revoked');
    equal(inspect(),revokedBefore,'Revocation overrides cached client availability');
    const readerPending=(await read(reader,pending)).record;
    equal(readerPending.state,'planned');equal(readerPending.approval_recorded,false);
    equal((await read(reader,forward)).record.registration,done.registration,'A valid audit-only owner still sees historical approval');
    if(f.blog_id!==otherFixture.blog_id){
      const peer=await connect(otherFixture.tokens.other.token,otherOrigin);
      ok((await call(peer,'get_capabilities',{})).field_execution.available,'Foreign-site token is independently valid on its own site');
      const crossed=await connect(otherFixture.tokens.other.token,origin,'specialist','query');
      await refuse(crossed,'get_capabilities',{});
      await refuse(crossed,'get_changes',{change_set_id:forward.envelope.plan.change_set_id,kind:'execution'});
      equal(inspect(),revokedBefore,'Valid other-site token cannot read or mutate this tenant');
    }
    console.log('PASS: owned HTTPS newer-edit/rollback conflicts, owner boundaries and stale-client token revocation.');
  }finally{for(const client of clients)await client.close();}
  return checks;
}
