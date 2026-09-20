/** Closed schema-draft admission; malformed/unavailable inputs send nothing. */
import assert from 'node:assert/strict';
import {registerWorkflowTools} from '../src/workflow-tools.js';
const hash='a'.repeat(64),source={job_id:'11111111-1111-4111-8111-111111111111',revision:hash};
const base={client_request_id:'schema-draft-unit',origin:{kind:'user_request',reference:'owned',summary:'Explicit synthetic proposal'},items:[
  {operation:'schema.detect',target:{post_id:1},fields:{source_job:source,expected_revision:hash}}]};
const caps={schema_preview:{available:true,contract_version:2,schema_proposals_available:true},field_proposals:{available:true,read_available:true,contract_version:2,
  operations:['schema.select','schema.detect','schema_settings.update','meta.update'],origin_kinds:['user_request','action']}};
const registry=(capabilities=caps)=>{const tools=new Map(),calls=[];
  registerWorkflowTools({registerTool:(n,c,h)=>tools.set(n,{c,h})},{post:async(path,body)=>{calls.push({path,body});return {contract_version:2};}}, {capabilities});return {tools,calls};};
const {tools,calls}=registry();
const selected={...base,items:[{operation:'schema.select',target:{post_id:1},fields:{source_job:source,expected_revision:hash,main_type:'Article',extra_types:['FAQPage'],replace_manual:true}}]};
const identity={...base,items:[{operation:'schema_settings.update',target:{site:'current',sample_post_id:1},fields:{source_job:source,expected_revision:hash,facts_confirmed:true,fields:{organization_name:'Synthetic business'}}}]};
for(const a of [base,selected,identity]){assert.ok(!(await tools.get('plan_changes').h(a)).isError);assert.deepEqual(calls.pop(),{path:'/changes/proposals',body:a});}
const action={kind:'action',action_id:source.job_id,revision:1,snapshot_hash:hash};
const mixed={...base,items:[base.items[0],{operation:'meta.update',target:{post_id:2},fields:{meta_title:{mode:'set',value:'Synthetic'}}}]};
assert.ok(!(await tools.get('plan_changes').h(mixed)).isError);calls.pop();
const bads=[{...identity,origin:action},{...identity,items:[...identity.items,...base.items]},
  {...mixed,items:[base.items[0],{...mixed.items[1],target:{post_id:1}}]},
  {...base,items:[base.items[0],base.items[0]]},{...base,schema_preview:base.items[0]},
  {...base,approved:true},{...base,items:Array(26).fill(base.items[0])}];
for(const change of [x=>delete x.fields.expected_revision,x=>x.fields.expected_revision='bad',x=>x.fields.graph={},
  x=>x.target.post_id=0,x=>x.target.post_id=1.5,x=>x.fields.source_job.url='https://other.invalid',
  x=>x.operation='body.update']){const bad=structuredClone(base);change(bad.items[0]);bads.push(bad);}
for(const a of bads){assert.equal((await tools.get('plan_changes').h(a)).isError,true);assert.equal(calls.length,0);}
for(const capabilities of [null,{...caps,schema_preview:{...caps.schema_preview,schema_proposals_available:false}},
  {...caps,field_proposals:{...caps.field_proposals,available:false}},
  {...caps,field_proposals:{...caps.field_proposals,operations:['meta.update']}}]){
  const r=registry(capabilities);assert.equal((await r.tools.get('plan_changes').h(base)).isError,true);assert.equal(r.calls.length,0);
}
console.log('PASS: schema draft exact revisions, typed operations, site identity origin, mixed target dedupe and capability gates.');
