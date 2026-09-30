/** Which site profiles the stdio bridge serves, and with which tool profile.
 * Same decision as the hosted bridge (tamrank-api src/mcp/hosted/profile.ts, 28 Sep 2026; applied to
 * stdio 30 Sep 2026): PRO registers under `workflow-v2-1`, a superset of `safe-beta-1` that reports
 * `full_v2_compatible: false`. Both are admitted; the TOOL profile stays `safe-beta-1`.
 */
export const BRIDGE_TOOL_PROFILE='safe-beta-1';
export const BRIDGE_SITE_PROFILES=new Set([BRIDGE_TOOL_PROFILE,'workflow-v2-1']);
export const bridgeCompatible=caps=>caps?.full_v2_compatible===true || BRIDGE_SITE_PROFILES.has(caps?.mcp_bridge_compatibility);
/** A superset profile is clamped; a full v2 site and a plain safe-beta-1 site keep today's capabilities. */
export const needsProfileClamp=caps=>caps?.full_v2_compatible!==true && typeof caps?.mcp_bridge_compatibility==='string'
  && caps.mcp_bridge_compatibility!==BRIDGE_TOOL_PROFILE && BRIDGE_SITE_PROFILES.has(caps.mcp_bridge_compatibility);

const READ_TOOLS=['get_site_context','get_capabilities','get_work_queue','get_signals','search_pages','get_page','diagnose_page'];
const FIELD_OPERATIONS=['meta.update','social.update','image_alt.update'];
// redirect-execution.js has the same list, but it imports scan-maintenance.js, which imports this module.
const REDIRECT_OPERATIONS=['redirect.create','redirect.update','redirect.delete'];
export const SPECIALIST_READS=['get_site_diagnostics','get_gsc_pages','get_redirects','get_images_missing_alt','get_topical_authority'];
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v)?v:null;

/** The hosted `filterCapabilities` allowlist with every scope granted: schema execution/preview, scans
 * and recovery drop out, redirects stay redirect-only sets. Site permissions still decide each call. */
export function clampToToolProfile(raw){
  const source=object(raw)??{},out={contract_version:source.contract_version};
  if(source.mcp_bridge_compatibility!==undefined)out.mcp_bridge_compatibility=BRIDGE_SITE_PROFILES.has(source.mcp_bridge_compatibility)
    ?BRIDGE_TOOL_PROFILE:source.mcp_bridge_compatibility;
  if(source.full_v2_compatible!==undefined)out.full_v2_compatible=source.full_v2_compatible;
  const reads=object(source.reads);
  if(reads)out.reads=Object.fromEntries(READ_TOOLS.filter(tool=>object(reads[tool]))
    .map(tool=>[tool,{...reads[tool],available:reads[tool].available!==false}]));
  const execution=object(source.field_execution);
  if(execution)out.field_execution={...execution,available:execution.available===true,read_available:execution.read_available===true,
    rollback_available:execution.rollback_available===true,recovery_available:false};
  const proposals=object(source.field_proposals);
  if(proposals)out.field_proposals={...proposals,available:proposals.available===true,read_available:proposals.read_available===true,
    ...(Array.isArray(proposals.operations)?{operations:proposals.operations.filter(op=>FIELD_OPERATIONS.includes(op))}:{})};
  const redirects=object(source.redirect_execution);
  if(redirects){
    const operations=Array.isArray(redirects.operations)?redirects.operations.filter(op=>REDIRECT_OPERATIONS.includes(op)):[];
    const write=redirects.available===true && operations.length>0;
    out.redirect_execution={...redirects,available:write,mixed_available:false,read_available:redirects.read_available===true,
      rollback_available:redirects.rollback_available===true && write,recovery_available:false,recovery_delivery_available:false,operations};
  }
  const specialist=object(source.specialist_reads);
  if(specialist){
    const filtered=Object.fromEntries(SPECIALIST_READS.filter(tool=>object(specialist[tool]))
      .map(tool=>[tool,{...specialist[tool],available:specialist[tool].available===true}]));
    if(Object.keys(filtered).length>0)out.specialist_reads=filtered;
  }
  const work=object(source.work_administration);
  if(work){
    const allowed=op=>typeof op==='string' && (op==='importance.update' || op.startsWith('work.'));
    const operations=Array.isArray(work.operations)?work.operations.filter(allowed):[];
    const manual=object(work.manual),importance=object(work.importance);
    out.work_administration={...work,available:work.available===true && operations.length>0,operations,
      ...(importance?{importance:{...importance,available:importance.available===true}}:{}),
      ...(manual?{manual:{...manual,operations:Array.isArray(manual.operations)?manual.operations.filter(allowed):[],
        available:manual.available===true}}:{})};
  }
  // Plain data: no prototypes, accessors or shared references survive.
  return JSON.parse(JSON.stringify(out));
}
