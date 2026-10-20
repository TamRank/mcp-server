/** Strict V2 transport. No credential redirects, V1 fallback or implicit retries. */
import { ApiError } from './workflow-error.js';
import { validateRestBase, workflowUrl, legacyRestBase } from './hosted/rest-base.js';
import { createFetchTransport } from './hosted/fetch-transport.js';
import { isSitePlanRefusal, isSiteReadRefusal, mapHostedOutcome } from './hosted/error-map.js';
import { isScanReceipt } from './scan-receipt-store.js';
import { liveCheckRoute, limitDetails, pageSpeedEnableHelp, changedSources, LIMIT_CODES, INDEX_START_REFUSALS } from './live-checks.js';

// Only bounded operational advice crosses the error boundary; never arbitrary server data.
export function rateLimitAdvice(data) {
  if (!data || !Number.isInteger(data.retry_after) || data.retry_after<1 || data.retry_after>3600) return undefined;
  return {retry_after:data.retry_after,automatic_retry:false};
}

// Results can embed a settlement receipt in saved history as well as error data.
// Preserve ordinary analytics, but never expose the private recovery packet.
function scrubResponse(value, pat, schemaEnvelope = null, redact = text => text) {
  const scrubPat = text => redact(pat ? text.split(pat).join('[redacted]') : text)
    .replace(/tamrank_pat_[A-Za-z0-9_-]+/g, '[redacted]');
  const scrub = text => scrubPat(text)
    .replace(/trsr1\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, '[private receipt redacted]');
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(item => scrubResponse(item, pat, schemaEnvelope, redact));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [scrub(key), key === 'result_receipt' ? '[private receipt redacted]'
      : value === schemaEnvelope && key === 'change_token' ? scrubPat(item) : scrubResponse(item, pat, schemaEnvelope, redact)]));
  return value;
}

function validReceiptAttempt(method, body) {
  return method === 'POST' && body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === 4
    && typeof body.execution_id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.execution_id)
    && typeof body.measurement_id === 'string' && /^[a-f0-9]{64}$/.test(body.measurement_id)
    && typeof body.client_request_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/.test(body.client_request_id)
    && typeof body.expected_runtime_hash === 'string' && /^[a-f0-9]{64}$/.test(body.expected_runtime_hash);
}

export class WorkflowClient {
  #receiptStore;
  #restBase;
  #transport;
  #hosted;
  constructor({ siteUrl, pat, timeoutMs = 30000, routeStyle = 'pretty', receiptStore = null,
    rest_base_url, rest_style, transport, hosted = false }) {
    routeStyle = rest_style ?? routeStyle;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > (hosted ? 30000 : 120000)) throw new Error('Invalid request timeout.');
    if (hosted && (pat !== undefined || siteUrl !== undefined || receiptStore !== null || !transport)) throw new Error('Hosted requires an injected transport and full REST base.');
    this.#restBase = validateRestBase(rest_base_url ?? legacyRestBase(siteUrl, routeStyle), routeStyle, !hosted);
    this.base = siteUrl ? new URL(siteUrl).href.replace(/\/+$/, '') : this.#restBase;
    this.pat = pat; this.timeoutMs = timeoutMs; this.routeStyle = routeStyle;
    this.#transport = transport ?? createFetchTransport(pat);
    if (typeof this.#transport.request !== 'function' || (this.#transport.redact !== undefined && typeof this.#transport.redact !== 'function')) throw new Error('Invalid transport.');
    this.#hosted = hosted;
    this.#receiptStore = receiptStore;
  }

