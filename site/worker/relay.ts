// Relays analytics events from this site's own address to PostHog EU, so
// browsers that block third-party analytics hosts still count. It accepts only
// event posts; every other request is served from the static files without
// running this code (see run_worker_first in wrangler.jsonc).
// Visitors with Do Not Track or Global Privacy Control send nothing at all.

export const PREFIX = '/relay';
export const UPSTREAM = 'https://eu.i.posthog.com';
// Event endpoints of posthog-js; flags, remote config and scripts are off.
const PATHS = new Set(['/e/', '/i/v0/e/', '/batch/']);

export async function relay(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : '';
  if (!PATHS.has(path)) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  const headers = new Headers();
  for (const name of ['content-type', 'content-encoding', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // PostHog's cookieless visitor hash needs the visitor's IP, not Cloudflare's.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, { method: 'POST', headers, body: request.body });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export default { fetch: relay };
