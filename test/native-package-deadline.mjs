/** Test-runner deadlines only; never imported by the shipped MCP runtime. */
export function nativePackageDeadline(mode,betaMode=mode){
  if(mode==='schema-rollback-mcp')return 3*1800000+300000;
  return mode==='schema-mixed-execution-mcp'?13800000:betaMode==='beta-schema'?5400000:1800000;
}
