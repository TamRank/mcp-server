#!/usr/bin/env node
/** Canonical safe workflow entry for the 0.4 beta package. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkflowClient } from './src/workflow-rest.js';
import { buildWorkflowServer } from './src/workflow-server.js';
import { legacyRestBase } from './src/hosted/rest-base.js';
import { createFetchTransport } from './src/hosted/fetch-transport.js';
import { discoverWorkflows } from './src/scan-maintenance.js';
import {ScanReceiptRecovery} from './src/scan-receipt-recovery.js';
import {ScanReceiptStore} from './src/scan-receipt-store.js';

let client;
try {
  if (!process.env.TAMRANK_PAT?.startsWith('tamrank_pat_')) throw new Error('Configure a site-local TAMRANK_PAT token.');
  const restStyle=process.env.TAMRANK_REST_STYLE || 'pretty';
  client = new WorkflowClient({ rest_base_url: legacyRestBase(process.env.TAMRANK_SITE_URL,restStyle),
    rest_style: restStyle, transport:createFetchTransport(process.env.TAMRANK_PAT),
    timeoutMs: Number(process.env.TAMRANK_TIMEOUT || 30000) });
} catch { console.error('Invalid workflow configuration: set TAMRANK_PAT and an HTTPS site URL (HTTP loopback allowed for testing).'); process.exit(1); }
const profile = process.env.TAMRANK_TOOL_PROFILE || 'core';
if (!['core','legacy','specialist'].includes(profile)) { console.error('Use core, legacy or specialist for TAMRANK_TOOL_PROFILE.'); process.exit(1); }
// Local storage is settled before the first request: discovery now carries the recovery probe, and a
// misconfigured private directory must still refuse without having asked the site anything.
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
const {capabilities,preflight,maintenanceOnly,recoverySupport:support}=await discoverWorkflows(client,{profile,preview:process.env.TAMRANK_WORKFLOW_PREVIEW==='1'});
if(support&&capabilities&&(receiptStore||support.retained_receipt_review_available===true)){
  capabilities.scan_recovery=support;recovery=new ScanReceiptRecovery({siteUrl:process.env.TAMRANK_SITE_URL,
    pat:process.env.TAMRANK_PAT,receiptStore,allowServerReceipts:support.retained_receipt_review_available===true,
    timeoutMs:Number(process.env.TAMRANK_TIMEOUT||30000),routeStyle:process.env.TAMRANK_REST_STYLE||'pretty'});
}
const server = buildWorkflowServer(client, { profile, capabilities, preflight, maintenanceOnly, recovery });
await server.connect(new StdioServerTransport());
