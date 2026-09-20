/** Bridge contract only: HTTP responses are synthetic, not native source captures. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {WorkflowClient} from '../src/workflow-rest.js';
import {registerWorkflowTools} from '../src/workflow-tools.js';
import {sourceAcks} from '../src/source-scans.js';

test('Source quota snapshots and bounded refusals traverse existing specialist tools without retry or new tools', async()=>{
  const id='11111111-1111-4111-8111-111111111111', hash='a'.repeat(64), requests=[];
  let remaining=0, wait=3601, retry=3600;
  const budget=()=>({policy:'schema-source-hourly-advice-1',window_seconds:3600,owner_limit:10,site_limit:30,
    remaining_requests:remaining,observed_at:1789399200,next_attempt_after:1789399200+wait,retry_after_seconds:wait,
    is_reservation:false,automatic_retry:false});
  const support={available:true,read_available:true,execute_available:true,modes:['preview','plan','run']};
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const route=url.searchParams.get('rest_route')||url.pathname.replace('/wp-json','');
    requests.push([req.method,route]);
    res.setHeader('Content-Type','application/json');
    if(route==='/tamrank/v2/scans/sources/'+id+'/run'){
      res.statusCode=429;
      res.end(JSON.stringify({code:'schema_capture_rate_limit',message:'Source request refused.',
        data:{status:429,...(retry===undefined?{}:{retry_after:retry}),automatic_retry:true,
          hourly_budget:budget(),operator_id:987,source_body:'PRIVATE_TEST_ONLY'}}));
    }else if(route==='/tamrank/v2/scans/sources/capabilities'){
      res.end(JSON.stringify({contract_version:2,schema_source_jobs:{...support,hourly_budget:budget()}}));
    }else res.end(JSON.stringify({contract_version:2,full_v2_compatible:false}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const routeStyle of ['pretty','query']){
      const tools=new Map();
      registerWorkflowTools({registerTool:(name,config,handler)=>tools.set(name,{config,handler})},
        new WorkflowClient({siteUrl:'http://127.0.0.1:'+server.address().port,pat:'synthetic-only',routeStyle}),
        {profile:'specialist',capabilities:{schema_source_jobs:support}});
      assert.equal(tools.size,20);
      const read=async()=>{
        const result=await tools.get('get_capabilities').handler({});assert.ok(!result.isError);
        const data=JSON.parse(result.content[0].text);
        assert.deepEqual(data.schema_source_jobs.hourly_budget,budget());
      };
      const run={type:'schema_source',mode:'run',source_job_id:id,client_request_id:'budget-source-run-01',
        confirmation:{plan_hash:hash,confirmed:true,agent:'Synthetic agent',acknowledgements:sourceAcks}};
      remaining=0;wait=3601;retry=3600;await read();
      for(const seconds of [1,125,3600,undefined,0,'3600',3601]){
        retry=seconds;const before=requests.length;
        const result=await tools.get('start_scan').handler(run),data=JSON.parse(result.content[0].text);
        assert.equal(result.isError,true);assert.equal(data.code,'schema_capture_rate_limit');
        assert.equal(requests.length,before+1,'One explicit attempt, no hidden retry or replacement job');
        assert.deepEqual(requests.at(-1),['POST','/tamrank/v2/scans/sources/'+id+'/run']);
        assert.equal(data.retry_after,Number.isInteger(seconds)&&seconds>=1&&seconds<=3600?seconds:undefined);
        assert.notEqual(data.automatic_retry,true);
        for(const key of ['operator_id','source_body','hourly_budget'])assert.equal(data[key],undefined,'Error advice whitelist remains intact');
        assert.ok(!result.content[0].text.includes('PRIVATE_TEST_ONLY'));
      }
      remaining=3;wait=0;await read();
      remaining=0;wait=125;retry=125;
      const before=requests.length,refused=await tools.get('start_scan').handler(run);
      assert.equal(refused.isError,true);assert.equal(requests.length,before+1,'An earlier capacity snapshot is never an execution guarantee');
      await read();
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
