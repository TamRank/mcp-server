import assert from 'node:assert/strict';
import {nativePackageDeadline} from './native-package-deadline.mjs';

// The native rollback runner permits 30 minutes per site: one single-site
// plus two multisite blogs. Its parent must also leave time for owned cleanup.
assert.equal(nativePackageDeadline('schema-rollback-mcp'),3*1800000+300000);
assert.equal(nativePackageDeadline('schema-mixed-execution-mcp'),3*4500000+300000);
assert.equal(nativePackageDeadline('source-095-schema','beta-schema'),5400000);
for(const mode of ['schema-recovery-mcp','schema-recovery-mixed-mcp','schema-recovery-authority-mcp','pagespeed-scans'])
  assert.equal(nativePackageDeadline(mode),1800000,'Unrelated lane deadline unchanged: '+mode);
console.log('PASS: native package deadlines include all rollback sites and cleanup; other lanes unchanged.');
