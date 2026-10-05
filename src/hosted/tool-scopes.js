/** Public hosted OAuth declarations; actual authorization remains with the VPS. */
const siteRead = ['site:read'];
const historyRead = ['site:read','audit:read'];
// These tools dispatch field sets and, only when the authorization server
// offers the eighth scope AND this site exposes the lane, redirect sets. Do not
// infer from the current grant or available:true: a seven-scope grant must be
// able to upgrade. A disabled flag/unsupported site must never ask for it.
const changeWrites = ['site:read','changes:write','meta:write','audit:read','rollback'];
const legacyOffered = ['site:read','meta:write','audit:read','rollback',
  'changes:write','tasks:write','importance:write'];
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
  rollback_change_set: changeWrites,
});

export function hostedToolSecuritySchemes(name, grantContext, filteredCapabilities) {
  const scopes = scopesByTool[name];
  if (!scopes) throw new Error(`Hosted OAuth scopes not declared for ${name}`);
  const offered = grantContext.offered_scopes ?? legacyOffered;
  const granted = grantContext.scopes;
  // A fresh consent stores exactly the requested scopes. If a temporary flag
  // makes an existing grant scope unrequestable, per-tool metadata must not
  // initiate an upgrade that would silently discard that permission. Omission
  // inherits the server's OAuth policy; the API still enforces every call.
  if (granted.some(scope => !offered.includes(scope))) return undefined;
  const redirectOffered = offered.includes('redirects:write')
    && Object.hasOwn(filteredCapabilities, 'redirect_execution');
  const required = [...scopes,
    ...(redirectOffered && ['plan_changes','execute_change_set','rollback_change_set'].includes(name)
      ? ['redirects:write'] : [])];
  if (required.some(scope => !offered.includes(scope))) return undefined;
  const requested = required.every(scope => granted.includes(scope))
    ? required : offered.filter(scope => granted.includes(scope) || required.includes(scope));
  return [{ type: 'oauth2', scopes: requested }];
}
