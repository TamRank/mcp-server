/** Strict V2 transport. No credential redirects, V1 fallback or implicit retries. */
import { ApiError } from './rest.js';

export class WorkflowClient {
  constructor({ siteUrl, pat, timeoutMs = 30000, routeStyle = 'pretty' }) {
    const url = new URL(siteUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error('Use HTTPS for the configured site; HTTP is allowed only on loopback. No credentials, query or fragment in the site URL.');
    }
    if (!['pretty', 'query'].includes(routeStyle)) throw new Error('Unknown REST route style.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid request timeout.');
    this.base = url.href.replace(/\/+$/, '');
    this.pat = pat; this.timeoutMs = timeoutMs; this.routeStyle = routeStyle;
  }

  async request(method, path, { query = {}, body } = {}) {
    if (!/^\/[a-zA-Z0-9_/:.%-]+$/.test(path) || path.includes('..') || path.includes('%')) throw new ApiError(400, 'invalid_route', 'Invalid workflow route.');
    const url = new URL(this.base + (this.routeStyle === 'pretty' ? '/wp-json/tamrank/v2' + path : '/'));
    if (this.routeStyle === 'query') url.searchParams.set('rest_route', '/tamrank/v2' + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { method, redirect: 'manual', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.pat}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'tamrank-mcp-workflow' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new ApiError(response.status, 'workflow_redirect_refused', 'Configure the final site URL; credentials are never forwarded through redirects.');
      }
      const reader = response.body?.getReader(); let bytes = 0; const chunks = [];
      if (!reader) throw new ApiError(response.status, 'invalid_response', 'Empty workflow response.');
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 524288) { await reader.cancel(); throw new ApiError(503, 'workflow_response_limit', 'Response exceeds the transport budget. Use an explicit section or smaller page.'); }
        chunks.push(Buffer.from(value));
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ApiError(response.status, 'invalid_response', 'The site did not return a JSON workflow response.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(response.status, 'invalid_response', 'Invalid workflow response envelope.');
      if (!response.ok) {
        const scrub = value => this.pat ? value.split(this.pat).join('[redacted]') : value;
        const code = typeof data.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(scrub(data.code)) ? scrub(data.code) : 'workflow_request_failed';
        const message = typeof data.message === 'string' ? scrub(data.message).slice(0,500) : 'The site refused this workflow request.';
        throw new ApiError(response.status, code, message);
      }
      if (data.contract_version !== 2) throw new ApiError(409, 'workflow_upgrade_required', 'Workflow contract 2 is required. There is no fallback to legacy writers.');
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Network messages can contain URLs/proxy details. Never echo raw exceptions or PATs.
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network_error',
        controller.signal.aborted ? 'Workflow request timed out. A write must be reconciled before retry.' : 'Could not reach the configured workflow site. No automatic retry was made.');
    } finally { clearTimeout(timer); }
  }
  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body) { return this.request('POST', path, { body }); }
}
