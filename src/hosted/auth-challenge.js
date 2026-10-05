/** Forward only the production resource's bounded, explicit scope-upgrade challenge. */
const metadata = 'https://mcp.tamrank.com/.well-known/oauth-protected-resource/mcp';
const knownScopes = new Set(['site:read','meta:write','audit:read','rollback','changes:write',
  'tasks:write','importance:write','redirects:write']);
const challengePattern = /^Bearer resource_metadata="([^"]+)", scope="([a-z0-9: ]+)", error="insufficient_scope", error_description="([A-Za-z0-9 .:-]+)"$/;

export function hostedScopeChallengeMeta(code, value) {
  if (code !== 'insufficient_scope' || typeof value !== 'string' || value.length > 1024) return undefined;
  const match = challengePattern.exec(value);
  if (!match || match[1] !== metadata || match[3].length > 200) return undefined;
  const scopes = match[2].split(' ');
  if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !knownScopes.has(scope))) return undefined;
  return { 'mcp/www_authenticate': [value] };
}
