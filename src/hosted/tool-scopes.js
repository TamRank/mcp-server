/** Public hosted OAuth declarations; actual authorization remains with the VPS. */
const siteRead = ['site:read'];
const historyRead = ['site:read','audit:read'];
// These tools dispatch either field or redirect change sets. MCP tool metadata
// cannot vary its required scopes by arguments, so declare both write domains.
// Do not attach redirects:write to read-only tools or unrelated work updates.
const changeWrites = ['site:read','changes:write','meta:write','redirects:write'];
const scopesByTool = Object.freeze({
  get_site_context: siteRead,
  get_capabilities: siteRead,
  get_work_queue: siteRead,
  get_signals: siteRead,
  search_pages: siteRead,
  get_page: siteRead,
  diagnose_page: siteRead,
  get_site_diagnostics: siteRead,
  get_gsc_pages: siteRead,
  get_redirects: siteRead,
  get_images_missing_alt: siteRead,
  get_topical_authority: siteRead,
  get_changes: historyRead,
  update_work_item: ['site:read','tasks:write','importance:write'],
  plan_changes: changeWrites,
  execute_change_set: changeWrites,
  rollback_change_set: [...changeWrites,'rollback'],
});

export function hostedToolSecuritySchemes(name) {
  const scopes = scopesByTool[name];
  if (!scopes) throw new Error(`Hosted OAuth scopes not declared for ${name}`);
  return [{ type: 'oauth2', scopes: [...scopes] }];
}
