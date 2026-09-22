/** Request-local hosted facade over the same builder used by stdio. */
import { WorkflowClient } from '../workflow-rest.js';
import { buildWorkflowServer } from '../workflow-server.js';
import { validateRestBase } from './rest-base.js';
import { isIP } from 'node:net';
export { discoverWorkflows } from '../scan-maintenance.js';

const fullWorkflowScopes = new Set(['redirects:write','schema:write','scans:plan','scans:execute','scans:recover','scans:maintain']);
const scopes = new Set(['site:read','meta:write','audit:read','rollback','changes:write','tasks:write','importance:write', ...fullWorkflowScopes]);
const workflowProfiles = new Set(['safe-beta-1','workflow-v2-1']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const label = (value, max) => typeof value === 'string' && value.trim() !== ''
  && Buffer.byteLength(value, 'utf8') <= max && !/[<>\p{C}]/u.test(value);
const identifier = value => label(value, 256) && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
const plain = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
function requireValue(valid, field) { if (!valid) throw new TypeError(`Invalid hosted context: ${field}`); }
function assertData(value, seen = new WeakSet()) {
  if (value === null || ['string','boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return;
  requireValue(Array.isArray(value) || plain(value), 'JSON data');
  requireValue(!seen.has(value), 'cyclic JSON data'); seen.add(value);
  for (const property of Object.values(Object.getOwnPropertyDescriptors(value))) {
    requireValue(!property.get && !property.set, 'accessor');
    if (property.enumerable) assertData(property.value, seen);
  }
  seen.delete(value);
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); for (const item of Object.values(value)) deepFreeze(item, seen); Object.freeze(value);
  }
  return value;
}
function publicHttps(value) {
  requireValue(typeof value === 'string' && !/[\\\s]/.test(value), 'HTTPS URL');
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port
    && !isIP(host) && host.includes('.') && !host.endsWith('.localhost') && !host.endsWith('.local'), 'HTTPS URL');
  return url;
}
function validateContext(ctx) {
  const fields = ['validatedInstallation','grantContext','filteredCapabilities','auditContext','transport','authorizer'];
  requireValue(plain(ctx) && Object.keys(ctx).sort().join() === fields.sort().join(), 'fields');
  for (const name of fields) requireValue(plain(ctx[name]), name);
  for (const name of ['validatedInstallation','grantContext','filteredCapabilities','auditContext']) assertData(ctx[name]);
  const site = ctx.validatedInstallation, grant = ctx.grantContext, audit = ctx.auditContext;
  requireValue(ctx.filteredCapabilities.contract_version === 2 && (workflowProfiles.has(ctx.filteredCapabilities.mcp_bridge_compatibility)
    || ctx.filteredCapabilities.full_v2_compatible === true), 'capability contract');
  requireValue(uuid(site.installation_id) && positive(site.blog_id) && identifier(site.link_id) && positive(site.generation), 'installation binding');
  requireValue(workflowProfiles.has(site.workflow_profile)
    && (ctx.filteredCapabilities.full_v2_compatible === true
      || ctx.filteredCapabilities.mcp_bridge_compatibility === site.workflow_profile), 'workflow_profile');
  requireValue(['pretty','query'].includes(site.rest_style), 'rest_style');
  const home = publicHttps(site.canonical_home_url), rest = publicHttps(site.rest_base_url);
  requireValue(!home.search && home.origin === rest.origin, 'installation origin');
  validateRestBase(site.rest_base_url, site.rest_style);
  for (const forbidden of ['receiptStore','recovery','preview','profile']) requireValue(!Object.hasOwn(site, forbidden), forbidden);
  requireValue(uuid(grant.grant_id) && identifier(grant.account_id) && identifier(grant.client_id), 'grant binding');
  requireValue(Array.isArray(grant.scopes) && new Set(grant.scopes).size === grant.scopes.length
    && grant.scopes.every(scope => scopes.has(scope)), 'grant scopes');
  requireValue(site.workflow_profile === 'workflow-v2-1'
    || !grant.scopes.some(scope => fullWorkflowScopes.has(scope)), 'grant scopes');
  requireValue(label(audit.grantLabel, 80) && audit.grantLabel === `grant:${grant.grant_id}`
    && label(audit.clientLabel, 80) && identifier(audit.request_id), 'audit context');
  requireValue(typeof ctx.transport.request === 'function', 'transport.request');
  requireValue(typeof ctx.authorizer.authorizeOperation === 'function'
    && typeof ctx.authorizer.recordValidatedResult === 'function', 'authorizer');
  return deepFreeze(ctx);
}

/** Construct an unconnected server; the caller owns the MCP transport/lifetime. */
export function createWorkflowServer(ctx) {
  validateContext(ctx);
  const site = ctx.validatedInstallation;
  const client = new WorkflowClient({ rest_base_url: site.rest_base_url, rest_style: site.rest_style,
    transport: ctx.transport, timeoutMs: 30000, hosted: true });
  return buildWorkflowServer(client, { profile: 'specialist', capabilities: ctx.filteredCapabilities,
    hostedContext: ctx, preflight: { ok: true } });
}
