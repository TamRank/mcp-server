#!/usr/bin/env node
/** Canonical safe workflow entry for the 0.4 beta package. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkflowClient } from './src/workflow-rest.js';
import { registerWorkflowTools, WORKFLOW_INSTRUCTIONS } from './src/workflow-tools.js';
import { discoverWorkflows } from './src/scan-maintenance.js';
import {discoverRecovery} from './src/scan-recovery-chat.js';
import {ScanReceiptRecovery} from './src/scan-receipt-recovery.js';
import {ScanReceiptStore} from './src/scan-receipt-store.js';
import {workflowIdentity} from './src/workflow-identity.js';

let client;
try {
  if (!process.env.TAMRANK_PAT?.startsWith('tamrank_pat_')) throw new Error('Configure a site-local TAMRANK_PAT token.');
  client = new WorkflowClient({ siteUrl: process.env.TAMRANK_SITE_URL, pat: process.env.TAMRANK_PAT,
    timeoutMs: Number(process.env.TAMRANK_TIMEOUT || 30000), routeStyle: process.env.TAMRANK_REST_STYLE || 'pretty' });
} catch { console.error('Invalid workflow configuration: set TAMRANK_PAT and an HTTPS site URL (HTTP loopback allowed for testing).'); process.exit(1); }
const profile = process.env.TAMRANK_TOOL_PROFILE || 'core';
if (!['core','legacy','specialist'].includes(profile)) { console.error('Use core, legacy or specialist for TAMRANK_TOOL_PROFILE.'); process.exit(1); }
const {capabilities,preflight,maintenanceOnly}=await discoverWorkflows(client,{profile,preview:process.env.TAMRANK_WORKFLOW_PREVIEW==='1'});
let recovery=null,receiptStore=null;
if(process.env.TAMRANK_SCAN_RECEIPT_DIR){
  if(profile!=='specialist' || process.env.TAMRANK_WORKFLOW_PREVIEW!=='1'){
    console.error('Private recovery storage requires explicit specialist preview configuration.');process.exit(1);
  }
  try {
    receiptStore=new ScanReceiptStore({directory:process.env.TAMRANK_SCAN_RECEIPT_DIR});
    await receiptStore.checkReadable();
  } catch {console.error('Private recovery storage is unavailable. Check the configured private directory; no files were created or changed.');process.exit(1);}
}
const support=await discoverRecovery(client,{profile,preview:process.env.TAMRANK_WORKFLOW_PREVIEW==='1',preflight,maintenanceOnly});
if(support&&capabilities&&(receiptStore||support.retained_receipt_review_available===true)){
  capabilities.scan_recovery=support;recovery=new ScanReceiptRecovery({siteUrl:process.env.TAMRANK_SITE_URL,
    pat:process.env.TAMRANK_PAT,receiptStore,allowServerReceipts:support.retained_receipt_review_available===true,
    timeoutMs:Number(process.env.TAMRANK_TIMEOUT||30000),routeStyle:process.env.TAMRANK_REST_STYLE||'pretty'});
}
const server = new McpServer(workflowIdentity,
  { instructions: WORKFLOW_INSTRUCTIONS + (preflight.ok ? '' : '\nStartup: ' + preflight.message) });
registerWorkflowTools(server, client, { profile, capabilities, preflight, maintenanceOnly, recovery });
await server.connect(new StdioServerTransport());
