import { ApiError } from '../workflow-error.js';

/** Stdio upstream adapter. Hosted H3b supplies its own pinned-IP transport. */
export function createFetchTransport(pat) {
  return {
    redact(text) { return pat ? text.split(pat).join('[redacted]') : text; },
    async request({method, url, headers, bodyBytes, timeoutMs, responseByteLimit, signal}) {
      const response = await fetch(url, {method, redirect: 'manual', signal,
        headers: {...headers, Authorization: `Bearer ${pat}`},
        body: method === 'GET' ? undefined : bodyBytes});
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return {status: response.status, headers: Object.fromEntries(response.headers), bodyBytes: new Uint8Array()};
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(response.status, 'invalid_response', 'Empty workflow response.');
      const chunks = []; let size = 0;
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > responseByteLimit) { await reader.cancel(); throw new ApiError(503, 'workflow_response_limit', 'Response exceeds the transport budget.'); }
        chunks.push(Buffer.from(value));
      }
      return {status: response.status, headers: Object.fromEntries(response.headers), bodyBytes: Buffer.concat(chunks)};
    },
  };
}
