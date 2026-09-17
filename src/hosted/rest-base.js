import { ApiError } from '../workflow-error.js';

/** A validated full namespace URL, never a site URL with an implicit suffix. */
export function validateRestBase(value, style = 'pretty', allowLoopback = false) {
  if (typeof value !== 'string' || /[\\\s]/.test(value)) throw new Error('Invalid REST base');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:'
    && !(allowLoopback && loopback && url.protocol === 'http:')) || !['pretty', 'query'].includes(style)) throw new Error('Invalid REST base');
  if (style === 'query') {
    if ([...url.searchParams.keys()].join() !== 'rest_route' || url.searchParams.get('rest_route') !== '/tamrank/v2') throw new Error('Invalid REST namespace');
  } else if (url.search || !url.pathname.endsWith('/tamrank/v2')) throw new Error('Invalid REST namespace');
  return url.href;
}

export function workflowUrl(base, style, path, query = {}) {
  if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_/:.-]+$/.test(path) || path.includes('..'))
    throw new ApiError(400, 'invalid_route', 'Invalid workflow route.');
  const root = new URL(base), url = new URL(base);
  if (style === 'query') url.searchParams.set('rest_route', root.searchParams.get('rest_route') + path);
  else url.pathname += path;
  for (const [key, value] of Object.entries(query)) {
    if (key === 'rest_route') throw new ApiError(400, 'invalid_route', 'Cannot replace the bound namespace.');
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  if (url.origin !== root.origin || (style === 'query'
    ? url.pathname !== root.pathname || url.searchParams.getAll('rest_route').length !== 1
      || !url.searchParams.get('rest_route').startsWith('/tamrank/v2/')
    : !url.pathname.startsWith(root.pathname + '/'))) throw new ApiError(400, 'invalid_route', 'Route escaped its installation.');
  return url;
}

export { legacyRestBase } from '../stdio-rest-base.js';
