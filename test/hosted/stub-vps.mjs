import { recordNaiveTimes } from './naive-times.mjs';
/** Synthetic H3b seam. No network, credentials, storage, or automatic dispatch. */
// siteTimezone: what the site's outcome-report summary reports (the bridge reads it once per session to put
// site-clock times in UTC). Answered beside the response queue and kept in zoneCalls; null = the read fails.
export function createStubVps({ responses = [], decisions = {}, recorderFailure = null, siteTimezone = 'Europe/Amsterdam' } = {}) {
  const events = [], calls = [], recorded = [], zoneCalls = [];
  const queue = [...responses];
  return {
    events, calls, recorded, zoneCalls,
    transport: {
      async request(input) {
        const keys = ['method', 'url', 'headers', 'bodyBytes', 'timeoutMs', 'responseByteLimit', 'signal'];
        if (Object.keys(input).sort().join() !== [...keys].sort().join()) throw new Error('Transport interface mismatch');
        if (!['GET', 'POST'].includes(input.method) || typeof input.url !== 'string'
          || !input.headers || typeof input.headers !== 'object'
          || !(input.bodyBytes instanceof Uint8Array)
          || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000
          || ![524288, 1048576].includes(input.responseByteLimit)
          || !(input.signal instanceof AbortSignal)) throw new Error('Invalid transport request');
        if (!new URL(input.url).hostname.endsWith('.example.invalid')) throw new Error('Synthetic hosts only');
        const call = { ...input, headers: { ...input.headers }, bodyBytes: new Uint8Array(input.bodyBytes) };
        if (input.method === 'GET' && new URL(input.url).pathname.endsWith('/tamrank/v2/reports/outcomes/summary')) {
          zoneCalls.push(call);
          const body = siteTimezone === null ? { code: 'change_outcome_storage_unavailable', message: 'Unavailable.', data: { status: 503 } }
            : { contract_version: 2, report: {}, site_timezone: siteTimezone, generated_at: '2026-10-14T16:00:00Z' };
          return { status: siteTimezone === null ? 503 : 200, headers: { 'content-type': 'application/json' }, bodyBytes: new TextEncoder().encode(JSON.stringify(body)) };
        }
        calls.push(call); events.push({ type: 'request', method: input.method, url: input.url });
        const response = queue.shift();
        if (!response) throw new Error('No configured fixture response');
        if (response.method && response.method !== input.method) throw new Error('Fixture method mismatch');
        if (response.url && response.url !== input.url) throw new Error('Fixture URL mismatch');
        if (response.failure === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError');
        if (response.failure === 'network') throw new TypeError('Synthetic network failure');
        if (input.signal.aborted) throw new DOMException('Synthetic abort', 'AbortError');
        return { status: response.status ?? 200, headers: { 'content-type': 'application/json', ...response.headers },
          bodyBytes: response.bodyBytes ? new Uint8Array(response.bodyBytes)
            : new TextEncoder().encode(response.html ?? JSON.stringify(response.body ?? { contract_version: 2 })) };
      },
    },
    authorizer: {
      async authorizeOperation(toolName, parsedArgs) {
        events.push({ type: 'authorize', toolName, parsedArgs: structuredClone(parsedArgs) });
        return structuredClone(decisions[toolName] ?? { ok: true });
      },
      async recordValidatedResult(toolName, parsedArgs, result) {
        events.push({ type: 'record', toolName });
        if (recorderFailure === true || recorderFailure === toolName) throw new Error('Synthetic binding failure');
        recordNaiveTimes(toolName, result);
        recorded.push({ toolName, parsedArgs: structuredClone(parsedArgs), result: structuredClone(result) });
        return { ok: true };
      },
    },
  };
}