  async request(method, path, { query = {}, body, retainScanReceipt = false } = {}) {
    if (!/^\/[a-zA-Z0-9_/:.%-]+$/.test(path) || path.includes('..') || path.includes('%')) throw new ApiError(400, 'invalid_route', 'TamRank could not build this request. Nothing was sent.');
    if (retainScanReceipt !== false && (retainScanReceipt !== true || !validReceiptAttempt(method, body)
      || !this.#receiptStore || typeof this.#receiptStore.save !== 'function' || typeof this.#receiptStore.checkReady !== 'function'))
      throw new ApiError(400, 'scan_receipt_configuration_invalid', 'A private receipt store and exact attempt are required. Nothing was sent.');
    const requestSite = this.base, requestPat = this.pat;
    if (retainScanReceipt) {
      body = { ...body }; // Bind retention to the exact bytes sent, not a later caller mutation.
      try { await this.#receiptStore.checkReady(); }
      catch { throw new ApiError(0, 'scan_receipt_storage_not_ready', 'Private recovery storage is not ready. Nothing was sent.'); }
    }
    const url = workflowUrl(this.#restBase, this.routeStyle, path, query);
    const bodyBytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
    if (bodyBytes.byteLength > 1048576) throw new ApiError(413, 'workflow_request_limit', 'Request exceeds the transport budget. Nothing was sent.');
    const controller = new AbortController();
    // A 256-KiB signed field plan can expand ~3x under WordPress 6.0 JSON Unicode
    // escaping. Exact private-draft/native-preview routes get a 1-MiB wire cap.
    // Ordinary analytics/scan responses retain their existing 512-KiB limit.
    const fieldDraft=(method==='POST'&&['/changes/proposals','/schema/preview'].includes(path))||(method==='GET'&&/^\/changes\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(path));
    const fieldExecution=(method==='POST'&&/^\/changes\/executions(?:\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/(?:execute|rollback-preview|rollback-proposals|recovery-proposals|recover))?$/.test(path))
      ||(method==='GET'&&/^\/changes\/executions\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(path));
    const responseLimit=fieldDraft||fieldExecution?1048576:524288;
    let timer;
    const timeoutMs = this.#hosted ? Math.min(this.timeoutMs, 30000) : this.timeoutMs;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new DOMException('Workflow timeout', 'TimeoutError'));
    }, timeoutMs); });
    const redact = text => {
      const clean = this.#transport.redact ? this.#transport.redact(text) : text;
      if (typeof clean !== 'string') throw new Error('Invalid redaction result');
      return clean;
    };
    try {
      const response = await Promise.race([this.#transport.request({method, url: url.href,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'tamrank-mcp-workflow' },
        bodyBytes, timeoutMs, responseByteLimit: responseLimit, signal: controller.signal}), deadline]);
      if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
        || !(response.bodyBytes instanceof Uint8Array)) throw new ApiError(0, 'invalid_response', 'Invalid transport response.');
      if (response.status >= 300 && response.status < 400)
        throw new ApiError(response.status, 'workflow_redirect_refused', 'Configure the final site URL; credentials are never forwarded through redirects.');
      if (response.bodyBytes.byteLength > responseLimit)
        throw new ApiError(503, 'workflow_response_limit', 'Response exceeds the transport budget. Use an explicit section or smaller page.');
      let data;
      try { data = JSON.parse(Buffer.from(response.bodyBytes).toString('utf8')); }
      catch { throw new ApiError(response.status, 'invalid_response', 'The website sent an answer TamRank could not read.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(response.status, 'invalid_response', 'The website sent an answer TamRank could not read.');
      if (response.status < 200 || response.status >= 300) {
        let retained = null;
        if (retainScanReceipt && Object.hasOwn(data.data || {}, 'result_receipt')) {
          try {
            if (data.data.receipt_contains_private_result !== true || !isScanReceipt(data.data.result_receipt)) throw new Error();
            retained = await this.#receiptStore.save({ site_url: requestSite, execution_id: body.execution_id,
              measurement_id: body.measurement_id, attempt_request_id: body.client_request_id,
              attempt_runtime_hash: body.expected_runtime_hash,
              result_receipt: data.data.result_receipt });
            if (retained?.retained !== true || typeof retained.receipt_reference !== 'string'
              || !/^receipt_[a-f0-9]{64}$/.test(retained.receipt_reference)) throw new Error();
          } catch {
            throw new ApiError(response.status, 'scan_receipt_retention_failed',
              'The request outcome must be reconciled. Its private recovery receipt could not be retained. Do not repeat the measurement.');
          }
        }
        const privatePacketPresent = Object.hasOwn(data.data || {}, 'result_receipt');
        const validWpEnvelope = typeof data.code === 'string' && typeof data.message === 'string' && data.data?.status === response.status;
        data = scrubResponse(data, requestPat, null, redact);
        const siteCode = typeof data.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(data.code) ? data.code : undefined;
        const code = siteCode ?? 'workflow_request_failed';
        const message = retained ? 'The result was not confirmed as stored. A private recovery receipt was retained locally. Reconcile before any new measurement.'
          : privatePacketPresent ? 'The site returned a private recovery receipt that was not retained. Reconcile the request outcome; do not repeat the measurement.'
          : siteCode?.startsWith('rest_') ? 'The website could not handle this request. The TamRank plugin may be inactive or out of date.'
          : typeof data.message === 'string' ? data.message.slice(0,500) : 'No reason was given.';
        const advice=response.status===429?rateLimitAdvice(data.data):undefined;
        // A refused PageSpeed plan may say why (reason) and how the user switches it on (how_to_enable).
        const help=(method==='POST'&&path==='/scans/executions/proposals')||(method==='GET'&&path==='/scans/preview')?pageSpeedEnableHelp(data.data):{};
        const enable=help.reason||help.how_to_enable?help:siteCode==='workflow_read_changed'?changedSources(data.data):{};
        if (this.#hosted) {
          // Only the site's own code classifies; a replaced code is no evidence of a site decision.
          const outcome = {status: response.status, code: siteCode, validWpEnvelope, kind: method === 'GET' ? 'read' : 'write', method, path};
          const mapped = mapHostedOutcome({...outcome, retryAfter: advice?.retry_after});
          // A limit or an index-check refusal is the site's decision before any work: keep its code and bounded details.
          const siteDecision = mapped.code === siteCode && (LIMIT_CODES.has(siteCode) || INDEX_START_REFUSALS.has(siteCode));
          throw new ApiError(response.status, mapped.code,
            mapped.code === siteCode && (isSiteReadRefusal(outcome) || isSitePlanRefusal(outcome) || siteDecision) ? message
              : mapped.code === 'rate_limited' ? 'The website asked TamRank to slow down. Try again shortly.'
              : mapped.code === 'workflow_work_not_found' ? 'The website has no open work item with this ID. Nothing was changed.'
              : 'No reason was given.',
            siteDecision ? {...mapped, ...limitDetails(data.data)}
              : mapped.code === 'workflow_work_not_found' ? {...mapped, assistant_note: 'Read get_work_queue for the current work and its revision before changing anything.'} : isSitePlanRefusal(outcome) || isSiteReadRefusal(outcome) ? {...mapped, ...enable} : mapped);
        }
        throw new ApiError(response.status, code, message, retained ? { receipt_reference: retained.receipt_reference, receipt_retained: true }
          : LIMIT_CODES.has(code) || INDEX_START_REFUSALS.has(code) ? {...advice, ...limitDetails(data.data)} : Object.keys(enable).length ? {...advice, ...enable} : advice);
      }
      // Native execution has its own versioned policy/envelope. Accept v1 only
      // on these exact method/route pairs; every older read/draft remains v2.
      // A draft read of a plan from plan_changes answers with the execution body (v1) since PRO fix/mcp-launch-fixes;
      // a real draft stays v2. Only that read accepts both.
      const draftRead=method==='GET'&&/^\/changes\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(path);
      if (!(draftRead && data.contract_version === 1) && data.contract_version !== (fieldExecution || liveCheckRoute(method, path) ? 1 : 2)) throw new ApiError(409, 'workflow_upgrade_required', 'The TamRank plugin on this website does not match this connection. Nothing else was tried.');
      // Native schema rollback IDs share a prefix with private scan receipts.
      // Exempt only the exact envelope field after validating the whole closed
      // semantic response on an execution route, never error data or metadata.
      // Load at request time: schema contracts also use this transport's advice.
      const readId=method==='GET'&&fieldExecution?path.slice(path.lastIndexOf('/')+1):null;
      const schemaEnvelope=fieldExecution&&data.record?.envelope?.plan?.policy_version==='workflow-schema-rollback-1'
        &&(await import('./schema-execution.js')).validSchemaExecutionResponse(data,readId)?data.record.envelope:null;
      return scrubResponse(data, requestPat, schemaEnvelope, redact);
    } catch (error) {
      if (error instanceof ApiError) {
        if (this.#hosted && ['invalid_response', 'workflow_upgrade_required'].includes(error.code)) {
          const mapped = mapHostedOutcome({status:error.status, code:error.code, validWpEnvelope:error.code==='workflow_upgrade_required', kind:method==='GET'?'read':'write'});
          // Only a 2xx raises workflow_upgrade_required here: the site accepted the write, so its outcome is unknown.
          if (error.code === 'workflow_upgrade_required' && method !== 'GET') mapped.outcome_unknown = true;
          throw new ApiError(error.status, mapped.code, 'Its answer could not be used.', mapped);
        }
        throw error;
      }
      if (this.#hosted) {
        const mapped = mapHostedOutcome({kind:method==='GET'?'read':'write'});
        throw new ApiError(0, mapped.code, 'TamRank could not confirm the result.', mapped);
      }
      // Network messages can contain URLs/proxy details. Never echo raw exceptions or PATs.
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network_error',
        controller.signal.aborted ? 'The website took too long to answer. If this was a change, check its result before trying again.' : 'TamRank could not reach the website. It did not try again.');
    } finally { clearTimeout(timer); }
  }
  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body) { return this.request('POST', path, { body }); }
}
