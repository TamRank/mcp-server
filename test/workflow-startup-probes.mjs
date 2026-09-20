/** Specialist-preview startup: the gated optional lanes share one window, and share no failure. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverWorkflows} from '../src/scan-maintenance.js';
import {pagespeedRoute,pagespeedPolicy} from '../src/pagespeed-scans.js';

const capabilitiesRoute='/capabilities',maintenanceRoute='/scans/maintenance/capabilities';
const sourceRoute='/scans/sources/capabilities',pagespeedCapabilities=pagespeedRoute+'/capabilities';
const recoveryRoute='/scans/recovery/capabilities';
const optional=[sourceRoute,pagespeedCapabilities,recoveryRoute];
const sourceSupport={available:true,read_available:true,execute_available:true,modes:['preview','plan','run']};
const pagespeedExecution={available:true,plan_available:true,read_available:true,route:pagespeedRoute,proposal_policy:pagespeedPolicy,
  max_targets:25,attempts_per_device:1,devices:['mobile','desktop'],automatic_retries:0,approval:'chat_attested',
  scheduling:'wp_cron',requires_cron_delivery:true,external_requests_reversible:false,results:'private_scan_progress',legacy_cache_writes:false};
const recoverySupport={chat_review_contract:1,receipt_review_available:true,settlement_available:true};
const sourceClosed={available:false,read_available:false,execute_available:false};
const pagespeedClosed={available:false,plan_available:false,read_available:false};
const specialist={preview:true,profile:'specialist'};

/** Opens only once every gated probe has arrived, so serial discovery can never pass it. No clock. */
function barrier(count) {
  let arrived=0,open;
  const gate=new Promise(resolve=>{open=resolve;});
  return {count:()=>arrived,async wait(){if(++arrived===count)open();await gate;}};
}

function site({fail=[],hold=null}={}) {
  const calls=[];
  return {calls,get:async path=>{
    calls.push(path);
    if(hold && optional.includes(path))await hold.wait();
    if(fail.includes(path))throw Object.assign(new Error('Fixture probe refusal'),{code:'network_error',status:503});
    if(path===capabilitiesRoute)return {contract_version:2,full_v2_compatible:true};
    if(path===maintenanceRoute)return {contract_version:2,scan_maintenance:{available:false,read_available:false}};
    if(path===sourceRoute)return {contract_version:2,schema_source_jobs:sourceSupport};
    if(path===pagespeedCapabilities)return {contract_version:2,pagespeed_execution:pagespeedExecution};
    if(path===recoveryRoute)return {scan_recovery:recoverySupport};
    throw new Error('Unexpected route '+path);
  }};
}

test('The gated optional probes share one startup window instead of adding their timeouts',async()=>{
  const hold=barrier(optional.length),client=site({hold});
  // The barrier, not a stopwatch: every gated probe must already be in flight before any may answer.
  // Serial discovery leaves it shut forever, so the deadline below is a failure message, not a budget.
  let deadline;
  const stuck=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error(
    `Only ${hold.count()} of ${optional.length} optional probes had started; serial discovery cannot open the barrier`)),10000);});
  let discovery;
  try {discovery=await Promise.race([discoverWorkflows(client,specialist),stuck]);}
  finally {clearTimeout(deadline);}
  assert.deepEqual(discovery.capabilities.schema_source_jobs,sourceSupport);
  assert.deepEqual(discovery.capabilities.pagespeed_execution,pagespeedExecution);
  assert.deepEqual(discovery.recoverySupport,recoverySupport);
  for(const route of optional)assert.equal(client.calls.filter(path=>path===route).length,1,route+' is asked exactly once');
});

test('The required probes keep their order, and a maintenance-only site asks no optional route',async()=>{
  const ordered=site();
  await discoverWorkflows(ordered,specialist);
  assert.deepEqual(ordered.calls.slice(0,2),[capabilitiesRoute,maintenanceRoute]);
  assert.deepEqual([...ordered.calls].slice(2).sort(),[...optional].sort());
  const denied={calls:[],get:async path=>{
    denied.calls.push(path);
    if(path===capabilitiesRoute)throw Object.assign(new Error(),{code:'pro_required',status:402});
    if(path===maintenanceRoute)return {contract_version:2,scan_maintenance:{available:true,read_available:true}};
    throw new Error('Unexpected route '+path);
  }};
  const discovery=await discoverWorkflows(denied,specialist);
  assert.equal(discovery.maintenanceOnly,true);
  assert.equal(discovery.recoverySupport,null);
  assert.deepEqual(denied.calls,[capabilitiesRoute,maintenanceRoute]);
  for(const options of [{preview:true,profile:'core'},{preview:false,profile:'specialist'},{preview:true,profile:'legacy'}]){
    const other=site();
    const quiet=await discoverWorkflows(other,options);
    assert.equal(quiet.recoverySupport,null);
    for(const route of optional)assert.ok(!other.calls.includes(route),route+' stays unasked for '+JSON.stringify(options));
  }
});

test('One refused lane keeps its own closed answer and never removes the others',async()=>{
  for(const route of optional){
    const client=site({fail:[route]});
    const {capabilities,recoverySupport:recovery,preflight}=await discoverWorkflows(client,specialist);
    assert.equal(preflight.ok,true,route+' may not close the primary lane');
    assert.deepEqual(capabilities.schema_source_jobs,route===sourceRoute?sourceClosed:sourceSupport);
    assert.deepEqual(capabilities.pagespeed_execution,route===pagespeedCapabilities?pagespeedClosed:pagespeedExecution);
    assert.deepEqual(recovery,route===recoveryRoute?null:recoverySupport);
    for(const asked of optional)assert.ok(client.calls.includes(asked),asked+' still runs while '+route+' fails');
  }
  const allDown=site({fail:optional});
  const {capabilities,recoverySupport:recovery}=await discoverWorkflows(allDown,specialist);
  assert.deepEqual(capabilities.schema_source_jobs,sourceClosed);
  assert.deepEqual(capabilities.pagespeed_execution,pagespeedClosed);
  assert.equal(recovery,null);
});
