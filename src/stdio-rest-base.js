/** Compatibility boundary for stdio siteUrl/routeStyle configuration only. */
export function legacyRestBase(siteUrl, routeStyle = 'pretty') {
  const url = new URL(siteUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && loopback)) || !['pretty', 'query'].includes(routeStyle)) throw new Error('Invalid stdio site URL');
  const site = url.href.replace(/\/+$/, '');
  return routeStyle === 'pretty' ? site + '/wp-json/tamrank/v2' : site + '/?rest_route=/tamrank/v2';
}
