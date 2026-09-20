import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeSchemaExecution} from './schema-execution-observation.mjs';
const args = {change_set_id:'owned-id', confirmation:{plan_hash:'owned-hash'}, change_token:'SECRET_TOKEN'};
const error = code => ({isError:true, content:[{text:JSON.stringify({code, private:'SECRET_ERROR'})}]});
const record = state => ({content:[{text:JSON.stringify({record:{state, private:'SECRET_RECORD',
  item_results:[{state:'applied',invalidation:'delivered'}, {state:'planned'}]}})}]});
const validate = (data,id,hash) => !!data?.record && id === args.change_set_id && hash === args.confirmation.plan_hash;
for (const code of ['timeout','network_error']) for (const state of ['running','executed','partial']) {
  test(`${code}: one read of ${state}, never another write or replacement success`, async () => {
    const calls=[], failure=error(code);let time=0;
    const result=await observeSchemaExecution(async (name,input) => {
      calls.push({name,input});return calls.length===1?failure:record(state);
    },args,validate,()=>time+=150);
    assert.deepEqual(calls,[{name:'execute_change_set',input:args},
      {name:'get_changes',input:{kind:'execution',change_set_id:args.change_set_id}}]);
    assert.equal(result.response,failure);
    assert.deepEqual(result.observation,{execute_ms:150,outcome:'error',code,
      readback:'verified',state,items:2,applied:1,delivered:1,readback_ms:150});
    assert.ok(!JSON.stringify(result.observation).includes('SECRET'));
  });
}
for (const response of [record('executed'),error('forbidden'),error('schema_capture_rate_limit'),
  {isError:true,content:[{text:'not JSON SECRET'}]},error('bad code SECRET')]) {
  test('ordinary result or refusal adds no status read',async()=>{
    let calls=0;const result=await observeSchemaExecution(async()=>{calls++;return response;},args,validate);
    assert.equal(calls,1);assert.equal(result.response,response);
    assert.equal(result.observation.readback,undefined);assert.ok(!JSON.stringify(result.observation).includes('SECRET'));
  });
}
for (const read of [error('timeout'),{content:[{text:'bad'}]},null]) {
  test('unreadable or unavailable status never implies rollback or success',async()=>{
    let calls=0;const failure=error('timeout');
    const result=await observeSchemaExecution(async()=>{
      if(++calls===1)return failure;if(read===null)throw Error('SECRET');return read;
    },args,validate);
    assert.equal(calls,2);assert.equal(result.response,failure);
    assert.equal(result.observation.state,undefined);
    assert.equal(result.observation.readback,read===null?'unavailable':'unverified');
    assert.ok(!JSON.stringify(result.observation).includes('SECRET'));
  });
}
