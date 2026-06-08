/**
 * Thin REST client for the TamRank Agent-API (tamrank/v1).
 *
 * One site, authenticated with a site-local PAT (Authorization: Bearer
 * tamrank_pat_…) read from the environment. The MCP server is a forwarder: the
 * dry-run/execute discipline, scopes, and audit logging all live server-side in
 * the WordPress plugin — this client just carries the request and surfaces the
 * plugin's semantic error envelopes back to the agent.
 */

const NAMESPACE = '/wp-json/tamrank/v1';

export class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export class TamRankClient {
  /**
   * @param {object} opts
   * @param {string} opts.siteUrl  Base site URL, e.g. https://example.com
   * @param {string} opts.pat      tamrank_pat_… token
   * @param {number} [opts.timeoutMs]
   */
  constructor({ siteUrl, pat, timeoutMs = 30000 }) {
    this.base = String(siteUrl || '').replace(/\/+$/, '');
    this.pat = pat || '';
    this.timeoutMs = timeoutMs;
  }

  /**
   * Perform a request against the Agent-API.
   *
   * @param {string} method HTTP method.
   * @param {string} path   Path under the namespace, e.g. /site/health.
   * @param {object} [opts] { query, body }.
   * @returns {Promise<any>} Parsed JSON on 2xx.
   * @throws {ApiError} On a non-2xx response (carries the plugin's code/message).
   */
  async request(method, path, { query, body } = {}) {
    const url = new URL(this.base + NAMESPACE + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.pat}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'tamrank-mcp-server',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new ApiError(0, 'timeout', `Request to ${this.base} timed out after ${this.timeoutMs}ms.`);
      }
      throw new ApiError(0, 'network_error', `Could not reach ${this.base}: ${err.message}`);
    }
    clearTimeout(timer);

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const code = json.code || `http_${res.status}`;
      const message = json.message || res.statusText || `HTTP ${res.status}`;
      throw new ApiError(res.status, code, message, json.data || json);
    }

    return json;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body, query) {
    return this.request('POST', path, { body, query });
  }

  del(path, query) {
    return this.request('DELETE', path, { query });
  }
}

/**
 * Split write params into the body fields vs the execute/change_token control
 * params (which travel as query string so they apply uniformly to POST/DELETE).
 *
 * @param {object} args Tool arguments.
 * @param {string[]} bodyKeys Keys that belong in the request body.
 * @returns {{ body: object, control: object }}
 */
export function splitWriteArgs(args, bodyKeys) {
  const body = {};
  for (const k of bodyKeys) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  const control = {};
  if (args.execute === true) control.execute = 'true';
  if (args.change_token) control.change_token = args.change_token;
  return { body, control };
}
