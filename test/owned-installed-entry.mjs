/** Native test-only runtime selection. Never silently fall back to source. */
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function ownedInstalledRuntime(sourceRoot, candidate=process.env.TAMRANK_TEST_PACKED_ROOT){
  const source=realpathSync(sourceRoot);
  if(candidate===undefined)return source;
  assert.equal(typeof candidate,'string');assert.ok(candidate.length>0);
  const installed=realpathSync(candidate),parent=path.dirname(installed);
  assert.equal(installed,path.resolve(candidate),'Installed fixture cannot be a symlink');
  assert.equal(path.basename(installed),'package');
  assert.match(path.basename(parent),/^tamrank-package-[A-Za-z0-9]{6}$/);
  const marker=JSON.parse(readFileSync(path.join(parent,'owned-native-package.json'),'utf8'));
  const pkg=JSON.parse(readFileSync(path.join(installed,'package.json'),'utf8'));
  assert.equal(marker.source_root,source);assert.equal(marker.package_root,installed);
  assert.equal(pkg.name,'@tam-rank/mcp-server');assert.equal(marker.package_version,pkg.version);
  const entry=path.join(installed,'index-workflow.js');
  assert.equal(realpathSync(entry),entry,'No source-entry symlink');
  assert.equal(createHash('sha256').update(readFileSync(entry)).digest('hex'),marker.entry_sha256);
  assert.ok(lstatSync(path.join(installed,'node_modules')).isDirectory(),'Real separately installed dependencies');
  assert.equal(realpathSync(path.join(installed,'src')),path.join(installed,'src'),'No source-tree symlink');
  assert.notEqual(installed,source,'Native package proof must not use the checkout');
  return installed;
}
