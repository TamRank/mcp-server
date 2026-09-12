/** Disposable package installation. Offline by default; --allow-network permits registry downloads. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { ownedInstalledRuntime } from './owned-installed-entry.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile);
const npm=resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const online=process.argv.includes('--allow-network');
const nativeFields=process.argv.includes('--native-fields');
const nativeReads=process.argv.includes('--native-reads');
const nativeScans=process.argv.includes('--native-scans');
const nativeRedirects=process.argv.includes('--native-redirects'),nativeSchema=process.argv.includes('--native-schema');
const nativeCases=[
  ...(nativeScans?[['pagespeed-scans','native PageSpeed MCP checks']]:[]),
  ...(nativeReads?[['stored-reads','full stored-read native WordPress/PAT/MCP matrix']]:[]),
  ...(nativeFields?[['field-execution-tls','native field execution MCP/WordPress TLS/lost-response checks']]:[]),
  ...(nativeRedirects?[
    ['redirect-execution-mcp','native redirect/mixed MCP/WordPress TLS, rollback and worker-recovery checks'],
    ['redirect-recovery-mcp','native redirect/mixed MCP/TLS inverse-worker and all-applied recovery checks'],
    ['redirect-batch-mcp','native redirect/mixed MCP/TLS full-batch and Action-origin checks']]:[]),
  ...(nativeSchema?[
    ['schema-rollback-mcp','native schema forward and inverse comparison/proposal/approval/execution over MCP/TLS'],
    ['schema-recovery-mcp','native schema worker interruption and fresh journal recovery over MCP/TLS'],
    ['schema-recovery-mixed-mcp','native schema worker interruption and fresh journal recovery over MCP/TLS'],
    ['schema-recovery-authority-mcp','native schema recovery checks with token/scope/membership/entitlement changed after preview on the same MCP session']]:[])
];
assert.ok(process.argv.slice(2).every(arg=>['--allow-network','--native-reads','--native-scans','--native-fields','--native-redirects','--native-schema'].includes(arg)),'Unknown installation-test argument');
let nativePro;
if(nativeCases.length){
  for(const key of ['TAMRANK_MAINT_PRO','TAMRANK_MAINT_CORE','TAMRANK_MAINT_FREE','TAMRANK_SCAN_TEST_SOCKET'])assert.ok(process.env[key],`Explicit owned native setting required: ${key}`);
  nativePro=await realpath(process.env.TAMRANK_MAINT_PRO);
  assert.match(process.env.TAMRANK_SCAN_TEST_SOCKET,/^\/private\/tmp\/tr-scan-mysql\.[A-Za-z0-9]{6}\/mysql.sock$/);
}
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
assert.ok(Object.values(lock.packages).every(entry=>!entry.resolved || new URL(entry.resolved).origin==='https://registry.npmjs.org'),'Only the official package registry is permitted');
const before=await Promise.all(['package.json','package-lock.json','index.js'].map(p=>readFile(join(root,p),'utf8')));
const pat='tamrank_pat_fixture_'+randomBytes(16).toString('hex');
const requests=[];let server;
const scratch=await mkdtemp(join(tmpdir(),'tamrank-package-'));
const environment={PATH:process.env.PATH,HOME:homedir(),npm_config_offline:online?'false':'true',npm_config_ignore_scripts:'true',
  npm_config_userconfig:join(scratch,'empty.npmrc'),npm_config_globalconfig:join(scratch,'empty-global.npmrc'),
  npm_config_logs_dir:join(scratch,'npm-logs')};
if(online)environment.npm_config_cache=join(scratch,'npm-cache');
try {
  const packed=JSON.parse((await run(process.execPath,[npm,'pack','--ignore-scripts','--offline','--json','--pack-destination',scratch],
    {cwd:root,env:environment,timeout:60000,maxBuffer:1048576})).stdout)[0];
  assert.equal(packed.name,pkg.name);assert.equal(packed.version,pkg.version);
  assert.equal(packed.filename,packed.filename.split('/').pop());
  const paths=packed.files.map(f=>f.path);
  for(const p of ['src/source-scans.js','src/pagespeed-scans.js','src/workflow-identity.js'])assert.ok(paths.includes(p),`Missing packed ${p}`);
  assert.ok(paths.includes('src/field-proposals.js'),'Typed field proposal contract is packaged');
  for(const p of ['src/field-execution.js','src/field-recovery.js','src/redirect-execution.js'])assert.ok(paths.includes(p),`Missing typed execution contract ${p}`);
  for(const p of ['src/schema-preview.js','src/schema-execution.js','src/schema-rollback.js','src/schema-recovery.js'])
    assert.ok(paths.includes(p),`Missing typed schema workflow contract ${p}`);
  for(const p of ['index.js','index-workflow.js','receipt-storage.js','src/workflow-tools.js','src/workflow-rest.js','src/scan-maintenance.js','src/scan-recovery-chat.js','src/scan-receipt-store.js','SCAN-RECEIPTS.md','WORKFLOW-PREVIEW.md','package.json'])assert.ok(paths.includes(p),`Missing packed ${p}`);
  assert.ok(paths.every(p=>!p.split('/').some(s=>s==='..' || s.startsWith('.')) && !/^(?:test|node_modules|docs)\//.test(p)), 'No test fixtures, credentials or hidden configuration in package');
  await run('tar',['-xzf',join(scratch,packed.filename),'-C',scratch],{timeout:10000});
  const installed=await realpath(join(scratch,'package'));
  const privateDirectory=join(await realpath(scratch),'receipt-storage');
  const setup=await run(process.execPath,[join(installed,'receipt-storage.js'),'init','--directory',privateDirectory],{env:environment});
  assert.equal(JSON.parse(setup.stdout).created,true);
  const inventory=await run(process.execPath,[join(installed,'receipt-storage.js'),'list','--directory',privateDirectory,'--site','https://fixture.invalid'],{env:environment});
  assert.deepEqual(JSON.parse(inventory.stdout).items,[]);
  // npm excludes package-lock.json from archives. Supply the existing repository
  // lock only to this fixture, proving packaged code with known dependencies.
  // This is not a fresh registry dependency-resolution/install guarantee.
  await writeFile(join(installed,'package-lock.json'),before[1]);
  await run(process.execPath,[npm,'ci',...(online?[]:['--offline']),'--ignore-scripts','--no-audit','--no-fund'],
    {cwd:installed,env:environment,timeout:60000,maxBuffer:1048576});
  const installedPkg=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
  assert.equal(installedPkg.version,pkg.version);assert.deepEqual(installedPkg.bin,pkg.bin);
  const localRequire=createRequire(join(installed,'package.json'));
  const {Client}=await import(pathToFileURL(localRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const {StdioClientTransport}=await import(pathToFileURL(localRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const specialists=['get_gsc_pages','get_redirects','get_images_missing_alt','get_site_diagnostics','get_topical_authority','get_scan_status'];
  const capabilities={contract_version:2,full_v2_compatible:false,execution_enabled:false,
    reads:{get_site_context:{available:true}},specialist_reads:Object.fromEntries(specialists.map(name=>[name,{available:true}]))};
  capabilities.specialist_reads.start_scan={available:true,modes:['preview'],execution_enabled:false};
  capabilities.scan_proposals={available:true,read_available:true,modes:['plan'],execution_enabled:false};
  capabilities.field_proposals={available:true,read_available:true,contract_version:2,operations:['meta.update','image_alt.update'],origin_kinds:['user_request']};
  const proposalId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const fieldRequest={client_request_id:'package-fields-0001',origin:{kind:'user_request',reference:'synthetic',summary:'Synthetic metadata request'},
    items:[{operation:'meta.update',target:{post_id:1},fields:{meta_title:{mode:'set',value:'Café'}}}]};
  server=createServer(async(req,res)=>{
    requests.push({method:req.method,url:req.url});
    assert.equal(req.headers.authorization,'Bearer '+pat);
    const url=new URL(req.url,'http://127.0.0.1');
    const route=url.searchParams.get('rest_route') || url.pathname.replace('/wp-json','');
    assert.ok(['/tamrank/v2/capabilities','/tamrank/v2/site/context','/tamrank/v2/site/diagnostics','/tamrank/v2/scans/status','/tamrank/v2/scans/preview',
      '/tamrank/v2/scans/proposals','/tamrank/v2/scans/proposals/'+proposalId,'/tamrank/v2/scans/maintenance/capabilities','/tamrank/v2/scans/sources/capabilities',
      '/tamrank/v2/scans/executions/capabilities','/tamrank/v2/changes/proposals','/tamrank/v2/changes/'+proposalId].includes(route),'No legacy REST fallback');
    if(route==='/tamrank/v2/changes/proposals'){
      assert.equal(req.method,'POST');let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),fieldRequest);
    }else if(route==='/tamrank/v2/scans/proposals') {
      assert.equal(req.method,'POST');let body='';for await(const chunk of req)body+=chunk;
      assert.deepEqual(JSON.parse(body),{type:'pagespeed',post_ids:[205,1],expected_revision:'a'.repeat(64),client_request_id:'package-scan-draft-0001'});
    } else assert.equal(req.method,'GET','Only explicit draft storage may POST');
    if(route.endsWith('/scans/preview')) {
      assert.equal(url.searchParams.get('type'),'pagespeed');assert.equal(url.searchParams.get('post_ids'),'205,1');
      assert.equal(url.searchParams.has('mode'),false);
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(route.endsWith('/capabilities')?capabilities:{contract_version:2,fixture:true,product_writes_performed:false}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  async function session(profile,style,preview=true) {
    const transport=new StdioClientTransport({command:process.execPath,args:[join(installed,'index-workflow.js')],cwd:installed,
      env:{PATH:process.env.PATH,TAMRANK_PAT:pat,TAMRANK_SITE_URL:url,TAMRANK_TOOL_PROFILE:profile,TAMRANK_REST_STYLE:style,
        TAMRANK_WORKFLOW_PREVIEW:preview?'1':'0'},stderr:'pipe'});
    let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk;});
    const client=new Client({name:'tamrank-package-fixture',version:'1.0.0'});
    try {
      await client.connect(transport);
      const listed=await client.listTools();assert.equal(listed.tools.length,{core:12,specialist:20,legacy:42}[profile]);
      assert.ok(!JSON.stringify(listed).includes(pat));assert.ok(!(client.getInstructions() || '').includes(pat));
      let n=requests.length;
      const blocked=await client.callTool({name:profile==='legacy'?'update_meta':'execute_change_set',arguments:{}});
      assert.equal(blocked.isError,true);assert.equal(requests.length,n);
      if(!preview){assert.equal((await client.callTool({name:'get_site_context',arguments:{}})).isError,true);assert.equal(requests.length,n);}
      else if(profile!=='legacy') {
        assert.ok(!(await client.callTool({name:'plan_changes',arguments:fieldRequest})).isError);
        assert.ok(!(await client.callTool({name:'get_changes',arguments:{change_set_id:proposalId}})).isError);
        const read=await client.callTool({name:'get_site_context',arguments:{}});
        assert.ok(!read.isError);assert.equal(JSON.parse(read.content[0].text).fixture,true);
        if(profile==='specialist') {
          assert.ok(!(await client.callTool({name:'get_site_diagnostics',arguments:{section:'metadata',limit:50}})).isError);
          assert.ok(!(await client.callTool({name:'get_scan_status',arguments:{type:'index'}})).isError);
          assert.ok(!(await client.callTool({name:'start_scan',arguments:{mode:'preview',type:'pagespeed',post_ids:[205,1]}})).isError);
          assert.ok(!(await client.callTool({name:'start_scan',arguments:{mode:'plan',type:'pagespeed',post_ids:[205,1],
            expected_revision:'a'.repeat(64),client_request_id:'package-scan-draft-0001'}})).isError);
          assert.ok(!(await client.callTool({name:'get_scan_status',arguments:{proposal_id:proposalId}})).isError);
          n=requests.length;assert.equal((await client.callTool({name:'start_scan',arguments:{}})).isError,true);assert.equal(requests.length,n);
        }
      }
    } finally {await client.close();}
    assert.ok(!stderr.includes(pat),'No fixture token in stderr');
  }
  for(const profile of ['core','specialist','legacy'])for(const style of ['pretty','query'])await session(profile,style);
  await session('core','pretty',false);
  if(nativeCases.length){
    await writeFile(join(scratch,'owned-native-package.json'),JSON.stringify({source_root:await realpath(root),package_root:installed,
      package_version:pkg.version,entry_sha256:createHash('sha256').update(await readFile(join(installed,'index-workflow.js'))).digest('hex')}),{mode:0o600});
    assert.equal(ownedInstalledRuntime(root,installed),installed,'Native transport selects the extracted package');
    assert.throws(()=>ownedInstalledRuntime(root,''),'Empty package override cannot fall back to source');
    assert.throws(()=>ownedInstalledRuntime(root,root),'Checkout cannot masquerade as installed package');
    for(const [mode,expected] of nativeCases){
      const reads=mode==='stored-reads',scans=mode==='pagespeed-scans';
      console.log('RUN INSTALLED: '+mode+' → extracted entry → '+(reads||scans?'owned HTTP':'verified TLS')+' → owned WordPress.');
      const nativeArgs=scans?[join(root,'test/workflow-pagespeed-native.mjs')]:reads?[join(nativePro,'docs/mcp-phase4e-read-wordpress.mjs')]:[join(nativePro,'docs/mcp-phase4c-change-store-wordpress.mjs'),'--'+mode];
      const nativeRun=run(process.execPath,nativeArgs,
        {cwd:nativePro,env:{...process.env,TAMRANK_MAINT_MCP:root,TAMRANK_TEST_PACKED_ROOT:installed},timeout:1800000,maxBuffer:2097152});
      nativeRun.child.stdout.pipe(process.stdout,{end:false});
      const native=await nativeRun;
      assert.ok(scans?native.stdout.split('\n').some(line=>/^PASS: \d+ /.test(line)&&line.includes(expected+'; installed entry;')&&line.endsWith('owned databases removed.')):
        reads?native.stdout.includes('PASS: '+expected+'; owned database removed.'):
        native.stdout.split('\n').some(line=>/^PASS: \d+ /.test(line)&&line.includes(expected)&&line.endsWith('owned databases removed.')),
        'Full native matrix must complete with owned cleanup: '+mode);
      console.log('PASS INSTALLED: '+mode+'; extracted entry and separately installed dependencies; no checkout-runtime fallback.');
    }
    console.log('NATIVE PACKAGE OK: '+nativeCases.map(([mode])=>mode).join(', '));
  }
  assert.deepEqual(await Promise.all(['package.json','package-lock.json','index.js'].map(p=>readFile(join(root,p),'utf8'))),before,'Packaging must not modify source manifest, lock or shipped entry');
  console.log(`WORKFLOW PACKAGE OK: extracted tarball with ${online?'clean-cache':'offline'} npm ci using repository lock; installed entry, 12/20/42 profiles, both REST forms, scan preview/private draft mapping; baseline writers disabled${nativeCases.length?'; selected native matrices passed':''}. Source and active installation untouched; unconstrained registry resolution untested.`);
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  // Only the exact directory created by this test; never a supplied path or a parent.
  await rm(scratch,{recursive:true,force:true});
}
