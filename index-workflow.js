#!/usr/bin/env node
/** Opt-in development entry; does not replace the installed 0.3.x bridge. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkflowClient } from './src/workflow-rest.js';
import { registerWorkflowTools, WORKFLOW_INSTRUCTIONS } from './src/workflow-tools.js';
import { discoverWorkflows } from './src/scan-maintenance.js';

let client;
try {
  if (!process.env.TAMRANK_PAT?.startsWith('tamrank_pat_')) throw new Error('Configure a site-local TAMRANK_PAT token.');
  client = new WorkflowClient({ siteUrl: process.env.TAMRANK_SITE_URL, pat: process.env.TAMRANK_PAT,
    timeoutMs: Number(process.env.TAMRANK_TIMEOUT || 30000), routeStyle: process.env.TAMRANK_REST_STYLE || 'pretty' });
} catch { console.error('Invalid workflow configuration: set TAMRANK_PAT and an HTTPS site URL (HTTP loopback allowed for testing).'); process.exit(1); }
const profile = process.env.TAMRANK_TOOL_PROFILE || 'core';
if (!['core','legacy','specialist'].includes(profile)) { console.error('Use core, legacy or specialist for TAMRANK_TOOL_PROFILE.'); process.exit(1); }
const {capabilities,preflight,maintenanceOnly}=await discoverWorkflows(client,{profile,preview:process.env.TAMRANK_WORKFLOW_PREVIEW==='1'});
const server = new McpServer({ name: 'tamrank-workflow-preview', version: '0.4.0-preview' },
  { instructions: WORKFLOW_INSTRUCTIONS + (preflight.ok ? '' : '\nStartup: ' + preflight.message) });
registerWorkflowTools(server, client, { profile, capabilities, preflight, maintenanceOnly });
await server.connect(new StdioServerTransport());
