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
function visible(name, caps) {
  if (name === 'execute_change_set') return caps.field_execution?.contract_version === 1 && caps.field_execution.available === true;
  if (name === 'rollback_change_set') return caps.field_execution?.contract_version === 1 && caps.field_execution.rollback_available === true;
  if (name === 'plan_changes') return caps.field_execution?.contract_version === 1 && caps.field_execution.available === true
    || caps.field_proposals?.contract_version === 2 && caps.field_proposals.available === true;
  if (name === 'get_changes') return caps.field_execution?.contract_version === 1 && caps.field_execution.read_available === true
    || caps.field_proposals?.contract_version === 2 && caps.field_proposals.read_available === true;
  if (name === 'update_work_item') return caps.work_administration?.available === true;
  return caps.reads?.[name]?.available !== false;
}

export function buildWorkflowServer(client, options = {}) {
  const hosted = options.hostedContext;
  const instructions = hosted ? WORKFLOW_INSTRUCTIONS
    .replace('agent label is unknown.', 'agent label identifies the server-validated grant.')
    .replace(/ Recovery: get_changes\(kind=recovery\)[\s\S]*?No automatic retries or legacy writers\./,
      ' Hosted recovery and specialist modes are unavailable. No automatic retries or legacy writers.') : WORKFLOW_INSTRUCTIONS;
  const server = new (hosted ? HostedWorkflowServer : McpServer)(workflowIdentity,
    { instructions: instructions + (options.preflight?.ok === false ? '\nStartup: ' + options.preflight.message : '') });
  const setHandler = server.server.setRequestHandler;
  if (hosted) server.server.setRequestHandler = function(schema, handler) {
    const method = schema.shape?.method?.value;
    const guarded = method === 'tools/list' ? async (...args) => {
      const listing = await handler(...args);
      return { ...listing, tools: listing.tools.filter(tool => visible(tool.name, hosted.filteredCapabilities)) };
    } : handler;
    return setHandler.call(this, schema, guarded);
  };
  try { registerWorkflowTools(server, client, options); }
  finally { if (hosted) server.server.setRequestHandler = setHandler; }
  return server;
}
