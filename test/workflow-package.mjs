/** Disposable package installation. Offline by default; --allow-network permits registry downloads. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile), scratch=await mkdtemp(join(tmpdir(),'tamrank-package-'));
const npm=resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const online=process.argv.includes('--allow-network');
assert.ok(process.argv.slice(2).every(arg=>arg==='--allow-network'),'Unknown installation-test argument');
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
assert.ok(Object.values(lock.packages).every(entry=>!entry.resolved || new URL(entry.resolved).origin==='https://registry.npmjs.org'),'Only the official package registry is permitted');
const before=await Promise.all(['package.json','package-lock.json','index.js'].map(p=>readFile(join(root,p),'utf8')));
const pat='tamrank_pat_fixture_'+randomBytes(16).toString('hex');
const requests=[];let server;
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
  for(const p of ['index.js','index-workflow.js','src/workflow-tools.js','src/workflow-rest.js','WORKFLOW-PREVIEW.md','package.json'])assert.ok(paths.includes(p),`Missing packed ${p}`);
  assert.ok(paths.every(p=>!p.split('/').some(s=>s==='..' || s.startsWith('.')) && !/^(?:test|node_modules|docs)\//.test(p)), 'No test fixtures, credentials or hidden configuration in package');
  await run('tar',['-xzf',join(scratch,packed.filename),'-C',scratch],{timeout:10000});
  const installed=join(scratch,'package');
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
  server=createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});
    assert.equal(req.method,'GET','No writer or implicit POST during package test');
    assert.equal(req.headers.authorization,'Bearer '+pat);
    const url=new URL(req.url,'http://127.0.0.1');
    const route=url.searchParams.get('rest_route') || url.pathname.replace('/wp-json','');
    assert.ok(['/tamrank/v2/capabilities','/tamrank/v2/site/context','/tamrank/v2/site/diagnostics','/tamrank/v2/scans/status','/tamrank/v2/scans/preview'].includes(route),'No legacy REST fallback');
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
      const listed=await client.listTools();assert.equal(listed.tools.length,{core:12,specialist:19,legacy:42}[profile]);
      assert.ok(!JSON.stringify(listed).includes(pat));assert.ok(!(client.getInstructions() || '').includes(pat));
      let n=requests.length;
      const blocked=await client.callTool({name:profile==='legacy'?'update_meta':'execute_change_set',arguments:{}});
      assert.equal(blocked.isError,true);assert.equal(requests.length,n);
      if(!preview){assert.equal((await client.callTool({name:'get_site_context',arguments:{}})).isError,true);assert.equal(requests.length,n);}
      else if(profile!=='legacy') {
        const read=await client.callTool({name:'get_site_context',arguments:{}});
        assert.ok(!read.isError);assert.equal(JSON.parse(read.content[0].text).fixture,true);
        if(profile==='specialist') {
          assert.ok(!(await client.callTool({name:'get_site_diagnostics',arguments:{section:'metadata',limit:50}})).isError);
          assert.ok(!(await client.callTool({name:'get_scan_status',arguments:{type:'index'}})).isError);
          assert.ok(!(await client.callTool({name:'start_scan',arguments:{mode:'preview',type:'pagespeed',post_ids:[205,1]}})).isError);
          n=requests.length;assert.equal((await client.callTool({name:'start_scan',arguments:{}})).isError,true);assert.equal(requests.length,n);
        }
      }
    } finally {await client.close();}
    assert.ok(!stderr.includes(pat),'No fixture token in stderr');
  }
  for(const profile of ['core','specialist','legacy'])for(const style of ['pretty','query'])await session(profile,style);
  await session('core','pretty',false);
  assert.deepEqual(await Promise.all(['package.json','package-lock.json','index.js'].map(p=>readFile(join(root,p),'utf8'))),before,'Packaging must not modify source manifest, lock or shipped entry');
  console.log(`WORKFLOW PACKAGE OK: extracted tarball with ${online?'clean-cache':'offline'} npm ci using repository lock; installed dependencies/entry, 12/19/42 profiles, both REST forms, read-only scan preview, unavailable writes/scan execution; source and active installation untouched. Fresh unconstrained registry resolution remains untested.`);
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  // Only the exact directory created by this test; never a supplied path or a parent.
  await rm(scratch,{recursive:true,force:true});
}
