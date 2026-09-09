import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,stat,readFile,readdir,writeFile,symlink,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ScanReceiptStore,initializeReceiptDirectory} from '../src/scan-receipt-store.js';
const site='https://fixture.invalid/client-a',execution='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const input={site_url:site,execution_id:execution,measurement_id:'a'.repeat(64),attempt_request_id:'local-attempt-0001',
  attempt_runtime_hash:'b'.repeat(64),result_receipt:'trsr1.cHJpdmF0ZQ.'+'c'.repeat(64)};
const context={site_url:site,execution_id:execution};
await test('Explicit local receipt lifecycle; exact private files only, no provider',async t=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'tamrank-receipt-cli-')),directory=join(root,'store');
  const cli=(...args)=>{const r=spawnSync(process.execPath,['receipt-storage.js',...args],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000});
    assert.ok(!r.stdout.includes('trsr1.') && !r.stderr.includes('trsr1.') && !r.stderr.includes(root));return r;};
  let store,ref,before;
  try{
    await t.test('Setup is explicit, exclusive and private; duplicate/relative/symlink/unsafe parents refused',async()=>{
      assert.equal(cli('init','--directory',directory).status,0);store=new ScanReceiptStore({directory});
      assert.equal((await stat(directory)).mode&0o777,0o700);
      await assert.rejects(initializeReceiptDirectory(directory));await assert.rejects(initializeReceiptDirectory('relative'));
      await symlink(root,join(root,'alias'));await assert.rejects(initializeReceiptDirectory(join(root,'alias','other')));
      await mkdir(join(root,'public'),{mode:0o777});await chmod(join(root,'public'),0o777);
      await assert.rejects(initializeReceiptDirectory(join(root,'public','bad')));
      assert.equal(cli('init','--directory',join(root,'one'),'--directory',join(root,'two')).status,1);
    });
    await t.test('Inventory/inspection hide packet and other-client details; inspection has no writes',async()=>{
      ref=(await store.save(input)).receipt_reference;before=await readFile(join(directory,ref+'.json'));
      await store.save({...input,site_url:'https://fixture.invalid/client-b'});
      const listing=JSON.parse(cli('list','--directory',directory,'--site',site).stdout);assert.equal(listing.items.length,1);
      assert.equal(listing.items[0].receipt_reference,ref);assert.equal(listing.private_result_returned,false);
      const details=await store.inspect(ref,context);assert.match(details.deletion_hash,/^[a-f0-9]{64}$/);assert.ok(details.warning.includes('only retained evidence'));
      assert.deepEqual(await readFile(join(directory,ref+'.json')),before);
      await assert.rejects(store.inspect(ref,{...context,site_url:'https://fixture.invalid/client-b'}));
    });
    await t.test('Private export is explicit and no-clobber; source retained, unsafe destination refused',async()=>{
      const destination=join(root,'private-export.json');const r=cli('export','--directory',directory,'--site',site,'--execution',execution,'--reference',ref,'--destination',destination);
      assert.equal(r.status,0);assert.equal((await stat(destination)).mode&0o777,0o600);
      assert.deepEqual(await readFile(destination),before);assert.deepEqual(await readFile(join(directory,ref+'.json')),before);
      await assert.rejects(store.export(ref,context,destination));await assert.rejects(store.export(ref,context,join(root,'public','export.json')));
      assert.deepEqual(await readFile(destination),before);
    });
    await t.test('Delete requires exact inspected record and acknowledgement; no authority from mere reference',async()=>{
      const preview=await store.inspect(ref,context);
      for(const args of [{},{expected_hash:preview.deletion_hash,confirmation:false},{expected_hash:'0'.repeat(64),confirmation:'DELETE_PRIVATE_RECEIPT'}])
        await assert.rejects(store.remove(ref,context,args));
      assert.deepEqual(await readFile(join(directory,ref+'.json')),before);
    });
    await t.test('Pending writer prevents deletion, but recovery reads stay available; no forced unlock',async()=>{
      await writeFile(join(directory,'.write-lock'),'',{mode:0o600});await store.checkReadable();const preview=await store.inspect(ref,context);
      await assert.rejects(store.remove(ref,context,{expected_hash:preview.deletion_hash,confirmation:'DELETE_PRIVATE_RECEIPT'}),{code:'scan_receipt_storage_busy'});
      assert.equal((await store.list({site_url:site})).write_busy,true);assert.deepEqual(await readFile(join(directory,ref+'.json')),before);
      await rm(join(directory,'.write-lock'));
    });
    await t.test('Exact explicit erasure removes only the chosen receipt; other site and export survive',async()=>{
      const preview=await store.inspect(ref,context);
      const out=cli('remove','--directory',directory,'--site',site,'--execution',execution,'--reference',ref,'--expected_hash',preview.deletion_hash,'--confirm','DELETE_PRIVATE_RECEIPT');
      assert.equal(out.status,0);assert.equal(JSON.parse(out.stdout).server_changed,false);
      await assert.rejects(readFile(join(directory,ref+'.json')),{code:'ENOENT'});assert.equal((await readdir(directory)).length,1);
      assert.deepEqual(await readFile(join(root,'private-export.json')),before);assert.equal((await store.list({site_url:site})).items.length,0);
    });
    await t.test('No guessed recursive cleanup, unknown commands/options or raw filesystem errors',async()=>{
      for(const args of [['remove-all','--directory',directory],['list','--directory',directory,'--site',site,'--force','1'],
        ['inspect','--directory',directory,'--site',site,'--execution',execution,'--reference','../../x']])assert.equal(cli(...args).status,1);
      assert.equal((await readdir(directory)).length,1);
    });
  }finally{await rm(root,{recursive:true,force:true});}
});
