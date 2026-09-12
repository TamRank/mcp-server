/** Actual owned WordPress forward execution through stdio/verified TLS. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {validSchemaExecutionResponse,matchesSchemaExecutionRequest,isSchemaExecutionPlan} from '../src/schema-execution.js';
import {validSchemaRollbackPreview,matchesSchemaRollbackRequest} from '../src/schema-rollback.js';
import {verifySchemaAuthority} from './schema-execution-native-authority.mjs';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const f=JSON.parse(raw),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.match(f.root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);assert.ok(existsSync(f.root+'/owned-fixture'));
assert.match(f.site_url||'',/^https:\/\/schema-source\.example\.org:[0-9]{4,5}(?:\/client-two)?$/);
for(const t of [f.token,f.other,f.reader])assert.ok(t?.startsWith('tamrank_pat_'));
assert.ok(['core','specialist'].includes(f.profile)&&['pretty','query'].includes(f.style)&&['plan','execute','rollback_preview','rollback_plan'].includes(f.mode));
let checks=0;const check=(v,label)=>{checks++;assert.ok(v,label);};
const client=new Client({name:'Owned schema workflow client',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['--import',path.join(root,'test/owned-schema-dns.mjs'),path.join(root,'index-workflow.js')],
  cwd:root,stderr:'pipe',env:{PATH:process.env.PATH,NODE_EXTRA_CA_CERTS:f.root+'/ca.pem',TAMRANK_SCHEMA_FIXTURE_ROOT:f.root,
    TAMRANK_PAT:f.token,TAMRANK_SITE_URL:f.site_url,TAMRANK_TOOL_PROFILE:f.profile,TAMRANK_REST_STYLE:f.style,TAMRANK_WORKFLOW_PREVIEW:'1'}});
const call=(name,args)=>client.callTool({name,arguments:args});
const decode=(r,label)=>{check(!r.isError,label+': '+(r.isError?r.content[0]?.text:''));return JSON.parse(r.content[0].text);};
try{
  await client.connect(transport);const list=await client.listTools();
  check(list.tools.length===(f.profile==='core'?12:20)&&JSON.stringify(list).length<16000,'Existing bounded tool catalog');
  const caps=decode(await call('get_capabilities',{}),'Capabilities'),c=caps.schema_execution;
  check(c.contract_version===1&&(f.limited?!c.available:c.available)&&c.read_available&&c.record_contract==='schema_execution_view_v1','Ready native schema workflow, operation scopes preserved');
  check(c.rollback_available===f.public_rollback&&!c.recovery_available,'Inverse separately enabled; journal recovery remains unavailable');
  let data;
  if(f.mode==='rollback_preview'){
    check(validSchemaRollbackPreview({contract_version:1,comparison:f.expected_preview},f.input),
      'Native semantic projection shape: '+JSON.stringify({keys:Object.keys(f.expected_preview),expires:f.expected_preview.expires_at,
        proposal:f.expected_preview.proposal_input,items:f.expected_preview.items.map(i=>({keys:Object.keys(i),operation:i.operation,
          original_operation:i.original_operation,order:i.original_order,audit:i.audit_id,target:i.target,
          beforeType:Array.isArray(i.before)?'array':typeof i.before,afterType:Array.isArray(i.after)?'array':typeof i.after,
          comparison:i.schema_comparison&&{keys:Object.keys(i.schema_comparison),evidence:i.schema_comparison.source_evidence}}))}));
    data=decode(await call('rollback_change_set',f.input),'Fresh native inverse comparison');
    check(validSchemaRollbackPreview(data,f.input),'Semantic comparison binds every selected original item/source');
    const again=decode(await call('rollback_change_set',f.input),'Repeat comparison without source refresh');
    checks++;assert.deepEqual(again,data,'Unchanged source comparison is stable');
    process.stdout.write(JSON.stringify({ok:true,checks,comparison:data.comparison}));
  }else if(f.mode==='plan'||f.mode==='rollback_plan'){
    const inverse=f.mode==='rollback_plan',tool=inverse?'rollback_change_set':'plan_changes';
    if(!inverse)check(isSchemaExecutionPlan(f.input,c),'Complete native capability for '+f.input.items.map(i=>i.operation).join(',')+'; supported: '+c.operations.join(','));
    data=decode(await call(tool,f.input),'Exact native executable schema proposal');
    check(inverse?matchesSchemaRollbackRequest(data,f.input):matchesSchemaExecutionRequest(data,f.input),'All requested targets, values and origin remain exact');
    check(data.record.state==='planned'&&!data.record.approval_recorded,'Plan does not approve or execute');
    if(f.verify_authority)await verifySchemaAuthority(f,data,check);
    const replay=decode(await call(tool,f.input),'Identical proposal retry');
    checks++;assert.deepEqual(replay,data,'Native proposal replay is immutable');
    const forged={...f.input,client_request_id:f.input.client_request_id+'-different',schema_storage:{raw:'not-accepted'}};
    check((await call(tool,forged)).isError,'Agent cannot supply native storage proof');
    if(inverse){
      const stale={...f.input,client_request_id:f.input.client_request_id+'-stale',expected_revision:'0'.repeat(64)};
      check((await call(tool,stale)).isError,'Native planner refuses changed comparison revision');
    }
  }else{
    const a=f.input,args={change_set_id:a.change_set_id,change_token:a.change_token,
      confirmation:{plan_hash:a.confirmation.plan_hash,confirmed:true,acknowledgements:a.confirmation.acknowledgements}};
    const before=decode(await call('get_changes',{kind:'execution',change_set_id:a.change_set_id}),'Read frozen plan');
    check(before.record.state==='planned'&&!before.record.approval_recorded,'No pre-existing approval');
    const wrong=structuredClone(args);wrong.confirmation.plan_hash='0'.repeat(64);
    check((await call('execute_change_set',wrong)).isError,'Wrong exact approval refused natively');
    if(args.confirmation.acknowledgements.length){const missing=structuredClone(args);missing.confirmation.acknowledgements=[];
      check((await call('execute_change_set',missing)).isError,'Required schema acknowledgement refused when absent');}
    data=decode(await call('execute_change_set',args),'Approved native schema execution');
    check(data.record.state==='executed'&&data.record.approval_recorded,'Immediate approved set executed');
    check(validSchemaExecutionResponse(data,a.change_set_id,a.confirmation.plan_hash),'Exact result bound to approved identity/hash');
    const stub=data.record.registration.attestation;
    checks++;assert.deepEqual(stub.client,{name:'Owned schema workflow client',version:'1'});
    checks++;assert.deepEqual(stub.agent,{name:'unknown'});
    check(!stub.human_verified&&stub.statement==='user approved in chat','No invented human verification');
    const replay=decode(await call('execute_change_set',args),'Exact execution retry');
    checks++;assert.deepEqual(replay,data,'Retry retains same native audits, approval, time and item results');
  }
  if(f.mode!=='rollback_preview'){
  check(validSchemaExecutionResponse(data),'Public schema response validates');
  const read=decode(await call('get_changes',{kind:'execution',change_set_id:data.record.envelope.plan.change_set_id}),'Readback');
  checks++;assert.deepEqual(read,data,'MCP read matches the original response');
  process.stdout.write(JSON.stringify({ok:true,checks,record:data.record}));
  }
}finally{await client.close();await transport.close();}
