/**
 * console.clor.in/api/* -> the Console API on Cloud Run (asia-south1).
 *
 * The same arrangement as api.clor.in (deploy/cloudflare/api-proxy): Cloud Run
 * has no domain mapping in asia-south1, so Cloudflare forwards. Here it is a
 * Pages Function on the Console's own address, so the page and its API are one
 * origin: the session cookie is first-party and nothing crosses sites.
 *
 * X-Forwarded-For is OVERWRITTEN with Cloudflare's verified client address.
 * x-console-edge carries CONSOLE_EDGE_SECRET; the API refuses requests without
 * it, which closes the direct run.app address.
 *
 * ORIGIN is in wrangler.toml; the secret is set once with
 *   wrangler pages secret put CONSOLE_EDGE_SECRET --project-name clor-console
 */
export async function onRequest({ request, env }) {
  if (!env.ORIGIN) return Response.json({ error: 'The Console server is not set up yet.' }, { status: 503 });
  const inUrl = new URL(request.url);
  const target = new URL(inUrl.pathname + inUrl.search, env.ORIGIN);

  const headers = new Headers(request.headers);
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) headers.set('X-Forwarded-For', clientIp);
  else headers.delete('X-Forwarded-For');
  headers.set('X-Forwarded-Host', inUrl.host);
  headers.set('X-Forwarded-Proto', 'https');
  headers.delete('Host');
  headers.delete('x-console-edge'); // never trust a client-supplied value
  if (env.CONSOLE_EDGE_SECRET) headers.set('x-console-edge', env.CONSOLE_EDGE_SECRET);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    return await fetch(target, { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: 'manual' });
  } catch {
    return Response.json({ error: 'The Console server is not answering.' }, { status: 502 });
  }
}
