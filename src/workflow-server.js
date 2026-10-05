/** Internal shared composition; only hosted/factory.js is the public hosted API. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWorkflowTools, WORKFLOW_INSTRUCTIONS } from './workflow-tools.js';
import { workflowIdentity } from './workflow-identity.js';

const invalidRequest = () => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'invalid_request',
  message: 'Invalid or unsupported tool request; nothing was sent.' }) }] });
class HostedWorkflowServer extends McpServer {
  // The pinned SDK validates inputs before invoking handlers. Preserve that
  // validation while returning our bounded error instead of schema internals.
  createToolError() { return invalidRequest(); }
}
const native = (caps, key) => [caps.field_execution, caps.redirect_execution].some(v => v?.contract_version === 1 && v[key] === true);
// Stored-data specialist reads a hosted connection may list; scans and schema stay specialist-only.
export const HOSTED_SPECIALIST_READS = ['get_site_diagnostics','get_gsc_pages','get_redirects','get_images_missing_alt','get_topical_authority'];
const specialistReadVisible = (name, caps) => HOSTED_SPECIALIST_READS.includes(name) && caps.specialist_reads?.[name]?.available === true;
function visible(name, caps) {
  if (name === 'execute_change_set') return native(caps, 'available');
  if (name === 'rollback_change_set') return native(caps, 'rollback_available');
  if (name === 'plan_changes') return native(caps, 'available')
    || caps.field_proposals?.contract_version === 2 && caps.field_proposals.available === true;
  if (name === 'get_changes') return native(caps, 'read_available')
    || caps.field_proposals?.contract_version === 2 && caps.field_proposals.read_available === true;
  if (name === 'update_work_item') return caps.work_administration?.available === true;
  if (HOSTED_SPECIALIST_READS.includes(name)) return specialistReadVisible(name, caps);
  // Hosted listing is positive: a read the capabilities do not advertise is absent.
  return caps.reads?.[name]?.available === true;
}

// Recovery tokens: field (trfr1) and redirect (trrr1).
const RECOVERY_TOKEN = /^tr[fr]r1$/;
/** The listed shape of a tool where recovery is masked (hosted, clamped profile). The closed argument
 * schema that parses a call is unchanged, so a direct recovery call still reaches the authorizer and
 * its operation_unavailable; the listing just stops offering what that refusal takes away. */
function listedWithoutRecovery(tool) {
  const properties = tool.inputSchema?.properties;
  if (!properties) return tool;
  if (tool.name === 'get_changes' && Array.isArray(properties.kind?.enum)) {
    return { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...properties,
      kind: { ...properties.kind, enum: properties.kind.enum.filter(kind => kind !== 'recovery') } } } };
  }
  if (tool.name === 'execute_change_set') {
    const { recovery_plan, ...rest } = properties;
    const token = rest.change_token;
    const match = typeof token?.pattern === 'string' ? /^\^\(\?:([a-z0-9|]+)\)(.*)$/.exec(token.pattern) : null;
    const change_token = match ? { ...token, pattern: `^(?:${match[1].split('|').filter(p => !RECOVERY_TOKEN.test(p)).join('|')})${match[2]}` } : token;
    return { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...rest, ...(change_token ? { change_token } : {}) } } };
  }
  return tool;
}

const withoutRecovery = (prefix, caps) => WORKFLOW_INSTRUCTIONS.replace(/ Recovery: get_changes\(kind=recovery\)[\s\S]*?No automatic retries or legacy writers\./,
  ` ${prefix} recovery and specialist modes are unavailable` + (HOSTED_SPECIALIST_READS.some(name => specialistReadVisible(name, caps))
    ? ', except the listed stored-data reads' : '') + '. No automatic retries or legacy writers.');

export function buildWorkflowServer(client, options = {}) {
  const hosted = options.hostedContext;
  // A stdio session on a clamped profile (workflow-v2-1) lists exactly what hosted lists for it. The
  // clamp removes scans and recovery, so a specialist session gets the core toolset; legacy keeps its
  // deprecated inventory, which a positive capability listing would hide wholesale.
  const clamped = !hosted && options.profileClamp === true && (options.profile ?? 'core') !== 'legacy' && options.capabilities;
  const listed = hosted ? hosted.filteredCapabilities : clamped ? options.capabilities : null;
  const instructions = hosted ? withoutRecovery('Hosted', hosted.filteredCapabilities)
    .replace('agent label is unknown.', 'agent label identifies the server-validated grant.')
    : clamped ? withoutRecovery('For this site profile,', options.capabilities) : WORKFLOW_INSTRUCTIONS;
  const server = new (hosted ? HostedWorkflowServer : McpServer)(workflowIdentity,
    { instructions: instructions + (options.preflight?.ok === false ? '\nStartup: ' + options.preflight.message : '') });
  const setHandler = server.server.setRequestHandler;
  if (listed) server.server.setRequestHandler = function(schema, handler) {
    const method = schema.shape?.method?.value;
    const guarded = method === 'tools/list' ? async (...args) => {
      const listing = await handler(...args);
      return { ...listing, tools: listing.tools.filter(tool => visible(tool.name, listed)).map(listedWithoutRecovery) };
    } : handler;
    return setHandler.call(this, schema, guarded);
  };
  try { registerWorkflowTools(server, client, clamped ? { ...options, profile: 'core' } : options); }
  finally { if (listed) server.server.setRequestHandler = setHandler; }
  return server;
}
