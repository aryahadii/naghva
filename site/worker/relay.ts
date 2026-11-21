// Relays analytics events from this site's own address to PostHog EU, so
// browsers that block third-party analytics hosts still count. It accepts only
// event posts; every other request is served from the static files without
// running this code (see run_worker_first in wrangler.jsonc).
// Visitors with Do Not Track or Global Privacy Control send nothing at all.

export const PREFIX = '/relay';
export const UPSTREAM = 'https://eu.i.posthog.com';
// Event endpoints of posthog-js; flags, remote config and scripts are off.
const PATHS = new Set(['/e/', '/i/v0/e/', '/batch/']);
// Larger bodies are forwarded untouched rather than decoded.
const MAX_BODY = 1_000_000;
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

type Event = { properties?: Record<string, unknown> };

/**
 * Cloudflare's country for the visitor (two letters), or undefined for
 * unknown (XX) and Tor (T1). Only the country is used, never region or city.
 */
export function visitorCountry(request: Request): string | undefined {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const country = typeof cf?.country === 'string' ? cf.country : request.headers.get('cf-ipcountry');
  return country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : undefined;
}

async function readPayload(body: ArrayBuffer, gzip: boolean): Promise<unknown> {
  let text = gzip
    ? await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(body);
  if (text.startsWith('data=')) {
    const binary = atob(new URLSearchParams(text).get('data') ?? '');
    text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }
  return JSON.parse(text);
}

/**
 * PostHog drops the IP of cookieless events before its GeoIP step, so their
 * country is always empty. Add the country Cloudflare already resolved, and
 * tell PostHog not to run its own lookup over it.
 */
export function addCountry(payload: unknown, country: string): unknown {
  const events: Event[] = Array.isArray(payload) ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { batch?: unknown }).batch) ? (payload as { batch: Event[] }).batch
      : [payload as Event];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    event.properties = {
      ...(event.properties && typeof event.properties === 'object' ? event.properties : {}),
      $geoip_country_code: country,
      $geoip_country_name: COUNTRY_NAMES.of(country) ?? country,
      $geoip_disable: true,
    };
  }
  return payload;
}

export async function relay(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : '';
  if (!PATHS.has(path)) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-encoding', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // PostHog's cookieless visitor hash needs the visitor's IP, not Cloudflare's.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  let body: BodyInit | null = await request.arrayBuffer();
  const country = visitorCountry(request);
  if (country && body.byteLength <= MAX_BODY) {
    // posthog-js gzips without always saying so, so look at the bytes too.
    const bytes = new Uint8Array(body, 0, Math.min(2, body.byteLength));
    const gzip = (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
      url.searchParams.get('compression') === 'gzip-js' || request.headers.get('content-encoding') === 'gzip';
    try {
      body = JSON.stringify(addCountry(await readPayload(body, gzip), country));
      // The rewritten body is plain JSON whatever the browser sent.
      url.searchParams.delete('compression');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json');
    } catch { /* Not a payload we understand: forward it as it came. */ }
  }
  const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, { method: 'POST', headers, body });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export default { fetch: relay };
