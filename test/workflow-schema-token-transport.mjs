/** Real loopback transport: public inverse IDs must not expose private scan receipts. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {WorkflowClient} from '../src/workflow-rest.js';
import {validSchemaExecutionResponse} from '../src/schema-execution.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  item='cccccccc-cccc-4ccc-8ccc-cccccccccccc',hash='a'.repeat(64),token='trsr1.'+'c'.repeat(64),
  packet='trsr1.cHJpdmF0ZS1zeW50aGV0aWMtcmVzdWx0.'+'d'.repeat(64),pat='tamrank_pat_owned_transport_only';
const fixture=()=>({contract_version:1,record:{state:'planned',plan_persisted:true,approval_recorded:false,
  projection:{contract:'schema_execution_view_v1',private_proofs_omitted:true,plan_hash_scope:'complete_stored_plan'},
  envelope:{plan_hash:hash,change_token:token,plan:{contract_version:2,change_set_id:id,kind:'rollback',revision:1,
    client_request_id:'owned-token-transport',risk:'review_required',warning_codes:[],required_scopes:['site:read','meta:write'],
    policy_version:'workflow-schema-rollback-1',created_at:1800000000,expires_at:1800000600,
    result_semantics:'stored_values_restored_not_seo_outcome',frontend_verification:'not_performed',execution_available:true,
    required_acknowledgements:[],binding:{installation_id:other,blog_id:1,operator_id:2,token_id:3,site_origin:'https://owned.invalid'},
    reverses:{change_set_id:other,plan_hash:'b'.repeat(64),execution_id:item,action_id:null},
    items:[{item_id:item,original_item_id:other,original_order:0,audit_id:1,original_operation:'meta.update',operation:'meta.update',
      url:'https://owned.invalid/page',target:{post_id:1},fields:{meta_title:{mode:'set',value:'Original title'}},
      before:{meta_title:'Later title'},after:{meta_title:'Original title'}}]}},registration:null,item_results:[null]}});
const caps={schema_execution:{contract_version:1,available:false,read_available:true,rollback_available:false,recovery_available:false,
  operations:[],record_contract:'schema_execution_view_v1',private_proofs_omitted:true}};
let checks=0,requests=0,reply=fixture(),status=200;
const check=(v,label)=>{checks++;assert.ok(v,label);},equal=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);};
const server=createServer((req,res)=>{requests++;assert.equal(req.headers.authorization,'Bearer '+pat);
  req.resume();res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(reply));});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
  check(validSchemaExecutionResponse(fixture()),'Fixture is an actual closed semantic inverse shape');
  for(const routeStyle of ['pretty','query']){
    const client=new WorkflowClient({siteUrl:'http://127.0.0.1:'+server.address().port,pat,routeStyle});
    reply=fixture();const before=requests;
    const read=await client.get('/changes/executions/'+id);
    equal(read,reply,'Public schema inverse survives real HTTP transport without token corruption');
    check(validSchemaExecutionResponse(read,id,hash),'Scrubbed inverse remains valid for the strict MCP reader');
    equal(requests,before+1,'Exactly one HTTP read');
    const tools=new Map();registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},client,{capabilities:caps});
    const result=await tools.get('get_changes').h({kind:'execution',change_set_id:id});
    check(!result.isError,'Real transport plus canonical get_changes reads the inverse');
    equal(JSON.parse(result.content[0].text),reply,'Whole result reaches the agent unchanged');
    for(const path of ['/changes/executions','/changes/executions/'+other+'/rollback-proposals','/changes/executions/'+id+'/execute']){
      reply=fixture();equal(await client.post(path,{}),reply,'Exact semantic inverse response survives an execution-route POST');
      reply.record.envelope.change_token=packet;
      check(!JSON.stringify(await client.post(path,{})).includes('trsr1.'),'POST route does not exempt a private receipt');
    }

    // Only the verified envelope field is public, never same-value strings elsewhere.
    reply=fixture();reply.record.envelope.plan.items[0].before={note:token,packet,credential:pat,nested:[token,packet],result_receipt:token};
    check(validSchemaExecutionResponse(reply),'Metadata values do not grant an exemption');
    const scrubbed=await client.get('/changes/executions/'+id);
    equal(scrubbed.record.envelope.change_token,token,'Retain only the exact public identifier');
    const values=JSON.stringify(scrubbed.record.envelope.plan.items[0].before);
    check(!values.includes(token)&&!values.includes(packet)&&!values.includes(pat),'Metadata, nested arrays, receipt fields and PATs stay redacted');

    for(const corrupt of [v=>v.record.envelope.change_token=packet,v=>v.record.envelope.change_token=token+'.'+hash,
      v=>v.record.envelope.plan.policy_version='workflow-field-rollback-1',v=>v.record.envelope.plan.kind='forward',
      v=>v.record.projection.private_proofs_omitted=false,v=>delete v.record.projection,v=>v.record.item_results=[],
      v=>v.record.envelope.plan.change_set_id=other,v=>v.record.envelope.plan.schema_storage={private:'hidden'},
      v=>v.record.envelope.change_token=token+'extra']){
      reply=fixture();corrupt(reply);const output=await client.get('/changes/executions/'+id);
      check(!JSON.stringify(output).includes('trsr1.'),'Invalid/wrong-record native envelopes get no token exception');
    }
    for(const path of ['/changes/'+id,'/scans/executions/'+id,'/capabilities']){
      reply=fixture();reply.contract_version=2;
      const output=await client.get(path);check(!JSON.stringify(output).includes('trsr1.'),'No exception on another API route');
    }
    reply={contract_version:2,items:[{result_receipt:packet,description:token,nested:{[packet]:packet}}]};
    check(!JSON.stringify(await client.get('/signals')).includes('trsr1.'),'Generic reads still redact private receipts and keys');
    for(const message of [token,packet])for(const data of [{},{result_receipt:packet}]){
      status=409;reply={code:'owned_refusal',message,data};
      checks++;await assert.rejects(client.get('/changes/executions/'+id),e=>e.code==='owned_refusal'
        &&!String(e.message).includes('trsr1.')&&!JSON.stringify(e).includes('trsr1.'));
    }
    status=200;reply=fixture();
    equal((await client.get('/changes/executions/'+id)).record.envelope.change_token,token,'An earlier error cannot change a later verified read');
  }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log(`PASS: ${checks} schema rollback token/receipt isolation, real transport and canonical read checks.`);
