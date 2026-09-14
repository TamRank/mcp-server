import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerWorkflowTools} from '../src/workflow-tools.js';
const support={specialist_reads:{start_scan:{available:true,modes:['preview'],types:['pagespeed','index']}}};
function registry(capabilities=support,options={}){
  const tools=new Map(),calls=[];
  registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},
    {get:async(p,a)=>{calls.push(['GET',p,a]);return {type:'index',mode:'preview',execution_enabled:false};},
      post:async(p,a)=>{calls.push(['POST',p,a]);throw new Error('Unexpected write');}},
    {profile:'specialist',preflight:{ok:true},capabilities,...options});
  return {tools,calls};
}
const args={mode:'preview',type:'index',post_ids:[205,1]};
test('Exact index preview uses the existing specialist tool and only GET',async()=>{
  const r=registry();assert.equal(r.tools.size,20);
  const out=await r.tools.get('start_scan').h(args);assert.ok(!out.isError);
  assert.deepEqual(r.calls,[['GET','/scans/preview',{type:'index',post_ids:'205,1'}]]);
  assert.equal(JSON.parse(out.content[0].text).execution_enabled,false);
  const revision='a'.repeat(64);await r.tools.get('start_scan').h({...args,expected_revision:revision});
  assert.equal(r.calls[1][2].expected_revision,revision);
  const ids=Array.from({length:25},(_,i)=>i+1);await r.tools.get('start_scan').h({...args,post_ids:ids});
  assert.equal(r.calls[2][2].post_ids,ids.join(','));
});
test('Index never enters plan, approval, PageSpeed, schema or legacy execution lanes',async()=>{
  const r=registry(),h=r.tools.get('start_scan').h;
  for(const a of [{...args,mode:'plan'},{...args,mode:'run'},{...args,post_ids:undefined},
    {...args,post_ids:[]},{...args,post_ids:[1,1]},{...args,post_ids:[0]},
    {...args,post_ids:Array.from({length:26},(_,i)=>i+1)},
    {...args,client_request_id:'new-index-job'},{...args,capture_mode:'native_render'},{...args,probe_content:true},
    {...args,force:true},{...args,expected_revision:'bad'},
    {...args,proposal_id:'11111111-1111-4111-8111-111111111111'},
    {...args,source_job_id:'11111111-1111-4111-8111-111111111111'},
    {...args,confirmation:{confirmed:true}}])assert.equal((await h(a)).isError,true,JSON.stringify(a));
  assert.equal(r.calls.length,0);
});
test('Unknown, old, disabled and malformed site capabilities refuse before sending',async()=>{
  for(const capabilities of [null,{},
    {specialist_reads:{start_scan:{available:true,modes:['preview']}}},
    {specialist_reads:{start_scan:{available:true,modes:['preview'],types:['pagespeed']}}},
    {specialist_reads:{start_scan:{available:true,modes:['preview'],types:'index'}}},
    {specialist_reads:{start_scan:{available:false,modes:['preview'],types:['index']}}},
    {specialist_reads:{start_scan:{available:true,modes:[],types:['index']}}}]){
    const r=registry(capabilities);assert.equal((await r.tools.get('start_scan').h(args)).isError,true);assert.equal(r.calls.length,0);
  }
  for(const options of [{preflight:{ok:false}},{maintenanceOnly:true}]){
    const r=registry(support,options);assert.equal((await r.tools.get('start_scan').h(args)).isError,true);assert.equal(r.calls.length,0);
  }
});
