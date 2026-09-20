/** Test-process-only host mapping. Native fetch/TLS verification stay intact. */
import assert from 'node:assert/strict';
import dns from 'node:dns';
import {existsSync} from 'node:fs';
const root=process.env.TAMRANK_SCHEMA_FIXTURE_ROOT;
assert.match(root||'',/^\/private\/tmp\/tr-maint-wp-[A-Za-z0-9]{6}$/);
assert.ok(existsSync(root+'/owned-fixture'));
dns.lookup=(host,options,callback)=>{
  if(typeof options==='function'){callback=options;options={};}
  if(host!=='schema-source.example.org')return process.nextTick(callback,Object.assign(new Error('Only owned fixture DNS is allowed'),{code:'ENOTFOUND'}));
  process.nextTick(callback,null,options?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4);
};
