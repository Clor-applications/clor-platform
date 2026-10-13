/**
 * api.clor.in -> Cloud Run (asia-south1).
 *
 * Cloud Run domain mapping is not available in asia-south1, and a Google load
 * balancer costs more than the database. This Worker keeps api.clor.in on
 * Cloudflare (same site as app.clor.in, so the HttpOnly refresh cookie stays
 * first-party) and forwards every request to the service's run.app address.
 *
 * X-Forwarded-For is OVERWRITTEN with Cloudflare's verified client IP. The API's
 * rate limiter keys on the first X-Forwarded-For entry, so a client-supplied
 * value must never reach it through this path.
 *
 * x-clor-edge carries the EDGE_SECRET Worker secret. The API refuses requests
 * without it, which closes the direct run.app address (wrangler secret put EDGE_SECRET).
 */
export default {
  async fetch(request, env) {
    const inUrl = new URL(request.url);
    const target = new URL(inUrl.pathname + inUrl.search, env.ORIGIN);

    const headers = new Headers(request.headers);
    const clientIp = request.headers.get('CF-Connecting-IP');
    if (clientIp) headers.set('X-Forwarded-For', clientIp);
    else headers.delete('X-Forwarded-For');
    headers.set('X-Forwarded-Host', inUrl.host);
    headers.set('X-Forwarded-Proto', 'https');
    headers.delete('Host'); // fetch() sets Host (and SNI) from the run.app target
    headers.delete('x-clor-edge'); // never trust a client-supplied value
    if (env.EDGE_SECRET) headers.set('x-clor-edge', env.EDGE_SECRET);

    const hasBody = !['GET', 'HEAD'].includes(request.method);
    return fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });
  },
};
